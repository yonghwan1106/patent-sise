// ============================================================
//  특허시세 — 핵심 타입 정의
//  KIPRIS 6종 API 원천 데이터 → 13지표 → 4축 점수 → 등급
// ============================================================

/** 데이터 출처 구분 — UI 배지 및 감사가능성 표기에 사용 */
export type DataSource = "live" | "sample";

/** 결측/신뢰도 표시 — 추정값 생성 금지(감사가능성 핵심) */
export type Confidence = "high" | "medium" | "na";

/** 원천 KIPRIS API 6종 식별자 — 각 지표 카드의 출처 라벨 */
export type KiprisApi =
  | "patUtiModInfoSearch" // 15058788 특허실용신안 정보검색(서지)
  | "registerStatus" // 15058125 등록사항(법적상태: 등록번호·등록일·청구항수·존속기간만료일·소멸일·소멸원인·권리자정보·등록료)
  | "rightChange" // 15058608 권리자 변동 이력(권리자 순위·성명·변동일자 — 권리이전·공유 변동 출처)
  | "trial" // 15065474 심판사항
  | "citationBackward" // 15057617 심사인용문헌(후방인용 backward)
  | "citationForward"; // 15002128 특허·실용 피인용문헌(전방인용 forward)

export const KIPRIS_API_LABEL: Record<KiprisApi, string> = {
  patUtiModInfoSearch: "KIPRIS 특허서지(15058788)",
  registerStatus: "KIPRIS 등록사항(15058125)",
  rightChange: "KIPRIS 권리자변동이력(15058608)",
  trial: "KIPRIS 심판사항(15065474)",
  citationBackward: "KIPRIS 심사인용문헌(15057617)",
  citationForward: "KIPRIS 피인용문헌(15002128)",
};

// ------------------------------------------------------------
//  원천 데이터 모델 (KIPRIS 응답 정규화 결과)
// ------------------------------------------------------------

/** 서지정보 — 특허실용신안 정보검색(15058788) */
export interface Bibliography {
  applicationNumber: string; // 출원번호
  registerNumber: string | null; // 등록번호 (원문 예: "10-1513250-0000")
  inventionTitle: string; // 발명의 명칭
  applicationDate: string | null; // 출원일 YYYYMMDD 또는 YYYY.MM.DD
  registerDate: string | null; // 등록일
  openDate: string | null; // 공개일
  claimCount: number | null; // 청구항 수
  ipcCodes: string[]; // IPC 분류기호
  applicantName: string | null; // 출원인
  priorityNumber: string | null; // 우선권 번호 (없으면 null → 지표 N/A)
  familyCount: number | null; // 패밀리 수 (없으면 null)
  // 서지 API 부가 필드 (법적상태·최종처분 — 등록사항 API 체이닝 전 보조 판정용)
  registerStatus: string | null; // 예: "등록" | "소멸" | "포기" | "거절"
  finalDisposal: string | null; // 예: "등록결정(일반)" | "포기(등록료 미납)"
}

/** 연차료 납부 1건 */
export interface AnnualFeeRecord {
  paymentYear: number; // 납부 연차(몇 년차)
  paymentDate: string | null; // 납부일 YYYYMMDD
}

/**
 * 등록사항(법적상태) — 15058125
 * 실제 필드: 등록번호·등록일자·청구항수·존속기간만료일자·소멸일자·소멸원인·권리자정보·등록료(연차료).
 * ※ 권리이전(변동) 이력은 본 API가 아니라 별도 「권리자 변동 이력」(15058608)에서 취득한다.
 */
export interface RegisterStatus {
  legalStatus: string | null; // 원문 법적상태 텍스트 (예: "등록", "소멸", "포기")
  registered: boolean; // 등록 유지 여부(코드 판정)
  lastPaidYear: number | null; // 현재 납부된 최종 연차(등록료)
  annualFees: AnnualFeeRecord[];
  rightHolders: string[]; // 현재 권리자 목록(공유 판정용 — 등록사항의 권리자정보)
  termExpiryDate: string | null; // 존속기간 만료일자 YYYYMMDD
  extinctDate: string | null; // 소멸일자
  extinctReason: string | null; // 소멸원인
}

/** 권리자 변동 1건 — 권리자 변동 이력(15058608): 순위·성명·변동일자 */
export interface RightChangeRecord {
  rank: number | null; // 권리자 순위
  holderName: string | null; // 권리자 성명
  changeDate: string | null; // 변동일자 YYYYMMDD
  changeType: string | null; // 변동 구분(설정·이전·말소 등, 있으면)
}

/** 권리자 변동 이력 — 15058608 (권리이전·공유권리자 변동의 정식 출처) */
export interface RightChanges {
  records: RightChangeRecord[];
  transferCount: number; // 권리이전(변동) 횟수 — 변동 이력에서 산출
}

/** 심판 1건 */
export interface TrialRecord {
  trialType: string; // 심판유형 (무효심판 / 권리범위확인심판 등)
  trialNumber: string | null;
  status: string | null; // 진행상태 (계류/인용/기각/각하 등)
  alive: boolean; // 계류 중(생존) 여부
  result: string | null; // 결과
}

/** 심판사항 — 무효/권리범위확인 심판 (15065474) */
export interface Trials {
  records: TrialRecord[];
}

/** 인용/피인용 문헌 1건 */
export interface CitationRecord {
  citedDocNumber: string;
  citedTitle: string | null;
}

/**
 * 인용 관계 2종:
 *  - backward(후방인용): 이 특허가 인용한 선행문헌 — 심사인용문헌(15057617)
 *  - forward(전방인용/피인용): 이 특허를 인용한 후행문헌 — 피인용문헌(15002128)
 * 두 API는 별도 상품이며 각각 호출 실패 시 빈 배열(→ 지표 N/A) 폴백한다.
 */
export interface Citations {
  backward: CitationRecord[];
  forward: CitationRecord[];
  forwardAvailable: boolean; // 피인용 API 응답 성공 여부(false면 지표 N/A)
}

/** KIPRIS 6종 정규화 결과 묶음 */
export interface PatentRaw {
  source: DataSource;
  inputNumber: string; // 사용자가 입력한 번호(출원/등록)
  bibliography: Bibliography;
  registerStatus: RegisterStatus; // 15058125
  rightChanges: RightChanges; // 15058608
  trials: Trials; // 15065474
  citations: Citations; // 15057617(backward) + 15002128(forward)
}

// ------------------------------------------------------------
//  13지표 모델
// ------------------------------------------------------------

export interface Metric {
  id: number; // 1~12
  key: string;
  label: string;
  value: string; // 표시값 (N/A 포함)
  rawValue: number | string | boolean | null;
  confidence: Confidence;
  source: KiprisApi; // 원천 API 출처
  note?: string; // 보조 설명
}

// ------------------------------------------------------------
//  4축 점수 / 등급 / 관문
// ------------------------------------------------------------

export type AxisKey = "rights" | "tech" | "utility" | "finance";

export interface AxisScore {
  key: AxisKey;
  label: string;
  score: number; // 0~100
  metricIds: number[]; // 구성 지표
}

export type Grade = "A" | "B" | "C" | "D" | "E";

/** 담보 적격성 관문 진단 결과 */
export interface GateResult {
  passed: boolean;
  // 개별 관문 항목
  legalAlive: boolean; // 법적상태 유지
  soleOwner: boolean; // 단독 권리(공유 아님)
  noPendingTrial: boolean; // 무효/권리범위확인 심판 계류 없음
  reasons: string[]; // 불통과 사유(통과 시 빈 배열)
  gradeCeiling: Grade | null; // 관문 미통과 시 등급 상한
}

export interface Assessment {
  raw: PatentRaw;
  metrics: Metric[];
  axes: AxisScore[];
  totalScore: number; // 0~100 (4축 가중 평균)
  gate: GateResult;
  grade: Grade;
}
