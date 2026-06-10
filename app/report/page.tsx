import Link from "next/link";
import { getPatentRaw } from "@/lib/kipris";
import { assess } from "@/lib/score";
import { KIPRIS_API_LABEL } from "@/lib/types";
import type { Metric, Grade, Confidence } from "@/lib/types";
import RadarChart from "@/components/RadarChart";
import MemoPanel from "@/components/MemoPanel";
import PrintButton from "@/components/PrintButton";
import SearchForm from "@/components/SearchForm";

export const dynamic = "force-dynamic";

const GRADE_LABEL: Record<Grade, string> = {
  A: "담보 우량",
  B: "담보 적합",
  C: "조건부 적합",
  D: "담보 주의",
  E: "담보 부적합",
};

function formatNo(n: string): string {
  if (n.length === 13) return `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}`;
  return n;
}

export default async function ReportPage({
  searchParams,
}: {
  searchParams: Promise<{ no?: string }>;
}) {
  const { no } = await searchParams;

  if (!no) {
    return (
      <div className="mx-auto max-w-2xl px-5 py-20 text-center">
        <h1 className="text-xl font-bold text-navy">특허번호가 필요합니다</h1>
        <p className="mt-2 text-sm text-muted">진단할 등록특허번호 또는 출원번호를 입력하세요.</p>
        <div className="mx-auto mt-6 max-w-xl">
          <SearchForm />
        </div>
        <Link href="/" className="mt-6 inline-block text-sm text-mint2">← 홈으로</Link>
      </div>
    );
  }

  const raw = await getPatentRaw(no);
  const a = assess(raw);
  const isSample = raw.source === "sample";
  const bib = raw.bibliography;

  return (
    <div className="mx-auto max-w-6xl px-5 py-8">
      {/* 상단 식별 + 액션 */}
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <Link href="/" className="kicker no-print hover:text-mint2">← 특허시세</Link>
            {isSample ? (
              <span className="badge badge-amber">데모 샘플 데이터</span>
            ) : (
              <span className="badge badge-mint">KIPRIS 실데이터</span>
            )}
          </div>
          <h1 className="mt-2 max-w-3xl text-2xl font-bold leading-snug text-navy">{bib.inventionTitle}</h1>
          <p className="mono mt-1 text-sm text-muted">
            {formatNo(raw.inputNumber)}
            {bib.registerNumber ? ` · 등록 ${bib.registerNumber}` : ""}
            {bib.applicantName ? ` · ${bib.applicantName}` : ""}
          </p>
        </div>
        <div className="no-print flex flex-col items-end gap-2">
          <PrintButton />
          <div className="w-72">
            <SearchForm size="sm" />
          </div>
        </div>
      </div>

      <hr className="hairline my-6" />

      {/* ① 관문 판정 배너 */}
      <GateBanner gate={a.gate} />

      {/* ② 등급 + ③ 레이더 */}
      <div className="mt-6 grid gap-5 lg:grid-cols-[340px_1fr]">
        <GradeCard grade={a.grade} total={a.totalScore} />
        <div className="card p-5">
          <div className="flex items-center justify-between">
            <div>
              <div className="kicker">4축 진단 점수</div>
              <h2 className="mt-1 text-base font-bold text-navy">권리성 · 기술성 · 활용성 · 금융적합성</h2>
            </div>
            <span className="mono text-sm text-muted">종합 {a.totalScore}/100</span>
          </div>
          <div className="mt-2 grid items-center gap-4 sm:grid-cols-[280px_1fr]">
            <div className="mx-auto w-full max-w-[280px]">
              <RadarChart axes={a.axes} />
            </div>
            <div className="flex flex-col gap-2">
              {a.axes.map((ax) => (
                <div key={ax.key}>
                  <div className="flex items-center justify-between text-sm">
                    <span className="font-medium text-navy">{ax.label}</span>
                    <span className="mono text-muted">{ax.score}</span>
                  </div>
                  <div className="mt-1 h-2 w-full overflow-hidden rounded-full bg-surface2">
                    <div
                      className="h-full rounded-full bg-mint"
                      style={{ width: `${ax.score}%` }}
                    />
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* ④ 13지표 카드 그리드 */}
      <section className="mt-8">
        <div className="flex items-end justify-between">
          <div>
            <div className="kicker">정량지표 13종 · 코드 직산</div>
            <h2 className="mt-1 text-lg font-bold text-navy">감사가능한 원천 지표</h2>
          </div>
          <span className="text-xs text-muted">결측은 N/A로 표기 · 추정값 없음</span>
        </div>
        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {a.metrics.map((m) => (
            <MetricCard key={m.id} m={m} />
          ))}
        </div>
      </section>

      {/* ⑤ Claude 메모 스트리밍 */}
      <section className="mt-8">
        <MemoPanel no={raw.inputNumber} />
      </section>

      {/* ⑥ 은행 제출용 1페이지 요약 (print 시 강조) */}
      <PrintSummary
        title={bib.inventionTitle}
        no={formatNo(raw.inputNumber)}
        grade={a.grade}
        total={a.totalScore}
        passed={a.gate.passed}
        reasons={a.gate.reasons}
        axes={a.axes.map((x) => ({ label: x.label, score: x.score }))}
        isSample={isSample}
      />

      {/* ⑦ 면책 고지 */}
      <div className="mt-8 rounded-xl border border-line2 bg-surface2 p-4 text-xs leading-relaxed text-muted">
        본 진단은 KIPRIS 공공데이터를 코드로 직산한 <b className="text-slate">참고용 사전진단</b>입니다.
        등급·점수는 결정론적 알고리즘 산출값이며 생성형 AI가 관여하지 않습니다. 본 결과는 공식 특허가치평가
        (공인 평가기관, 통상 4~6주·수백만원)를 대체하지 않으며, 실제 IP담보대출·보증 여부는 금융기관의 정식 심사를 따릅니다.
        {isSample && " 현재 표시된 데이터는 KIPRIS API 활용신청 전 단계의 시연용 가상 샘플입니다."}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
//  하위 표현 컴포넌트
// ------------------------------------------------------------
function GateBanner({ gate }: { gate: Awaited<ReturnType<typeof assess>>["gate"] }) {
  const pass = gate.passed;
  return (
    <div
      className={`card flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between ${
        pass ? "border-l-4 border-l-mint" : "border-l-4 border-l-rose"
      }`}
    >
      <div className="flex items-start gap-3">
        <div
          className={`flex h-11 w-11 shrink-0 items-center justify-center rounded-xl text-xl font-bold ${
            pass ? "bg-mintsoft text-mint2" : "bg-rosesoft text-rose"
          }`}
        >
          {pass ? "✓" : "!"}
        </div>
        <div>
          <div className="kicker">담보 적격성 관문 진단</div>
          <div className={`text-lg font-bold ${pass ? "text-mint2" : "text-rose"}`}>
            {pass ? "담보 적격성 관문 통과" : "담보 적격성 관문 미통과"}
          </div>
          {!pass && gate.reasons.length > 0 && (
            <ul className="mt-1 list-disc pl-4 text-sm text-muted">
              {gate.reasons.map((r, i) => (
                <li key={i}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      </div>
      <div className="flex shrink-0 gap-2">
        <GateChip ok={gate.legalAlive} label="법적상태 유지" />
        <GateChip ok={gate.soleOwner} label="단독 권리" />
        <GateChip ok={gate.noPendingTrial} label="심판 계류 없음" />
      </div>
    </div>
  );
}

function GateChip({ ok, label }: { ok: boolean; label: string }) {
  return (
    <div
      className={`flex flex-col items-center rounded-lg border px-3 py-2 text-center ${
        ok ? "border-mint/40 bg-mintsoft/40" : "border-rose/40 bg-rosesoft/50"
      }`}
    >
      <span className={`text-sm font-bold ${ok ? "text-mint2" : "text-rose"}`}>{ok ? "충족" : "미충족"}</span>
      <span className="mt-0.5 text-[11px] text-muted">{label}</span>
    </div>
  );
}

function GradeCard({ grade, total }: { grade: Grade; total: number }) {
  return (
    <div className="card flex flex-col items-center justify-center p-6 text-center">
      <div className="kicker">담보적합 등급</div>
      <div
        className={`grade-${grade} mt-3 flex h-28 w-28 items-center justify-center rounded-2xl text-6xl font-black text-white shadow-lg`}
      >
        {grade}
      </div>
      <div className="mt-3 text-base font-bold text-navy">{GRADE_LABEL[grade]}</div>
      <div className="mono mt-1 text-sm text-muted">종합 {total} / 100</div>
      <div className="mt-3 flex gap-1">
        {(["A", "B", "C", "D", "E"] as Grade[]).map((g) => (
          <span
            key={g}
            className={`h-1.5 w-7 rounded-full ${g === grade ? `grade-${g}` : "bg-surface2"}`}
          />
        ))}
      </div>
    </div>
  );
}

function confBadge(c: Confidence) {
  if (c === "na") return <span className="badge badge-rose">N/A</span>;
  if (c === "medium") return <span className="badge badge-amber">신뢰도 보통</span>;
  return <span className="badge badge-mint">신뢰도 높음</span>;
}

function MetricCard({ m }: { m: Metric }) {
  const isNa = m.confidence === "na";
  return (
    <div className="card flex flex-col p-4">
      <div className="flex items-start justify-between gap-2">
        <span className="text-xs font-semibold text-muted">
          <span className="mono mr-1 text-faint">{String(m.id).padStart(2, "0")}</span>
          {m.label}
        </span>
        {confBadge(m.confidence)}
      </div>
      <div className={`mt-2 text-lg font-bold ${isNa ? "text-faint" : "text-navy"}`}>{m.value}</div>
      {m.note && <div className="mt-1 text-[11px] leading-snug text-muted">{m.note}</div>}
      <div className="mt-auto pt-3">
        <span className="mono text-[10px] text-faint">출처 · {KIPRIS_API_LABEL[m.source]}</span>
      </div>
    </div>
  );
}

/** ⑥ 인쇄용 1페이지 요약 — 화면에는 print-only 로 숨김, 인쇄 시 노출 */
function PrintSummary(props: {
  title: string;
  no: string;
  grade: Grade;
  total: number;
  passed: boolean;
  reasons: string[];
  axes: { label: string; score: number }[];
  isSample: boolean;
}) {
  return (
    <div className="print-only mt-8 print-compact">
      <hr className="hairline my-4" />
      <div className="text-center">
        <div className="kicker">특허시세 · IP담보 사전진단 요약서</div>
        <div className="mt-1 text-lg font-bold">{props.title}</div>
        <div className="mono text-sm">{props.no}</div>
      </div>
      <table className="mt-4 w-full border-collapse text-sm">
        <tbody>
          <tr>
            <td className="border border-line2 bg-surface2 p-2 font-semibold">담보적합 등급</td>
            <td className="border border-line2 p-2">{props.grade} ({GRADE_LABEL[props.grade]}) · 종합 {props.total}/100</td>
          </tr>
          <tr>
            <td className="border border-line2 bg-surface2 p-2 font-semibold">담보 적격성 관문</td>
            <td className="border border-line2 p-2">
              {props.passed ? "통과" : "미통과"}
              {!props.passed && props.reasons.length ? ` — ${props.reasons.join("; ")}` : ""}
            </td>
          </tr>
          <tr>
            <td className="border border-line2 bg-surface2 p-2 font-semibold">4축 점수</td>
            <td className="border border-line2 p-2">
              {props.axes.map((x) => `${x.label} ${x.score}`).join(" · ")}
            </td>
          </tr>
        </tbody>
      </table>
      <p className="mt-3 text-[11px] text-muted">
        본 메모는 참고용 사전진단으로 공식 특허가치평가를 대체하지 않습니다.
        {props.isSample && " (데이터: KIPRIS 활용신청 전 시연용 가상 샘플)"}
      </p>
    </div>
  );
}
