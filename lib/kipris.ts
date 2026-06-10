// ============================================================
//  lib/kipris.ts — KIPRIS REST API 6종 연동
//  호출 우선순위: ①KIPRIS Plus(plus.kipris.or.kr) → ②data.go.kr → ③샘플 폴백
//  + 파일 캐시 (월 1,000회 쿼터 방어)
// ============================================================
//
//  연동 대상 6종:
//   1) 특허실용신안 정보검색  15058788  — 서지(명칭·출원/등록일·청구항수·IPC·우선권·패밀리)
//      op  : getBibliographyDetailInfoSearch (서지 상세)
//      param: applicationNumber 또는 registerNumber, ServiceKey
//   2) 등록사항(법적상태)      15058125  — 등록번호·등록일·청구항수·존속기간만료일·소멸일·소멸원인·권리자정보·등록료(연차료)
//      ※ 권리이전(변동)은 본 API가 아님 → 아래 (3)에서 취득.
//   3) 권리자 변동 이력        15058608  — 권리자 순위·성명·변동일자 (권리이전·공유 변동의 정식 출처)
//   4) 심판사항                15065474  — 무효/권리범위확인 심판 이력
//   5) 심사인용문헌            15057617  — 후방인용(backward, 이 특허가 인용한 선행문헌)
//   6) 특허·실용 피인용문헌    15002128  — 전방인용(forward, 이 특허를 인용한 후행문헌), 월 1,000회 무료
//
//  ※ KIPRIS Plus 키(KIPRIS_PLUS_ACCESS_KEY) 로 우선 호출.
//    resultCode 30(SERVICE KEY IS NOT REGISTERED) 또는
//    31(DEADLINE_HAS_EXPIRED — 상품 미신청)이면 data.go.kr 키로 재시도.
//    data.go.kr 도 실패하면 data/samples/ 샘플 폴백.
//    상품 신청 완료 후 코드 수정 없이 실데이터 전환됨.

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
//  엔드포인트 상수 (활용신청 완료 후 여기만 검증/교체) — 상품번호 주석 명시
//  KIPRIS Plus base: http://plus.kipris.or.kr/kipo-api/kipi/{service}/{operation}
//  data.go.kr base : http://kipo-api.kipi.or.kr/openapi/service/{service}/{operation}
// ------------------------------------------------------------
const ENDPOINTS = {
  // 15058788 특허실용신안 정보검색(서지)
  bibliography: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch",
  },
  // 15058125 등록사항(법적상태)
  registerStatus: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/patUtiModInfoSearchSevice/getRegisterStatusSearchInfo",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getRegisterStatusSearchInfo",
  },
  // 15058608 권리자 변동 이력
  rightChange: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/RightHolderChangeService/getRightHolderChangeInfo",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/RightHolderChangeService/getRightHolderChangeInfo",
  },
  // 15065474 심판사항
  trial: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/TrialInfoSearchService/getTrialInfoSearch",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/TrialInfoSearchService/getTrialInfoSearch",
  },
  // 15057617 심사인용문헌(후방인용 backward)
  citationBackward: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/CitingPatentService/getCitationInfoSearch",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/CitingPatentService/getCitationInfoSearch",
  },
  // 15002128 특허·실용 피인용문헌(전방인용 forward)
  citationForward: {
    plus: "http://plus.kipris.or.kr/kipo-api/kipi/CitedPatentService/getCitedInfoSearch",
    datagokr: "http://kipo-api.kipi.or.kr/openapi/service/CitedPatentService/getCitedInfoSearch",
  },
} as const;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const SAMPLE_DIR = path.join(process.cwd(), "data", "samples");
const FETCH_TIMEOUT_MS = 8000;

// resultCode 30 = SERVICE KEY IS NOT REGISTERED
// resultCode 31 = DEADLINE_HAS_EXPIRED (상품 미신청)
// resultCode 20 = 미신청 / 22 = 횟수초과
const FALLBACK_CODES = ["20", "22", "30", "31"];

// ------------------------------------------------------------
//  입력 번호 정규화 (하이픈/공백 제거)
// ------------------------------------------------------------
export function normalizeNumber(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}

/** 출원번호(13자리, 보통 10/20/40 시작) vs 등록번호(13자리) 추정 — 파라미터 선택용 */
function isApplicationNumber(num: string): boolean {
  if (num.length < 11) return true;
  const yearGuess = Number(num.slice(2, 6));
  return yearGuess >= 1948 && yearGuess <= 2099;
}

// ------------------------------------------------------------
//  경량 XML 파서 (의존성 없이 KIPRIS 응답 처리)
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

function blocks(xml: string, name = "item"): string[] {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "gi");
  const out: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = re.exec(xml)) !== null) out.push(m[1]);
  return out;
}

function decodeXml(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&amp;/g, "&")
    .trim();
}

function toIntOrNull(s: string | null): number | null {
  if (s == null) return null;
  const n = Number(s.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(n) ? n : null;
}

function resultCode(xml: string): string | null {
  return tag(xml, "resultCode") ?? tag(xml, "returnReasonCode") ?? null;
}

// ------------------------------------------------------------
//  파일 캐시 (월 1,000회 쿼터 방어)
// ------------------------------------------------------------
function cacheKey(num: string): string {
  return path.join(CACHE_DIR, `${num}.json`);
}

function readCache(num: string): PatentRaw | null {
  try {
    const p = cacheKey(num);
    if (!fs.existsSync(p)) return null;
    return JSON.parse(fs.readFileSync(p, "utf-8")) as PatentRaw;
  } catch {
    return null;
  }
}

function writeCache(num: string, data: PatentRaw): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheKey(num), JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // 캐시 실패는 치명적이지 않음
  }
}

// ------------------------------------------------------------
//  샘플 폴백
// ------------------------------------------------------------
const SAMPLE_FILES = ["sample-battery.json", "sample-ai-dx.json", "sample-eco-pkg.json"];

function loadSample(num: string): PatentRaw {
  const map: Record<string, string> = {
    "1020210012345": "sample-battery.json",
    "1020190098765": "sample-ai-dx.json",
    "1020170054321": "sample-eco-pkg.json",
  };
  const file = map[num] ?? SAMPLE_FILES[0];
  const p = path.join(SAMPLE_DIR, file);
  const data = JSON.parse(fs.readFileSync(p, "utf-8")) as PatentRaw;
  return { ...data, inputNumber: num || data.inputNumber, source: "sample" };
}

export function listSamples(): { number: string; title: string; tag: string }[] {
  return SAMPLE_FILES.map((f) => {
    const data = JSON.parse(fs.readFileSync(path.join(SAMPLE_DIR, f), "utf-8")) as PatentRaw;
    return {
      number: data.inputNumber,
      title: data.bibliography.inventionTitle,
      tag: data.bibliography.ipcCodes[0] ?? "",
    };
  });
}

// ------------------------------------------------------------
//  HTTP 호출 유틸 (타임아웃 포함)
// ------------------------------------------------------------
async function fetchXml(url: string, params: Record<string, string>, serviceKey: string): Promise<string> {
  const qs = new URLSearchParams({ ...params, ServiceKey: serviceKey }).toString();
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

/** FALLBACK_CODES 에 해당하는 resultCode면 throw (상위에서 다음 단계 폴백 트리거) */
function assertUsable(xml: string): void {
  const code = resultCode(xml);
  if (code && FALLBACK_CODES.includes(code)) {
    throw new Error(`KIPRIS resultCode ${code}`);
  }
  if (/SERVICE\s*KEY\s*IS\s*NOT\s*REGISTERED/i.test(xml)) {
    throw new Error("KIPRIS SERVICE KEY IS NOT REGISTERED");
  }
}

/**
 * 3단 폴백 API 호출:
 *   ① KIPRIS Plus 키가 있으면 plus.kipris.or.kr 로 호출
 *   ② 실패(resultCode 30/31 포함) 시 data.go.kr 키로 재시도
 *   ③ 둘 다 실패 시 throw → 호출 측에서 샘플 폴백
 */
async function callApi(
  endpointPair: { plus: string; datagokr: string },
  params: Record<string, string>
): Promise<string> {
  const plusKey = process.env.KIPRIS_PLUS_ACCESS_KEY ?? "";
  const datagokrKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";

  // ① KIPRIS Plus
  if (plusKey && plusKey !== "발급받은_KIPRIS_Plus_AccessKey_입력") {
    try {
      const xml = await fetchXml(endpointPair.plus, params, plusKey);
      assertUsable(xml);
      return xml;
    } catch {
      // 31(상품 미신청) 등 → ②로 폴백
    }
  }

  // ② data.go.kr
  if (datagokrKey && datagokrKey !== "발급받은_서비스키_입력") {
    const xml = await fetchXml(endpointPair.datagokr, params, datagokrKey);
    assertUsable(xml); // 여기서도 실패하면 throw → 샘플 폴백
    return xml;
  }

  throw new Error("no usable API key");
}

// ------------------------------------------------------------
//  응답 파서 6종
// ------------------------------------------------------------
function parseBibliography(xml: string, num: string): Bibliography {
  const body = blocks(xml, "item")[0] ?? xml;
  const ipcRaw = tag(body, "ipcNumber") ?? tag(body, "ipcCode") ?? "";
  const ipcCodes = ipcRaw
    ? ipcRaw.split(/[,|;]/).map((s) => s.trim()).filter(Boolean)
    : tagAll(xml, "ipcNumber");
  return {
    applicationNumber: tag(body, "applicationNumber") ?? num,
    registerNumber: tag(body, "registerNumber"),
    inventionTitle:
      tag(body, "inventionTitle") ?? tag(body, "inventionName") ?? "명칭 미확인",
    applicationDate: tag(body, "applicationDate"),
    registerDate: tag(body, "registerDate"),
    openDate: tag(body, "openDate") ?? tag(body, "publicationDate"),
    claimCount: toIntOrNull(tag(body, "claimCount") ?? tag(body, "claimNum")),
    ipcCodes,
    applicantName: tag(body, "applicantName"),
    priorityNumber: tag(body, "priorityNumber"),
    familyCount: toIntOrNull(tag(body, "familyCount")),
  };
}

/** 15058125 등록사항(법적상태). 권리이전 변동은 여기서 다루지 않음(→ parseRightChanges). */
function parseRegisterStatus(xml: string): RegisterStatus {
  const legal = tag(xml, "registrationStatus") ?? tag(xml, "lastValue") ?? tag(xml, "legalStatus");
  const registered = legal ? /등록|존속|유지/.test(legal) && !/소멸|포기|무효/.test(legal) : false;

  const fees: AnnualFeeRecord[] = blocks(xml, "item")
    .map((b): AnnualFeeRecord | null => {
      const yr = toIntOrNull(tag(b, "paymentYear") ?? tag(b, "annualYear"));
      if (yr == null) return null;
      return { paymentYear: yr, paymentDate: tag(b, "paymentDate") };
    })
    .filter((x): x is AnnualFeeRecord => x !== null);
  const lastPaidYear = fees.length ? Math.max(...fees.map((f) => f.paymentYear)) : null;

  const holders = tagAll(xml, "rightHolderName").length
    ? tagAll(xml, "rightHolderName")
    : tagAll(xml, "applicantName");

  return {
    legalStatus: legal,
    registered,
    lastPaidYear,
    annualFees: fees,
    rightHolders: holders,
    termExpiryDate: tag(xml, "termExpirationDate") ?? tag(xml, "expirationDate"),
    extinctDate: tag(xml, "extinctionDate") ?? tag(xml, "extinctDate"),
    extinctReason: tag(xml, "extinctionReason") ?? tag(xml, "extinctReason"),
  };
}

/** 15058608 권리자 변동 이력 */
function parseRightChanges(xml: string): RightChanges {
  const records: RightChangeRecord[] = blocks(xml, "item").map((b) => ({
    rank: toIntOrNull(tag(b, "rank") ?? tag(b, "rightHolderRank")),
    holderName: tag(b, "rightHolderName") ?? tag(b, "name"),
    changeDate: tag(b, "changeDate") ?? tag(b, "registrationDate"),
    changeType: tag(b, "changeType") ?? tag(b, "changeReason"),
  }));
  const transferEvents = records.filter((r) =>
    r.changeType ? /이전|양도|합병/.test(r.changeType) : false
  );
  const transferCount = transferEvents.length
    ? transferEvents.length
    : Math.max(0, records.length - 1);
  return { records, transferCount };
}

function parseTrials(xml: string): Trials {
  const records: TrialRecord[] = blocks(xml, "item").map((b) => {
    const status = tag(b, "trialStatus") ?? tag(b, "status");
    const alive = status ? /계류|진행|심리/.test(status) : false;
    return {
      trialType: tag(b, "trialType") ?? tag(b, "trialName") ?? "심판",
      trialNumber: tag(b, "trialNumber"),
      status,
      alive,
      result: tag(b, "trialResult") ?? tag(b, "result"),
    };
  });
  return { records };
}

function parseCitationList(xml: string): CitationRecord[] {
  return blocks(xml, "item").map((b) => ({
    citedDocNumber:
      tag(b, "citationNumber") ??
      tag(b, "citedDocNumber") ??
      tag(b, "citingNumber") ??
      tag(b, "documentNumber") ??
      "-",
    citedTitle: tag(b, "citationTitle") ?? tag(b, "inventionTitle") ?? tag(b, "title"),
  }));
}

function parseCitations(backwardXml: string, forwardXml: string | null): Citations {
  const backward = parseCitationList(backwardXml);
  const forward = forwardXml ? parseCitationList(forwardXml) : [];
  return { backward, forward, forwardAvailable: forwardXml !== null };
}

// ------------------------------------------------------------
//  공개 진입점: 특허 1건 원천 데이터 취득
// ------------------------------------------------------------
export async function getPatentRaw(inputNumber: string): Promise<PatentRaw> {
  const num = normalizeNumber(inputNumber);

  // 1) 캐시 우선
  const cached = readCache(num);
  if (cached) return cached;

  const plusKey = process.env.KIPRIS_PLUS_ACCESS_KEY ?? "";
  const datagokrKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";
  const hasAnyKey =
    (plusKey && plusKey !== "발급받은_KIPRIS_Plus_AccessKey_입력") ||
    (datagokrKey && datagokrKey !== "발급받은_서비스키_입력");

  // 2) 사용 가능한 키가 없으면 즉시 샘플 폴백
  if (!hasAnyKey) {
    return loadSample(num);
  }

  const param: Record<string, string> = isApplicationNumber(num)
    ? { applicationNumber: num }
    : { registerNumber: num };

  try {
    // 핵심 5종 동시 호출 (3단 폴백 callApi 사용)
    const [bibXml, regXml, changeXml, trialXml, citBackXml] = await Promise.all([
      callApi(ENDPOINTS.bibliography, param),
      callApi(ENDPOINTS.registerStatus, param),
      callApi(ENDPOINTS.rightChange, param),
      callApi(ENDPOINTS.trial, param),
      callApi(ENDPOINTS.citationBackward, param),
    ]);

    // 피인용(전방, 15002128)은 별도 상품 — 실패해도 전체를 막지 않음
    let citForwardXml: string | null = null;
    try {
      citForwardXml = await callApi(ENDPOINTS.citationForward, param);
    } catch {
      citForwardXml = null;
    }

    const raw: PatentRaw = {
      source: "live",
      inputNumber: num,
      bibliography: parseBibliography(bibXml, num),
      registerStatus: parseRegisterStatus(regXml),
      rightChanges: parseRightChanges(changeXml),
      trials: parseTrials(trialXml),
      citations: parseCitations(citBackXml, citForwardXml),
    };

    writeCache(num, raw);
    return raw;
  } catch {
    // 키 미등록/네트워크/파싱 실패 → 샘플 폴백 (UI 데모 배지 표시)
    return loadSample(num);
  }
}
