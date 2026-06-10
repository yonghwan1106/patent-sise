// ============================================================
//  lib/kipris.ts — KIPRIS 계열 data.go.kr REST API 6종 연동
//  + 키 미등록(resultCode 30) 시 샘플 자동 폴백 + 파일 캐시
// ============================================================
//
//  연동 대상 6종 (data.go.kr / 한국특허정보원 KIPRIS Plus):
//   1) 특허실용신안 정보검색  15058788  — 서지(명칭·출원/등록일·청구항수·IPC·우선권·패밀리)
//      base: http://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice
//      op  : getBibliographyDetailInfoSearch (서지 상세)
//      param: applicationNumber 또는 registerNumber, ServiceKey
//   2) 등록사항(법적상태)      15058125  — 등록번호·등록일·청구항수·존속기간만료일·소멸일·소멸원인·권리자정보·등록료(연차료)
//      ※ 권리이전(변동)은 본 API가 아님 → 아래 (3)에서 취득.
//   3) 권리자 변동 이력        15058608  — 권리자 순위·성명·변동일자 (권리이전·공유 변동의 정식 출처)
//   4) 심판사항                15065474  — 무효/권리범위확인 심판 이력
//   5) 심사인용문헌            15057617  — 후방인용(backward, 이 특허가 인용한 선행문헌)
//   6) 특허·실용 피인용문헌    15002128  — 전방인용(forward, 이 특허를 인용한 후행문헌), 월 1,000회 무료
//
//  ※ 각 API의 정확한 operation·파라미터는 data.go.kr/data/{ID}/openapi.do 문서 기준.
//    문서 페이지가 스크래핑 차단되어 자동확인 불가했던 항목은 KIPRIS Plus의 알려진
//    openapi 패턴(kipo-api.kipi.or.kr/openapi/service/...)으로 구현했으며, 활용신청
//    완료 후 endpoint/op 상수만 교체하면 실데이터로 전환되는 구조다.
//
//  ※ 현재 계정 키는 KIPRIS 활용신청 전 → 호출 시 resultCode 30
//    (SERVICE KEY IS NOT REGISTERED ERROR) 반환 → 자동 샘플 폴백.

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
// ------------------------------------------------------------
const ENDPOINTS = {
  // 15058788 특허실용신안 정보검색(서지)
  bibliography:
    "http://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getBibliographyDetailInfoSearch",
  // 15058125 등록사항(법적상태)
  registerStatus:
    "http://kipo-api.kipi.or.kr/openapi/service/patUtiModInfoSearchSevice/getRegisterStatusSearchInfo",
  // 15058608 권리자 변동 이력
  rightChange:
    "http://kipo-api.kipi.or.kr/openapi/service/RightHolderChangeService/getRightHolderChangeInfo",
  // 15065474 심판사항
  trial:
    "http://kipo-api.kipi.or.kr/openapi/service/TrialInfoSearchService/getTrialInfoSearch",
  // 15057617 심사인용문헌(후방인용 backward)
  citationBackward:
    "http://kipo-api.kipi.or.kr/openapi/service/CitingPatentService/getCitationInfoSearch",
  // 15002128 특허·실용 피인용문헌(전방인용 forward)
  citationForward:
    "http://kipo-api.kipi.or.kr/openapi/service/CitedPatentService/getCitedInfoSearch",
} as const;

const CACHE_DIR = path.join(process.cwd(), ".cache");
const SAMPLE_DIR = path.join(process.cwd(), "data", "samples");
const FETCH_TIMEOUT_MS = 8000;

// resultCode 30 = SERVICE KEY IS NOT REGISTERED ERROR
const KEY_UNREGISTERED_CODES = ["30", "20", "22"]; // 30 미등록 / 20 미신청 / 22 횟수초과

// ------------------------------------------------------------
//  입력 번호 정규화 (하이픈/공백 제거)
// ------------------------------------------------------------
export function normalizeNumber(input: string): string {
  return (input || "").replace(/[^0-9]/g, "");
}

/** 출원번호(13자리, 보통 10/20/40 시작) vs 등록번호(13자리) 추정 — 파라미터 선택용 */
function isApplicationNumber(num: string): boolean {
  // 출원번호는 통상 연도 4자리를 포함(예: 10 2021 0012345). 등록번호는 10으로 시작하는 7자리 본번 패턴.
  // 단순 휴리스틱: 13자리이고 3~6번째가 유효 연도(19xx~20xx)면 출원번호로 본다.
  if (num.length < 11) return true;
  const yearGuess = Number(num.slice(2, 6));
  return yearGuess >= 1948 && yearGuess <= 2099;
}

// ------------------------------------------------------------
//  경량 XML 파서 (의존성 없이 KIPRIS 응답 처리)
//   - <tag>value</tag> 추출, 반복 항목(<item>) 분해
// ------------------------------------------------------------

/** 첫 번째 매칭 태그의 텍스트 반환(없으면 null) */
function tag(xml: string, name: string): string | null {
  const re = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`, "i");
  const m = xml.match(re);
  if (!m) return null;
  return decodeXml(m[1].trim()) || null;
}

/** 모든 매칭 태그의 텍스트 배열 반환 */
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

/** 반복 블록(<item>...</item>) 단위로 분해 */
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

/** KIPRIS 응답에서 resultCode 추출 (에러/키미등록 판별) */
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
    const data = JSON.parse(fs.readFileSync(p, "utf-8")) as PatentRaw;
    return data;
  } catch {
    return null;
  }
}

function writeCache(num: string, data: PatentRaw): void {
  try {
    if (!fs.existsSync(CACHE_DIR)) fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(cacheKey(num), JSON.stringify(data, null, 2), "utf-8");
  } catch {
    // 캐시 실패는 치명적이지 않음 — 무시
  }
}

// ------------------------------------------------------------
//  샘플 폴백
// ------------------------------------------------------------
const SAMPLE_FILES = ["sample-battery.json", "sample-ai-dx.json", "sample-eco-pkg.json"];

/** 샘플 매핑: 입력번호 → 특정 샘플 (없으면 첫 샘플) */
function loadSample(num: string): PatentRaw {
  const map: Record<string, string> = {
    "1020210012345": "sample-battery.json",
    "1020190098765": "sample-ai-dx.json",
    "1020170054321": "sample-eco-pkg.json",
  };
  const file = map[num] ?? SAMPLE_FILES[0];
  const p = path.join(SAMPLE_DIR, file);
  const data = JSON.parse(fs.readFileSync(p, "utf-8")) as PatentRaw;
  // 입력번호는 사용자가 넣은 값으로 유지(시연 일관성)
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
async function callApi(url: string, params: Record<string, string>): Promise<string> {
  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";
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

/** 키 미등록/에러 응답이면 throw → 상위에서 샘플 폴백 */
function assertRegistered(xml: string): void {
  const code = resultCode(xml);
  if (code && KEY_UNREGISTERED_CODES.includes(code)) {
    throw new Error(`KIPRIS resultCode ${code} (key not registered)`);
  }
  // 에러 헤더 패턴
  if (/SERVICE\s*KEY\s*IS\s*NOT\s*REGISTERED/i.test(xml)) {
    throw new Error("KIPRIS SERVICE KEY IS NOT REGISTERED");
  }
}

// ------------------------------------------------------------
//  응답 파서 6종 (KIPRIS 표준 필드명 기준)
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

/** 15058125 등록사항(법적상태). 권리이전 변동은 여기서 다루지 않는다(→ parseRightChanges). */
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

/** 15058608 권리자 변동 이력 — 순위·성명·변동일자. 권리이전(변동) 횟수 산출. */
function parseRightChanges(xml: string): RightChanges {
  const records: RightChangeRecord[] = blocks(xml, "item").map((b) => ({
    rank: toIntOrNull(tag(b, "rank") ?? tag(b, "rightHolderRank")),
    holderName: tag(b, "rightHolderName") ?? tag(b, "name"),
    changeDate: tag(b, "changeDate") ?? tag(b, "registrationDate"),
    changeType: tag(b, "changeType") ?? tag(b, "changeReason"),
  }));
  // 권리이전 횟수: 명시적 이전 구분이 있으면 그 수, 없으면 변동 이벤트 수 - 1(최초 설정 제외, 음수 방지)
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

/**
 * backward(15057617 심사인용문헌) + forward(15002128 피인용문헌) 결합.
 * forwardXml 이 null 이면 피인용 API 호출 실패 → forwardAvailable=false (지표 N/A).
 */
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

  const serviceKey = process.env.DATA_GO_KR_SERVICE_KEY ?? "";
  const param: Record<string, string> = isApplicationNumber(num)
    ? { applicationNumber: num }
    : { registerNumber: num };

  // 2) 키 없거나 실호출 실패 → 샘플 폴백
  if (!serviceKey || serviceKey === "발급받은_서비스키_입력") {
    return loadSample(num);
  }

  try {
    // 핵심 5종은 동시 호출. 피인용(forward, 15002128)은 별도 상품 →
    // 실패해도 전체를 막지 않도록 독립적으로 처리(실패 시 null → 지표 N/A).
    const [bibXml, regXml, changeXml, trialXml, citBackXml] = await Promise.all([
      callApi(ENDPOINTS.bibliography, param),
      callApi(ENDPOINTS.registerStatus, param),
      callApi(ENDPOINTS.rightChange, param),
      callApi(ENDPOINTS.trial, param),
      callApi(ENDPOINTS.citationBackward, param),
    ]);

    // 키 미등록(resultCode 30) 감지 → 폴백
    assertRegistered(bibXml);

    // 피인용 API는 개별 try — 실패해도 forwardAvailable=false 로 N/A 처리
    let citForwardXml: string | null = null;
    try {
      const xml = await callApi(ENDPOINTS.citationForward, param);
      assertRegistered(xml);
      citForwardXml = xml;
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

    // 3) 성공 → 캐시 저장(재호출 방지)
    writeCache(num, raw);
    return raw;
  } catch {
    // 키 미등록/네트워크/파싱 실패 → 샘플 폴백 (UI 데모 배지 표시)
    return loadSample(num);
  }
}
