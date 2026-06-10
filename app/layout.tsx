import type { Metadata } from "next";
import Link from "next/link";
import "./globals.css";

export const metadata: Metadata = {
  title: "특허시세 · IP담보 사전진단 — 특허판 KB부동산 시세",
  description:
    "등록특허번호 하나로 3분 만에 IP담보대출·보증 적격성을 사전진단합니다. KIPRIS 공공데이터 직산 + XAI 여신심사 메모. 2026 지식재산 데이터 활용 창업 경진대회 출품작.",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="ko" className="h-full">
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="anonymous" />
        <link
          href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+KR:wght@300;400;500;600;700&family=IBM+Plex+Mono:wght@400;500;600&display=swap"
          rel="stylesheet"
        />
        <link
          rel="stylesheet"
          as="style"
          href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.min.css"
        />
      </head>
      <body className="min-h-full flex flex-col">
        <header className="no-print sticky top-0 z-20 border-b border-line bg-surface/90 backdrop-blur">
          <div className="mx-auto flex max-w-6xl items-center justify-between px-5 py-3">
            <Link href="/" className="flex items-center gap-2.5">
              <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-navy text-mint font-bold">特</span>
              <span className="flex flex-col leading-none">
                <span className="text-[15px] font-bold text-navy">특허시세</span>
                <span className="kicker mt-0.5">PATENT-SISE</span>
              </span>
            </Link>
            <div className="hidden items-center gap-4 text-sm text-muted sm:flex">
              <span className="badge badge-mint">KIPRIS 공공데이터 기반</span>
              <span className="text-faint">IP담보 사전진단</span>
            </div>
          </div>
        </header>

        <main className="flex-1">{children}</main>

        <footer className="no-print mt-12 border-t border-line bg-surface">
          <div className="mx-auto max-w-6xl px-5 py-8">
            <div className="flex flex-wrap items-start justify-between gap-6">
              <div>
                <div className="text-base font-bold text-navy">
                  특허시세 <span className="text-mint">PATENT-SISE</span>
                </div>
                <p className="mt-1 text-xs text-muted">IP담보 적격성 사전진단 · 여신심사 보조 콘솔</p>
              </div>
              <div className="kicker">2026 지식재산 데이터 활용 창업 경진대회 · 출품 프로토타입</div>
            </div>
            <hr className="hairline my-5" />
            <p className="text-[11px] leading-relaxed text-muted">
              활용 공공데이터(KIPRIS Plus, data.go.kr): 특허실용신안 정보검색(15058788) · 등록사항 법적상태(15058125) ·
              권리자 변동 이력(15058608) · 심판사항(15065474) · 심사인용문헌(15057617) · 특허·실용 피인용문헌(15002128).
              정량지표 13종은 코드로 직접 산출하며, 등급·점수에 생성형 AI가 관여하지 않습니다.
            </p>
            <p className="mt-2 text-[11px] font-medium leading-relaxed text-slate">
              본 서비스는 참고용 사전진단입니다. 공식 특허가치평가(통상 4~6주·수백만원)를 대체하지 않으며,
              실제 IP담보대출·보증 심사는 금융기관·평가기관의 정식 절차를 따릅니다.
              <span className="ml-1 text-muted">비상업 실증 데모(KIPRIS Plus 개발계정 약관 준수).</span>
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
