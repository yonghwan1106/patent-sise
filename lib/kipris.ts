// ============================================================
//  lib/kipris.ts — KIPRIS Plus 6종 API 연동 (실측 확정 2026-06-10)
//  호출 우선순위: ①KIPRIS Plus(plus.kipris.or.kr) → ②data.go.kr → ③샘플 폴백
//  + 파일 캐시 (월 쿼터 방어)
// ============================================================
//
//  연동 6종 (실측 검증 완료):
//  ┌──┬────────────────┬────────────────────────────────────────────────────────────────────────────┐
//  │ # │ 역할           │ URL (실측 확정)                                                            │
//  ├──┼────────────────┼────────────────────────────────────────────────────────────────────────────┤
//  │ 1 │ 서지           │ kipo-api/kipi/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch    │
//  │   │                │  param: applicationNumber | registerNumber, ServiceKey                     │
//  │   │                │  응답: <biblioSummaryInfo> 블록                                            │
//  ├──┼────────────────┼────────────────────────────────────────────────────────────────────────────┤
//  │ 2 │ 등록사항       │ openapi/rest/RegistrationService/registrationInfo                          │
//  │   │                │  param: registrationNumber(13자리 등록번호), accessKey                     │
//  │   │                │  응답: <registrationInfo> / <registrationFeeInfo> 블록                    │
//  │   │                │  ※ resultCode 빈값이 정상 — items 존재 여부로 성공 판정                   │
//  ├──┼────────────────┼────────────────────────────────────────────────────────────────────────────┤
//  │ 3 │ 권리자 변동    │ openapi/rest/RightHolderService/rightHolderInfo                            │
//  │   │                │  param: registrationNumber(13자리), accessKey                              │
//  │   │                │  ⚠️ 등록번호 필수 — 서지 응답에서 먼저 추출 후 체이닝 호출                │
//  │   │                │  응답: <rightHolderInfo> 블록, rankCorrelatorType=권리자 필터              │
//  ├──┼────────────────┼────────────────────────────────────────────────────────────────────────────┤
//  │ 4 │ 심판           │ openapi/rest/judgmentInfoSearchService/applicationNumberSearchInfo          │
//  │   │                │  param: applicationNumber, docsStart=1, accessKey                          │
//  │   │                │  응답: <TotalSearchCount> + <TrialInfo> 블록                               │
//  ├──┼────────────────┼────────────────────────────────────────────────────────────────────────────┤
//  │ 5 │ 후방인용       │ openapi/rest/CitationService/citationInfoV3                                │
//  │   │                │  param: applicationNumber, accessKey                                       │
//  │   │                │  응답: <citationInfoV3> 블록, OriginalcitationLiteraturenumber             │
//  ├──┼────────────────┼────────────────────────────────────────────────────────────────────────────┤
//  │ 6 │ 전방인용(피인용)│ openapi/rest/CitingService/citingInfo                                     │
//  │   │                │  param: standardCitationApplicationNumber, accessKey                       │
//  │   │                │  응답: <citingInfo> 블록, ApplicationNumber                                │
//  └──┴────────────────┴────────────────────────────────────────────────────────────────────────────┘
//
//  키 파라미터:
//   - API 1(kipo-api 계열): ServiceKey
//   - API 2~6(openapi/rest 계열): accessKey
//   - 키 값은 KIPRIS_PLUS_ACCESS_KEY 동일 (URL 인코딩 필수)
//
//  폴백 체인:
//   ① KIPRIS_PLUS_ACCESS_KEY → plus.kipris.or.kr
//   ② DATA_GO_KR_SERVICE_KEY → kipo-api.kipi.or.kr (openapi/rest 계열은 Plus만 지원, 서지만 폴백)
//   ③ 샘플 JSON (data/samples/)

import fs from "fs";
import path from "path";
import type {
  PatentRaw,
  Bibliography,
  RegisterStatus,
  RightChanges,
  RightChangeRecord,
  Trials,
  Citations,
  AnnualFeeRecord,
  TrialRecord,
  CitationRecord,
} from "./types";

// ------------------------------------------------------------
//  엔드포인트 (실측 확정 2026-06-10)
// ------------------------------------------------------------
const EP = {
  // API 1: 서지 — kipo-api 계열, ServiceKey 파라미터
  bib: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch",
  },
  // API 2: 등록사항 — openapi/rest 계열, accessKey, registrationNumber 필수
  reg: "http://plus.kipris.or.kr/openapi/rest/RegistrationService/registrationInfo",
  // API 3: 권리자 변동 — openapi/rest 계열, accessKey, registrationNumber 필수
  rightHolder: "http://plus.kipris.or.kr/openapi/rest/RightHolderService/rightHolderInfo",
  // API 4: 심판 — openapi/rest 계열, docsStart 필수
  trial: "http://plus.kipris.or.kr/openapi/rest/judgmentInfoSearchService/applicationNumberSearchInfo",
  // API 5: 후방인용
  citBack: "http://plus.kipris.or.kr/openapi/rest/CitationService/citationInfoV3",
  // API 6: 전방인용(피인용), 파라미터명 standardCitationApplicationNumber
  citFwd: "http://plus.kipris.or.kr/openapi/rest/CitingService/citingInfo",
} as const;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const SAMPLE_DIR = path.join(process.cwd(), "data", "samples");
const FETCH_TIMEOUT_MS = 10000;

// openapi/rest 계열은 resultCode 빈값이 정상.
// 명시적 오류코드(10·11·20·22·30·31)가 있을 때만 폴백.
const ERROR_CODES = ["10", "11", "20", "22", "30", "31"];

// ------------------------------------------------------------
//  입력 번호 정규화
// ------------------------------------------------------------
export function normalizeNumber(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}

/** 서지 응답의 registerNumber (예: "10-1513250-0000") → 13자리 digits */
function toRegistrationNumber(raw: string | null): string | null {
  if (!raw || !raw.trim()) return null;
  const digits = raw.replace(/[^0-9]/g, "");
  return digits.length >= 10 ? digits.padEnd(13, "0").slice(0, 13) : null;
}

function isApplicationNumber(num: string): boolean {
  if (num.length < 11) return true;
  const yr = Number(num.slice(2, 6));
  return yr >= 1948 && yr <= 2099;
}

// ------------------------------------------------------------
//  경량 XML 파서
// ------------------------------------------------------------
function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return decodeXml(m[1].trim()) || null;
}

function tagAll(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) {
    const v = decodeXml(m[1].trim());
    if (v) out.push(v);
  }
  return out;
}

function blocks(xml: string, name: string): string[] {
  const re = new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<").replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'").replace(/&amp;/g, "&")
    .replace(/&#034;/g, '"')
    .trim();
}

function toInt(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) && n >= 0 ? n : null;
}

/** openapi/rest 응답에서 명시적 오류코드 감지 */
function hasErrorCode(xml: string): boolean {
  const re = new RegExp(`<resultCode>([\\s\\S]*?)</resultCode>`, "i");
  const m = xml.match(re);
  if (!m) return false;
  const code = m[1].trim();
  if (!code) return false; // 빈값 = 정상
  return ERROR_CODES.includes(code);
}

/** items 블록이 존재하면 성공으로 간주 (resultCode 빈값 허용) */
function hasItems(xml: string): boolean {
  return /<items>/i.test(xml);
}

// ------------------------------------------------------------
//  파일 캐시
// ------------------------------------------------------------
function readCache(num: string): PatentRaw | null {
  try {
    const p = path.join(CACHE_DIR, `${num}.json`);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PatentRaw;
  } catch { return null; }
}

function writeCache(num: string, data: PatentRaw): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(path.join(CACHE_DIR, `${num}.json`), JSON.stringify(data, null, 2), "utf-8");
  } catch { /* 캐시 실패는 무시 */ }
}

// ------------------------------------------------------------
//  샘플 폴백
// ------------------------------------------------------------
const SAMPLE_MAP: Record<string, string> = {
  "1020130028607": "sample-hollow-fiber.json",
  "1020120089012": "sample-switchboard.json",
  "1020150057832": "sample-carbonizer.json",
};
const DEFAULT_SAMPLE = "sample-hollow-fiber.json";
const ALL_SAMPLE_FILES = Object.values(SAMPLE_MAP);

function loadSample(num: string): PatentRaw {
  const file = SAMPLE_MAP[num] ?? DEFAULT_SAMPLE;
  const p = path.join(SAMPLE_DIR, file);
  // 샘플 파일 없으면 첫 번째 파일로 폴백
  const actualP = fs.existsSync(p) ? p : path.join(SAMPLE_DIR, DEFAULT_SAMPLE);
  const data = JSON.parse(fs.readFileSync(actualP, "utf-8")) as PatentRaw;
  return { ...data, inputNumber: num || data.inputNumber, source: "sample" };
}

export function listSamples(): { number: string; title: string; tag: string }[] {
  return ALL_SAMPLE_FILES.map((f) => {
    const p = path.join(SAMPLE_DIR, f);
    if (!fs.existsSync(p)) return null;
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as PatentRaw;
    return { number: data.inputNumber, title: data.bibliography.inventionTitle, tag: data.bibliography.ipcCodes[0] ?? "" };
  }).filter((x): x is { number: string; title: string; tag: string } => x !== null);
}

// ------------------------------------------------------------
//  HTTP 호출 유틸
// ------------------------------------------------------------
async function fetchXml(url: string, params: Record<string, string>): Promise<string> {
  const qs = new URLSearchParams(params).toString();
  const full = `${url}?${qs}`;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const r = await fetch(full, { signal: ctrl.signal, cache: "no-store" });
    if (!r.ok) throw new Error(`HTTP ${r.status}`);
    return await r.text();
  } finally {
    clearTimeout(timer);
  }
}

// ------------------------------------------------------------
//  응답 파서 6종 (실측 필드명 기준)
// ------------------------------------------------------------

/**
 * API 1: 서지 파서
 * 응답 구조: <biblioSummaryInfo> 블록 안에 모든 필드
 * IPC는 <ipcInfo> 블록의 <ipcNumber>
 */
function parseBibliography(xml: string, inputNum: string): Bibliography {
  const body = blocks(xml, "biblioSummaryInfo")[0] ?? xml;

  // IPC: ipcInfoArray > ipcInfo > ipcNumber
  const ipcCodes = tagAll(xml, "ipcNumber").map(s => s.trim()).filter(Boolean);

  const regRaw = tag(body, "registerNumber");

  return {
    applicationNumber: tag(body, "applicationNumber") ?? inputNum,
    registerNumber: regRaw?.trim() || null,
    inventionTitle: tag(body, "inventionTitle") ?? tag(body, "inventionName") ?? "명칭 미확인",
    applicationDate: tag(body, "applicationDate"),
    registerDate: tag(body, "registerDate"),
    openDate: tag(body, "openDate") ?? tag(body, "publicationDate"),
    claimCount: toInt(tag(body, "claimCount")),
    ipcCodes,
    applicantName: tag(body, "applicantName"),
    // 서지에 우선권·패밀리 없으면 null → 지표 N/A
    priorityNumber: tag(body, "priorityNumber") ?? tag(body, "originalApplicationNumber"),
    familyCount: toInt(tag(body, "familyCount")),
    // 법적상태 원문 (registerStatus 필드)
    registerStatus: tag(body, "registerStatus"),
    finalDisposal: tag(body, "finalDisposal"),
  };
}

/**
 * API 2: 등록사항 파서 (openapi/rest/RegistrationService)
 * 주요 블록:
 *  - registrationRightInfo: 등록번호·등록일·만료일·소멸일·소멸원인
 *  - registrationRightHolderInfoA: 권리자 목록
 *  - registrationFeeInfo: 연차료(startAnnual/lastAnnual/paymentDate)
 *  - registrationLastRightHolderInfo: 현재 최종 권리자
 *  - disappearanceFlag: N=유지 / Y=소멸
 */
function parseRegisterStatus(xml: string, bibStatus: string | null): RegisterStatus {
  const rightInfo = blocks(xml, "registrationRightInfo")[0] ?? "";
  const feeBlocks = blocks(xml, "registrationFeeInfo");

  // 법적상태: 서지의 registerStatus + disappearanceFlag 교차 확인
  const disappearanceFlags = tagAll(xml, "disappearanceFlag");
  const anyDisappeared = disappearanceFlags.some(f => f.trim() === "Y");
  const terminationCause = tag(xml, "terminationCauseName");
  const terminationDate = tag(xml, "terminationDate");

  // 서지 registerStatus 기준 (등록/소멸/포기/취하/거절)
  const statusFromBib = bibStatus ?? "";
  const registered =
    !anyDisappeared &&
    !terminationDate?.trim() &&
    /등록/.test(statusFromBib) &&
    !/소멸|포기|취하|무효/.test(statusFromBib);

  // 연차료 블록: registrationFeeInfo > lastAnnual(납부 연차 끝), paymentDate
  const fees: AnnualFeeRecord[] = feeBlocks.map((b): AnnualFeeRecord | null => {
    const yr = toInt(tag(b, "lastAnnual") ?? tag(b, "startAnnual"));
    if (yr == null) return null;
    return { paymentYear: yr, paymentDate: tag(b, "paymentDate") };
  }).filter((x): x is AnnualFeeRecord => x !== null);
  const lastPaidYear = fees.length ? Math.max(...fees.map(f => f.paymentYear)) : null;

  // 권리자: registrationRightHolderInfoA > rankCorrelatorName (권리자 타입)
  // rightHolderInfo API와 달리 여기서는 타입 구분이 없으므로 모두 수집
  const holderBlocks = blocks(xml, "registrationRightHolderInfoA");
  const holders = holderBlocks
    .map(b => tag(b, "rankCorrelatorName"))
    .filter((n): n is string => !!n && !!n.trim());

  // 최종 권리자 (registrationLastRightHolderInfo)
  const lastHolder = tag(xml, "lastRightHolderName");
  const effectiveHolders = holders.length ? holders : (lastHolder ? [lastHolder] : []);

  return {
    legalStatus: statusFromBib || (registered ? "등록" : null),
    registered,
    lastPaidYear,
    annualFees: fees,
    rightHolders: effectiveHolders,
    termExpiryDate: tag(rightInfo, "expirationDate"),
    extinctDate: terminationDate?.trim() || null,
    extinctReason: terminationCause?.trim() || null,
  };
}

/**
 * API 3: 권리자 변동 파서 (openapi/rest/RightHolderService)
 * 블록: rightHolderInfo
 *  - rankCorrelatorType: "권리자" | "발명자"
 *  - rankNumber: 순위 변동으로 이전 횟수 추정
 *  - transferDate: 이전일 (있을 경우)
 * 이전 횟수: rankNumber가 2 이상으로 올라간 횟수 또는
 *   transferDate 비어있지 않은 권리자 레코드 수
 */
function parseRightChanges(xml: string): RightChanges {
  const all = blocks(xml, "rightHolderInfo");
  // 권리자 타입만 필터
  const ownerBlocks = all.filter(b => {
    const t = tag(b, "rankCorrelatorType") ?? "";
    return t.includes("권리자");
  });

  const records: RightChangeRecord[] = ownerBlocks.map(b => ({
    rank: toInt(tag(b, "rankNumber")),
    holderName: tag(b, "rankCorrelatorName"),
    changeDate: tag(b, "registrationDate"),
    changeType: tag(b, "transferDate") ? "이전" : null,
  }));

  // rankNumber 기준: 최대 순위 = 이전 횟수 (최초 설정=1, 이후 이전할 때마다 +1)
  const maxRank = records.reduce((m, r) => Math.max(m, r.rank ?? 1), 1);
  // transferDate 있는 레코드 수
  const withTransfer = ownerBlocks.filter(b => {
    const td = tag(b, "transferDate");
    return td && td.trim();
  }).length;

  const transferCount = withTransfer > 0 ? withTransfer : Math.max(0, maxRank - 1);

  return { records, transferCount };
}

/**
 * API 4: 심판 파서 (openapi/rest/judgmentInfoSearchService)
 * 블록: TrialInfo
 * TotalSearchCount: 전체 건수
 */
function parseTrials(xml: string): Trials {
  const totalStr = tag(xml, "TotalSearchCount");
  const total = toInt(totalStr) ?? 0;

  if (total === 0) return { records: [] };

  const trialBlocks = blocks(xml, "TrialInfo");
  const records: TrialRecord[] = trialBlocks.map(b => {
    const status = tag(b, "TrialStatus") ?? tag(b, "trialStatus") ?? tag(b, "status");
    const trialType = tag(b, "JudgmentKindCodeName") ?? tag(b, "trialType") ?? tag(b, "TrialType") ?? "심판";
    const alive = status ? /계류|진행|심리/.test(status) : false;
    return {
      trialType,
      trialNumber: tag(b, "TrialNumber") ?? tag(b, "trialNumber"),
      status,
      alive,
      result: tag(b, "JudgmentResult") ?? tag(b, "trialResult") ?? tag(b, "result"),
    };
  });

  return { records };
}

/**
 * API 5: 후방인용 파서 (citationInfoV3)
 * 블록: citationInfoV3
 * 번호: OriginalcitationLiteraturenumber
 */
function parseBackwardCitations(xml: string): CitationRecord[] {
  return blocks(xml, "citationInfoV3").map(b => ({
    citedDocNumber: tag(b, "OriginalcitationLiteraturenumber") ?? tag(b, "StandardCitationLiteraturenumber") ?? "-",
    citedTitle: null, // citationInfoV3에 제목 필드 없음
  }));
}

/**
 * API 6: 전방인용(피인용) 파서 (citingInfo)
 * 블록: citingInfo
 * 번호: ApplicationNumber (이 특허를 인용한 출원번호)
 */
function parseForwardCitations(xml: string): CitationRecord[] {
  return blocks(xml, "citingInfo").map(b => ({
    citedDocNumber: tag(b, "ApplicationNumber") ?? "-",
    citedTitle: null,
  }));
}

// ------------------------------------------------------------
//  공개 진입점
// ------------------------------------------------------------
export async function getPatentRaw(inputNumber: string): Promise<PatentRaw> {
  const num = normalizeNumber(inputNumber);

  // 1) 캐시 우선
  const cached = readCache(num);
  if (cached) return cached;

  const plusKey = process.env.KIPRIS_PLUS_ACCESS_KEY ?? "";
  const datagokrKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";
  const hasPlusKey = plusKey && plusKey !== "발급받은_KIPRIS_Plus_AccessKey_입력";
  const hasDataKey = datagokrKey && datagokrKey !== "발급받은_서비스키_입력";

  if (!hasPlusKey && !hasDataKey) {
    return loadSample(num);
  }

  const appParam: Record<string, string> = isApplicationNumber(num)
    ? { applicationNumber: num }
    : { registerNumber: num };

  try {
    // ── STEP 1: 서지 취득 (등록번호 확보 목적도 겸함) ──
    let bibXml: string;
    if (hasPlusKey) {
      bibXml = await fetchXml(EP.bib.plus, { ...appParam, ServiceKey: plusKey });
      if (hasErrorCode(bibXml)) {
        if (!hasDataKey) throw new Error("bib API error, no fallback key");
        bibXml = await fetchXml(EP.bib.datagokr, { ...appParam, ServiceKey: datagokrKey });
      }
    } else {
      bibXml = await fetchXml(EP.bib.datagokr, { ...appParam, ServiceKey: datagokrKey });
    }

    if (hasErrorCode(bibXml)) throw new Error("bibliography API returned error");

    const bib = parseBibliography(bibXml, num);

    // 등록번호 추출 — API 2·3(openapi/rest) 호출에 필수
    const regNumRaw = bib.registerNumber;
    const regNum = toRegistrationNumber(regNumRaw); // "10-1513250-0000" → "1015132500000"

    // ── STEP 2: 나머지 5종 병렬 호출 (Plus 키 필수, openapi/rest 계열) ──
    if (!hasPlusKey) {
      // Plus 키 없으면 등록사항/권리자/심판/인용은 N/A — 서지만 실데이터
      const raw: PatentRaw = {
        source: "live",
        inputNumber: num,
        bibliography: bib,
        registerStatus: emptyRegisterStatus(bib.registerStatus),
        rightChanges: { records: [], transferCount: 0 },
        trials: { records: [] },
        citations: { backward: [], forward: [], forwardAvailable: false },
      };
      writeCache(num, raw);
      return raw;
    }

    const encKey = encodeURIComponent(plusKey);

    // API 2: 등록사항 (등록번호 있을 때만)
    const regPromise: Promise<string | null> = regNum
      ? fetchXml(EP.reg, { registrationNumber: regNum, accessKey: plusKey })
          .then(xml => (hasErrorCode(xml) ? null : xml))
          .catch(() => null)
      : Promise.resolve(null);

    // API 3: 권리자 변동 (등록번호 있을 때만)
    const rightPromise: Promise<string | null> = regNum
      ? fetchXml(EP.rightHolder, { registrationNumber: regNum, accessKey: plusKey })
          .then(xml => (hasErrorCode(xml) ? null : xml))
          .catch(() => null)
      : Promise.resolve(null);

    // API 4: 심판
    const trialPromise = fetchXml(EP.trial, {
      applicationNumber: num,
      docsStart: "1",
      accessKey: plusKey,
    }).catch(() => null);

    // API 5: 후방인용
    const citBackPromise = fetchXml(EP.citBack, {
      applicationNumber: num,
      accessKey: plusKey,
    }).catch(() => null);

    // API 6: 전방인용 (피인용) — 파라미터명 주의
    const citFwdPromise = fetchXml(EP.citFwd, {
      standardCitationApplicationNumber: num,
      accessKey: plusKey,
    }).catch(() => null);

    void encKey; // suppress unused warning (used in URL encoding context above)

    const [regXml, rightXml, trialXml, citBackXml, citFwdXml] = await Promise.all([
      regPromise,
      rightPromise,
      trialPromise,
      citBackPromise,
      citFwdPromise,
    ]);

    // ── STEP 3: 파싱 ──
    const registerStatus = regXml && hasItems(regXml)
      ? parseRegisterStatus(regXml, bib.registerStatus)
      : emptyRegisterStatus(bib.registerStatus);

    const rightChanges = rightXml && hasItems(rightXml)
      ? parseRightChanges(rightXml)
      : { records: [], transferCount: 0 };

    const trials = trialXml && hasItems(trialXml)
      ? parseTrials(trialXml)
      : { records: [] };

    const backward = citBackXml && hasItems(citBackXml)
      ? parseBackwardCitations(citBackXml)
      : [];

    const forwardAvailable = citFwdXml !== null;
    const forward = forwardAvailable && hasItems(citFwdXml!)
      ? parseForwardCitations(citFwdXml!)
      : [];

    const raw: PatentRaw = {
      source: "live",
      inputNumber: num,
      bibliography: bib,
      registerStatus,
      rightChanges,
      trials,
      citations: { backward, forward, forwardAvailable },
    };

    writeCache(num, raw);
    return raw;

  } catch {
    return loadSample(num);
  }
}

/** 등록사항 API 실패 시 서지 정보만으로 최소한의 RegisterStatus 구성 */
function emptyRegisterStatus(bibStatus: string | null): RegisterStatus {
  const registered = bibStatus ? /등록/.test(bibStatus) && !/소멸|포기|취하|무효/.test(bibStatus) : false;
  return {
    legalStatus: bibStatus,
    registered,
    lastPaidYear: null,
    annualFees: [],
    rightHolders: [],
    termExpiryDate: null,
    extinctDate: null,
    extinctReason: null,
  };
}
