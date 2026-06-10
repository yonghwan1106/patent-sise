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

      <div className="mt-4 min-h-[220px] rounded-xl bg-surface2 p-4 text-[13.5px] leading-relaxed text-ink">
        {text ? (
          <MemoRenderer text={text} />
        ) : status === "error" ? (
          <span className="text-rose">메모 생성 중 오류가 발생했습니다. 새로고침 후 다시 시도하세요.</span>
        ) : (
          <span className="inline-flex items-center gap-2 text-muted">
            <Spinner /> Claude가 원천 데이터를 검토해 메모를 작성하는 중…
          </span>
        )}
        {status === "streaming" && (
          <span className="ml-0.5 inline-block h-4 w-1.5 animate-pulse bg-mint align-middle" />
        )}
      </div>
    </div>
  );
}

// ------------------------------------------------------------
//  경량 마크다운 렌더러
//  지원: ## h2 / ### h3 / **bold** / --- hr / - 리스트 / 빈줄 단락
//  + [KIPRIS ...] 민트색 하이라이트 인라인 처리
// ------------------------------------------------------------

function MemoRenderer({ text }: { text: string }) {
  const lines = text.split("\n");
  const elements: React.ReactNode[] = [];
  let listItems: string[] = [];
  let key = 0;

  function flushList() {
    if (listItems.length === 0) return;
    elements.push(
      <ul key={key++} className="my-2 ml-4 list-disc space-y-0.5">
        {listItems.map((li, i) => (
          <li key={i}>{renderInline(li)}</li>
        ))}
      </ul>
    );
    listItems = [];
  }

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];

    // h2: ## ...
    if (/^##\s/.test(line)) {
      flushList();
      elements.push(
        <h2 key={key++} className="mt-5 mb-1 text-sm font-bold text-navy">
          {renderInline(line.replace(/^##\s+/, ""))}
        </h2>
      );
      continue;
    }

    // h3: ### ...
    if (/^###\s/.test(line)) {
      flushList();
      elements.push(
        <h3 key={key++} className="mt-3 mb-0.5 text-[13px] font-semibold text-navy">
          {renderInline(line.replace(/^###\s+/, ""))}
        </h3>
      );
      continue;
    }

    // hr: --- or ***
    if (/^[-*]{3,}$/.test(line.trim())) {
      flushList();
      elements.push(<hr key={key++} className="my-3 border-border" />);
      continue;
    }

    // 리스트 항목: - ... 또는 * ...
    if (/^[-*]\s/.test(line)) {
      listItems.push(line.replace(/^[-*]\s+/, ""));
      continue;
    }

    // 빈 줄 → 단락 구분
    if (line.trim() === "") {
      flushList();
      elements.push(<div key={key++} className="h-2" />);
      continue;
    }

    // 일반 텍스트 줄
    flushList();
    elements.push(
      <p key={key++} className="my-0.5">
        {renderInline(line)}
      </p>
    );
  }

  flushList();
  return <div>{elements}</div>;
}

/**
 * 인라인 렌더: **bold** 처리 + [KIPRIS ...] 민트 하이라이트
 * SWC 안전: 정규식 문자 클래스에 한글 범위 미사용.
 * [^\]] 는 ASCII ] 제외 — 한글 클래스 범위 아님.
 */
function renderInline(text: string): React.ReactNode {
  // bold(**...**) 와 KIPRIS 태그를 분리하는 토크나이저
  // 패턴: [KIPRIS 로 시작하는 ] 까지, 또는 ** ... **
  const TOKEN_RE = /(\*\*[^*]+\*\*|\[KIPRIS[^\]]*\])/g;
  const parts = text.split(TOKEN_RE);

  return parts.map((part, i) => {
    if (part.startsWith("[KIPRIS")) {
      return (
        <span
          key={i}
          className="mx-0.5 rounded bg-mintsoft px-1 py-0.5 text-[11px] font-medium text-mint2"
        >
          {part}
        </span>
      );
    }
    if (part.startsWith("**") && part.endsWith("**")) {
      return (
        <strong key={i} className="font-semibold text-navy">
          {part.slice(2, -2)}
        </strong>
      );
    }
    return <span key={i}>{part}</span>;
  });
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
