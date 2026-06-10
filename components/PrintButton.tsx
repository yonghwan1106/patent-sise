"use client";

export default function PrintButton() {
  return (
    <button
      onClick={() => window.print()}
      className="no-print rounded-lg border border-line2 bg-surface px-4 py-2 text-sm font-semibold text-navy transition hover:border-mint hover:text-mint2"
    >
      🖨 은행 제출용 1페이지 인쇄 · PDF 저장
    </button>
  );
}
