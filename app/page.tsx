import Link from "next/link";
import SearchForm from "@/components/SearchForm";
import { listSamples } from "@/lib/kipris";

export default function Home() {
  const samples = listSamples();
  const sampleMeta = [
    { tagLabel: "이차전지 분리막", desc: "단독 권리 · 무심판 — 담보 적격 통과 사례" },
    { tagLabel: "AI 진단보조 SW", desc: "공유 특허 — 관문 주의 사례" },
    { tagLabel: "친환경 포장소재", desc: "무효심판 계류 — 관문 미통과 사례" },
  ];

  return (
    <div>
      {/* ── 히어로 ── */}
      <section className="hero-grad text-white">
        <div className="mx-auto max-w-6xl px-5 pb-16 pt-14 sm:pt-20">
          <span className="badge badge-mint">특허판 KB부동산 시세</span>
          <h1 className="mt-5 max-w-3xl text-3xl font-bold leading-[1.25] sm:text-[42px]">
            특허 한 건의 <span className="text-mint">담보 적격성</span>을
            <br className="hidden sm:block" /> 3분 만에 사전진단합니다.
          </h1>
          <p className="mt-4 max-w-2xl text-[15px] leading-relaxed text-white/80">
            등록특허번호만 넣으면 IP담보대출·보증 신청이 가능한 상태인지, 13개 정량지표와 4축 점수,
            그리고 은행 심사역이 읽는 XAI 여신심사 메모까지 한 번에 받아보세요.
          </p>

          {/* 가치 대비 */}
          <div className="mt-7 grid max-w-2xl grid-cols-2 gap-3">
            <div className="rounded-xl border border-white/15 bg-white/5 p-4">
              <div className="kicker text-white/50">공식 특허가치평가</div>
              <div className="mt-1 text-lg font-bold text-white/90">4~6주 · 약 500만원</div>
            </div>
            <div className="rounded-xl border border-mint/40 bg-mint/10 p-4">
              <div className="kicker text-mint">특허시세 사전진단</div>
              <div className="mt-1 text-lg font-bold text-mint">3분 · 무료</div>
            </div>
          </div>

          {/* 입력 폼 */}
          <div className="mt-7 max-w-2xl">
            <SearchForm size="lg" />
            <p className="mt-2 text-xs text-white/55">
              KIPRIS Plus 공공데이터(특허청·한국특허정보원) 기반 · 점수는 코드 직산, AI는 근거 서술만 담당
            </p>
          </div>
        </div>
      </section>

      {/* ── 샘플 카드 ── */}
      <section className="mx-auto max-w-6xl px-5 py-12">
        <div className="flex items-end justify-between">
          <div>
            <div className="kicker">DEMO · 원클릭 시연</div>
            <h2 className="mt-1 text-xl font-bold text-navy">샘플 특허로 바로 체험</h2>
          </div>
          <span className="badge badge-amber">데모 샘플 데이터</span>
        </div>
        <p className="mt-2 text-sm text-muted">
          현재 KIPRIS API 활용신청 전 단계라, 아래 시연용 가상 특허(명칭에 “(시연샘플)” 표기)로 동작을 확인할 수 있습니다.
          실데이터 전환 시 코드 수정 없이 동일하게 작동합니다.
        </p>

        <div className="mt-5 grid gap-4 sm:grid-cols-3">
          {samples.map((s, i) => (
            <Link
              key={s.number}
              href={`/report?no=${s.number}`}
              className="card group flex flex-col p-5 transition hover:-translate-y-0.5 hover:border-mint"
            >
              <div className="flex items-center justify-between">
                <span className="badge">{sampleMeta[i]?.tagLabel ?? s.tag}</span>
                <span className="mono text-xs text-faint">{s.tag}</span>
              </div>
              <div className="mt-3 line-clamp-2 text-[15px] font-semibold leading-snug text-navy">
                {s.title}
              </div>
              <div className="mono mt-2 text-xs text-muted">{formatNo(s.number)}</div>
              <div className="mt-3 text-xs leading-relaxed text-muted">{sampleMeta[i]?.desc}</div>
              <div className="mt-4 flex items-center text-sm font-semibold text-mint2 group-hover:text-mint">
                진단 리포트 보기 →
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* ── 신뢰 요소 ── */}
      <section className="mx-auto max-w-6xl px-5 pb-16">
        <div className="grid gap-4 sm:grid-cols-3">
          <TrustCard
            title="KIPRIS Plus 공공데이터"
            body="특허청·한국특허정보원의 서지·등록사항·심판·인용 4종 OpenAPI를 직접 연동합니다. 모든 판단은 원천 데이터 필드로 추적됩니다."
          />
          <TrustCard
            title="XAI · 감사가능한 산출"
            body="13개 정량지표를 코드로 직산하고, 결측 지표는 추정 없이 N/A로 표기합니다. AI는 점수가 아니라 근거 서술만 담당합니다."
          />
          <TrustCard
            title="공식 평가를 대체하지 않음"
            body="본 진단은 IP담보 신청 전 적격성을 가르는 ‘깔때기’입니다. 최종 가치평가는 공인 평가기관 절차를 따릅니다."
          />
        </div>
      </section>
    </div>
  );
}

function TrustCard({ title, body }: { title: string; body: string }) {
  return (
    <div className="card p-5">
      <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-mintsoft text-mint2">✓</div>
      <h3 className="mt-3 text-[15px] font-bold text-navy">{title}</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">{body}</p>
    </div>
  );
}

/** 13자리 출원번호 가독 포맷 (예: 10-2021-0012345) */
function formatNo(n: string): string {
  if (n.length === 13) return `${n.slice(0, 2)}-${n.slice(2, 6)}-${n.slice(6)}`;
  return n;
}
