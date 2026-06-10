"use client";

import { useEffect, useRef, useState } from "react";

type Status = "loading" | "streaming" | "done" | "error";

export default function MemoPanel({ no }: { no: string }) {
  const [text, setText] = useState("");
  const [status, setStatus] = useState<Status>("loading");
  const startedRef = useRef(false);

  useEffect(() => {
    if (startedRef.current) return;
    startedRef.current = true;
    const ctrl = new AbortController();

    (async () => {
      try {
        const res = await fetch("/api/memo", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ no }),
          signal: ctrl.signal,
        });
        if (!res.ok || !res.body) throw new Error(`HTTP ${res.status}`);

        const reader = res.body.getReader();
        const decoder = new TextDecoder();
        setStatus("streaming");
        let acc = "";
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setText(acc);
        }
        setStatus("done");
      } catch (e) {
        if ((e as Error).name === "AbortError") return;
        setStatus("error");
      }
    })();

    return () => ctrl.abort();
  }, [no]);

  return (
    <div className="card flex flex-col p-5">
      <div className="flex items-center justify-between">
        <div>
          <div className="kicker">XAI · CLAUDE 여신심사 메모</div>
          <h3 className="mt-1 text-base font-bold text-navy">은행 제출용 사전진단 의견</h3>
        </div>
        <StatusBadge status={status} />
      </div>
      <p className="mt-1 text-xs text-muted">
        각 판단에 [KIPRIS …] 원천 데이터 근거를 인용합니다. 점수·등급은 코드 직산값이며 AI는 서술만 담당합니다.
      </p>

      <div className="mt-4 min-h-[220px] whitespace-pre-wrap rounded-xl bg-surface2 p-4 text-[13.5px] leading-relaxed text-ink">
        {text ? (
          renderMemo(text)
        ) : status === "error" ? (
          <span className="text-rose">메모 생성 중 오류가 발생했습니다. 새로고침 후 다시 시도하세요.</span>
        ) : (
          <span className="inline-flex items-center gap-2 text-muted">
            <Spinner /> Claude가 원천 데이터를 검토해 메모를 작성하는 중…
          </span>
        )}
        {status === "streaming" && <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-mint align-middle" />}
      </div>
    </div>
  );
}

/** [KIPRIS …] 인용 토큰을 시각적으로 강조 (정규식: 영문/공백/콜론만 — 한글 클래스 미사용) */
function renderMemo(text: string) {
  const parts = text.split(/(\[KIPRIS[^\]]*\])/g);
  return parts.map((p, i) =>
    p.startsWith("[KIPRIS") ? (
      <span key={i} className="mx-0.5 rounded bg-mintsoft px-1 py-0.5 text-[11px] font-medium text-mint2">
        {p}
      </span>
    ) : (
      <span key={i}>{p}</span>
    )
  );
}

function StatusBadge({ status }: { status: Status }) {
  if (status === "done") return <span className="badge badge-mint">작성 완료</span>;
  if (status === "error") return <span className="badge badge-rose">오류</span>;
  return <span className="badge badge-amber">생성 중</span>;
}

function Spinner() {
  return (
    <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-mint border-t-transparent" />
  );
}
