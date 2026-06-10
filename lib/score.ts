// ============================================================
//  lib/score.ts — 4축 점수 + 담보 적격성 관문 + 등급 A~E (코드 직산)
//  LLM은 점수 산출에 관여하지 않는다 — 전부 결정론적 계산.
// ============================================================

import type {
  PatentRaw,
  Metric,
  AxisScore,
  GateResult,
  Grade,
  Assessment,
} from "./types";
import { computeMetrics, metricById } from "./metrics";

const clamp = (n: number) => Math.max(0, Math.min(100, Math.round(n)));

/** rawValue 안전 추출 */
function num(m: Metric | undefined): number | null {
  if (!m) return null;
  return typeof m.rawValue === "number" ? m.rawValue : null;
}

// ------------------------------------------------------------
//  담보 적격성 관문 (금융적합성의 선결 조건)
// ------------------------------------------------------------
export function evaluateGate(raw: PatentRaw, metrics: Metric[]): GateResult {
  const reg = raw.registerStatus;
  const ownerCount = reg.rightHolders.length;
  const aliveInvalidation = raw.trials.records.some(
    (t) => /무효/.test(t.trialType) && t.alive
  );
  const alivePendingTrial = raw.trials.records.some((t) => t.alive);

  const legalAlive = reg.registered;
  const soleOwner = ownerCount === 1; // 공유면 단독 아님 → 관문 실패
  const noPendingTrial = !aliveInvalidation && !alivePendingTrial;

  const reasons: string[] = [];
  if (!legalAlive) reasons.push("법적상태가 등록 유지 상태가 아님(소멸·포기·만료 등) — 담보 설정 불가");
  if (ownerCount === 0) reasons.push("권리자 정보 결측 — 단독 권리 확인 불가");
  else if (!soleOwner) reasons.push(`공유 특허(${ownerCount}인) — 담보 설정 시 공유자 전원 동의 필요`);
  if (aliveInvalidation) reasons.push("무효심판 계류 중 — 권리 소멸 위험으로 담보가치 불확정");
  else if (alivePendingTrial) reasons.push("심판 계류 중 — 권리범위 확정 전");

  const passed = legalAlive && soleOwner && noPendingTrial;

  // 관문 미통과 시 등급 상한 — 미세 차등
  let gradeCeiling: Grade | null = null;
  if (!legalAlive) gradeCeiling = "E"; // 소멸/만료는 최하
  else if (aliveInvalidation) gradeCeiling = "D"; // 무효 계류는 D 이하
  else if (alivePendingTrial) gradeCeiling = "C";
  else if (!soleOwner) gradeCeiling = "C"; // 공유는 C 이하

  return {
    passed,
    legalAlive,
    soleOwner,
    noPendingTrial,
    reasons,
    gradeCeiling,
  };
}

// ------------------------------------------------------------
//  4축 점수
//   권리성(3·6·7·8) / 기술성(9·12·13) / 활용성(2·4) / 금융적합성(1·5·6 관문)
// ------------------------------------------------------------
export function computeAxes(raw: PatentRaw, metrics: Metric[], gate: GateResult): AxisScore[] {
  // --- 권리성: 청구항 수, 단독성, 무효심판, 권리범위확인심판 ---
  const claim = num(metricById(metrics, 3)); // 청구항 수
  const owners = raw.registerStatus.rightHolders.length;
  const invalidations = raw.trials.records.filter((t) => /무효/.test(t.trialType));
  const aliveInval = invalidations.some((t) => t.alive);
  const scopeTrials = num(metricById(metrics, 8)) ?? 0;

  let rights = 50;
  if (claim != null) rights += Math.min(25, claim * 1.8); // 청구항 많을수록 권리 두터움(상한)
  rights += owners === 1 ? 15 : owners > 1 ? -10 : 0; // 단독 가점/공유 감점
  rights -= aliveInval ? 35 : invalidations.length > 0 ? 8 : 0; // 무효심판 계류 큰 감점
  rights -= scopeTrials > 0 ? 5 : 0;

  // --- 기술성: 후방인용 수(선행기술 밀도), 전방인용(피인용, 기술 영향력), IPC 다양성 ---
  const back = num(metricById(metrics, 9)) ?? 0;
  const ipcCount = raw.bibliography.ipcCodes.length;
  // 전방인용은 피인용 API 미응답 시 N/A → 점수에 미반영(추정 금지). available일 때만 가점.
  const fwdAvailable = raw.citations.forwardAvailable;
  const fwd = fwdAvailable ? raw.citations.forward.length : 0;
  let tech = 45;
  tech += Math.min(22, back * 4); // 후방인용 — 기술 검토 충실도(상한)
  tech += fwdAvailable ? Math.min(20, fwd * 4.5) : 0; // 전방인용 — 기술 영향력(상한), N/A면 미반영
  tech += Math.min(13, ipcCount * 4.5); // IPC 다분야 가점
  if (back === 0 && fwd === 0 && ipcCount === 0) tech = 40; // 데이터 빈약 시 보수적

  // --- 활용성: 잔존 존속기간, 연차료 납부(유지 의지) ---
  const remainDays = num(metricById(metrics, 2));
  const lastPaid = num(metricById(metrics, 4));
  let utility = 40;
  if (remainDays != null) {
    if (remainDays <= 0) utility = 10; // 만료
    else utility += Math.min(35, (remainDays / 365.25) * 3.2); // 잔존기간 길수록 가점
  }
  if (lastPaid != null) utility += Math.min(20, lastPaid * 2.5); // 연차 유지 가점

  // --- 금융적합성: 관문 통과 여부 + 법적상태 + 이전횟수 안정성 ---
  const transfers = num(metricById(metrics, 5)) ?? 0;
  let finance = gate.passed ? 78 : 35; // 관문 통과가 결정적
  finance += raw.registerStatus.registered ? 10 : -30;
  finance -= transfers >= 3 ? 12 : transfers > 0 ? 4 : 0; // 잦은 이전은 권리 불안정 신호
  if (owners > 1) finance -= 12;
  if (aliveInval) finance -= 25;

  return [
    { key: "rights", label: "권리성", score: clamp(rights), metricIds: [3, 6, 7, 8] },
    { key: "tech", label: "기술성", score: clamp(tech), metricIds: [9, 12, 13] },
    { key: "utility", label: "활용성", score: clamp(utility), metricIds: [2, 4] },
    { key: "finance", label: "금융적합성", score: clamp(finance), metricIds: [1, 5, 6] },
  ];
}

// ------------------------------------------------------------
//  종합 점수 → 등급 (관문 상한 적용)
// ------------------------------------------------------------
const GRADE_ORDER: Grade[] = ["A", "B", "C", "D", "E"];

function scoreToGrade(score: number): Grade {
  if (score >= 82) return "A";
  if (score >= 68) return "B";
  if (score >= 54) return "C";
  if (score >= 40) return "D";
  return "E";
}

/** 상한 적용: ceiling보다 높은(앞선) 등급으로 못 올라가게 제한 */
function applyCeiling(grade: Grade, ceiling: Grade | null): Grade {
  if (!ceiling) return grade;
  const gi = GRADE_ORDER.indexOf(grade);
  const ci = GRADE_ORDER.indexOf(ceiling);
  return gi < ci ? ceiling : grade; // index 작을수록 좋은 등급 → ceiling 미만이면 끌어내림
}

// 금융적합성 가중(담보 적합도 평가이므로 finance 비중을 높임)
const AXIS_WEIGHT: Record<string, number> = {
  rights: 0.3,
  tech: 0.15,
  utility: 0.2,
  finance: 0.35,
};

export function assess(raw: PatentRaw): Assessment {
  const metrics = computeMetrics(raw);
  const gate = evaluateGate(raw, metrics);
  const axes = computeAxes(raw, metrics, gate);

  const totalScore = clamp(
    axes.reduce((sum, a) => sum + a.score * (AXIS_WEIGHT[a.key] ?? 0.25), 0)
  );

  const baseGrade = scoreToGrade(totalScore);
  const grade = applyCeiling(baseGrade, gate.gradeCeiling);

  return { raw, metrics, axes, totalScore, gate, grade };
}
