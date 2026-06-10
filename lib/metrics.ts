// ============================================================
//  lib/metrics.ts — 정량지표 13종 직산 (LLM 미개입)
//  결측 시 "N/A + 신뢰도" 표기, 추정값 생성 금지(감사가능성 핵심)
// ============================================================

import type { PatentRaw, Metric } from "./types";

const PATENT_TERM_YEARS = 20; // 특허 존속기간: 출원일+20년

/** YYYYMMDD → Date (유효성 검사 포함) */
function parseYmd(ymd: string | null): Date | null {
  if (!ymd) return null;
  const s = ymd.replace(/[^0-9]/g, "");
  if (s.length < 8) return null;
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(4, 6));
  const d = Number(s.slice(6, 8));
  if (!y || !m || !d) return null;
  const dt = new Date(y, m - 1, d);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

/** 두 날짜 간 일수 */
function daysBetween(a: Date, b: Date): number {
  return Math.round((b.getTime() - a.getTime()) / 86400000);
}

function fmtYears(days: number): string {
  const y = days / 365.25;
  return `${y.toFixed(1)}년`;
}

/**
 * 13지표 산출. 모든 값은 원천 필드 직산 — 추정 없음.
 * 결측은 value "N/A", confidence "na".
 */
export function computeMetrics(raw: PatentRaw): Metric[] {
  const { bibliography: bib, registerStatus: reg, rightChanges, trials, citations } = raw;
  const today = new Date();
  const appDate = parseYmd(bib.applicationDate);
  const regDate = parseYmd(bib.registerDate);

  const metrics: Metric[] = [];

  // 1. 법적상태(등록유지/소멸/만료)
  metrics.push({
    id: 1,
    key: "legalStatus",
    label: "법적상태",
    value: reg.legalStatus ?? "N/A",
    rawValue: reg.legalStatus,
    confidence: reg.legalStatus ? "high" : "na",
    source: "registerStatus",
    note: reg.registered ? "등록 유지 중" : "등록 유지 아님(소멸·포기·만료 등)",
  });

  // 2. 잔존 존속기간 (출원일+20년 − 오늘)
  if (appDate) {
    const expiry = new Date(appDate);
    expiry.setFullYear(expiry.getFullYear() + PATENT_TERM_YEARS);
    const remainDays = daysBetween(today, expiry);
    const expired = remainDays <= 0;
    metrics.push({
      id: 2,
      key: "remainingTerm",
      label: "잔존 존속기간",
      value: expired ? "만료" : fmtYears(remainDays),
      rawValue: remainDays,
      confidence: "high",
      source: "patUtiModInfoSearch",
      note: `만료예정 ${expiry.getFullYear()}.${String(expiry.getMonth() + 1).padStart(2, "0")} (출원일+20년)`,
    });
  } else {
    metrics.push({
      id: 2,
      key: "remainingTerm",
      label: "잔존 존속기간",
      value: "N/A",
      rawValue: null,
      confidence: "na",
      source: "patUtiModInfoSearch",
      note: "출원일 데이터 결측",
    });
  }

  // 3. 청구항 수
  metrics.push({
    id: 3,
    key: "claimCount",
    label: "청구항 수",
    value: bib.claimCount != null ? `${bib.claimCount}개` : "N/A",
    rawValue: bib.claimCount,
    confidence: bib.claimCount != null ? "high" : "na",
    source: "patUtiModInfoSearch",
  });

  // 4. 연차료 납부 연차
  metrics.push({
    id: 4,
    key: "lastPaidYear",
    label: "연차료 납부 연차",
    value: reg.lastPaidYear != null ? `${reg.lastPaidYear}년차까지` : "N/A",
    rawValue: reg.lastPaidYear,
    confidence: reg.lastPaidYear != null ? "high" : reg.annualFees.length ? "medium" : "na",
    source: "registerStatus",
    note: reg.annualFees.length ? `납부 이력 ${reg.annualFees.length}건` : "납부 이력 결측",
  });

  // 5. 권리 이전 횟수 — 출처: 권리자 변동 이력(15058608)
  metrics.push({
    id: 5,
    key: "transferCount",
    label: "권리 이전 횟수",
    value: rightChanges.records.length ? `${rightChanges.transferCount}회` : "N/A",
    rawValue: rightChanges.records.length ? rightChanges.transferCount : null,
    confidence: rightChanges.records.length ? "high" : "na",
    source: "rightChange",
    note: rightChanges.records.length
      ? rightChanges.transferCount === 0
        ? "이전 이력 없음(최초 권리자 유지)"
        : `변동 이력 ${rightChanges.records.length}건`
      : "권리자 변동 이력 결측",
  });

  // 6. 공유권리자 수 (단독 여부)
  const holderCount = reg.rightHolders.length;
  metrics.push({
    id: 6,
    key: "ownerCount",
    label: "공유권리자 수",
    value: holderCount ? `${holderCount}인 (${holderCount === 1 ? "단독" : "공유"})` : "N/A",
    rawValue: holderCount || null,
    confidence: holderCount ? "high" : "na",
    source: "registerStatus",
    note: holderCount > 1 ? "공유 특허 — 담보 설정 시 전원 동의 필요" : undefined,
  });

  // 7. 무효심판 건수·생존 여부
  const invalidations = trials.records.filter((t) => /무효/.test(t.trialType));
  const aliveInvalidation = invalidations.some((t) => t.alive);
  metrics.push({
    id: 7,
    key: "invalidationTrials",
    label: "무효심판",
    value:
      invalidations.length === 0
        ? "이력 없음"
        : `${invalidations.length}건 (${aliveInvalidation ? "계류 중" : "종결"})`,
    rawValue: invalidations.length,
    confidence: "high",
    source: "trial",
    note: aliveInvalidation ? "무효심판 계류 — 권리 안정성 리스크" : undefined,
  });

  // 8. 권리범위확인심판 이력
  const scopeTrials = trials.records.filter((t) => /권리범위|확인/.test(t.trialType));
  metrics.push({
    id: 8,
    key: "scopeTrials",
    label: "권리범위확인심판",
    value: scopeTrials.length === 0 ? "이력 없음" : `${scopeTrials.length}건`,
    rawValue: scopeTrials.length,
    confidence: "high",
    source: "trial",
  });

  // 9. 후방인용 문헌 수 (backward) — 이 특허가 인용한 선행문헌(15057617)
  const backCount = citations.backward.length;
  metrics.push({
    id: 9,
    key: "backwardCitations",
    label: "후방인용 문헌 수",
    value: `${backCount}건`,
    rawValue: backCount,
    confidence: backCount > 0 ? "high" : "medium",
    source: "citationBackward",
    note: "이 특허가 인용한 선행문헌(backward).",
  });

  // 10. 출원→등록 소요기간
  if (appDate && regDate) {
    const days = daysBetween(appDate, regDate);
    metrics.push({
      id: 10,
      key: "prosecutionPeriod",
      label: "출원→등록 소요기간",
      value: fmtYears(days),
      rawValue: days,
      confidence: "high",
      source: "patUtiModInfoSearch",
    });
  } else {
    metrics.push({
      id: 10,
      key: "prosecutionPeriod",
      label: "출원→등록 소요기간",
      value: "N/A",
      rawValue: null,
      confidence: "na",
      source: "patUtiModInfoSearch",
      note: regDate ? "출원일 결측" : "등록일 결측(미등록 가능)",
    });
  }

  // 11. 우선권/패밀리 존재 여부 (데이터 없으면 N/A)
  const hasPriority = bib.priorityNumber != null;
  const hasFamily = bib.familyCount != null && bib.familyCount > 0;
  let famValue: string;
  let famConf: Metric["confidence"];
  if (bib.priorityNumber == null && bib.familyCount == null) {
    famValue = "N/A";
    famConf = "na";
  } else {
    const parts: string[] = [];
    if (hasPriority) parts.push("우선권 있음");
    if (hasFamily) parts.push(`패밀리 ${bib.familyCount}건`);
    if (parts.length === 0) parts.push("우선권·패밀리 없음");
    famValue = parts.join(" · ");
    famConf = "high";
  }
  metrics.push({
    id: 11,
    key: "priorityFamily",
    label: "우선권/패밀리",
    value: famValue,
    rawValue: hasPriority || hasFamily,
    confidence: famConf,
    source: "patUtiModInfoSearch",
    note: famConf === "na" ? "우선권·패밀리 데이터 결측 — 추정하지 않음" : undefined,
  });

  // 12. IPC 분류·기술분야
  metrics.push({
    id: 12,
    key: "ipc",
    label: "IPC 분류·기술분야",
    value: bib.ipcCodes.length ? bib.ipcCodes.join(", ") : "N/A",
    rawValue: bib.ipcCodes.length || null,
    confidence: bib.ipcCodes.length ? "high" : "na",
    source: "patUtiModInfoSearch",
    note: bib.ipcCodes.length ? ipcSection(bib.ipcCodes[0]) : undefined,
  });

  // 13. 전방인용(피인용) 문헌 수 — 이 특허를 인용한 후행문헌(15002128)
  //     기술 영향력·시장성 신호. 피인용 API 미응답 시 추정 없이 N/A.
  if (citations.forwardAvailable) {
    const fwdCount = citations.forward.length;
    metrics.push({
      id: 13,
      key: "forwardCitations",
      label: "전방인용(피인용) 수",
      value: `${fwdCount}건`,
      rawValue: fwdCount,
      confidence: "high",
      source: "citationForward",
      note: "이 특허를 인용한 후행문헌(forward) — 기술 영향력 신호.",
    });
  } else {
    metrics.push({
      id: 13,
      key: "forwardCitations",
      label: "전방인용(피인용) 수",
      value: "N/A",
      rawValue: null,
      confidence: "na",
      source: "citationForward",
      note: "피인용문헌 API(15002128) 미응답 — 추정하지 않음",
    });
  }

  return metrics;
}

/** IPC 섹션 문자(첫 글자) → 기술분야 한글 라벨 (직산 — 추정 아님) */
function ipcSection(code: string): string {
  const sec = code.trim().charAt(0).toUpperCase();
  const map: Record<string, string> = {
    A: "생활필수품",
    B: "처리조작·운수",
    C: "화학·야금",
    D: "섬유·지류",
    E: "고정구조물",
    F: "기계공학·조명·가열",
    G: "물리학",
    H: "전기",
  };
  return map[sec] ? `기술분야: ${map[sec]} (IPC ${sec})` : `IPC ${sec}`;
}

/** 지표 id로 빠르게 조회 */
export function metricById(metrics: Metric[], id: number): Metric | undefined {
  return metrics.find((m) => m.id === id);
}
