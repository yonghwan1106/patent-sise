"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

/** 숫자/하이픈만 추출 — raw 한글 문자클래스 정규식 회피(SWC 버그 방지) */
function sanitize(v: string): string {
  return v.replace(/[^0-9-]/g, "");
}

export default function SearchForm({ size = "lg" }: { size?: "lg" | "sm" }) {
  const router = useRouter();
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  function submit(e: React.FormEvent) {
    e.preventDefault();
    const digits = value.replace(/[^0-9]/g, "");
    if (digits.length < 9) {
      setError("출원번호 또는 등록번호(숫자 9자리 이상)를 입력하세요.");
      return;
    }
    setError(null);
    router.push(`/report?no=${encodeURIComponent(digits)}`);
  }

  const big = size === "lg";

  return (
    <form onSubmit={submit} className="w-full">
      <div className="flex flex-col gap-2 sm:flex-row">
        <input
          inputMode="numeric"
          value={value}
          onChange={(e) => setValue(sanitize(e.target.value))}
          placeholder="등록특허번호 또는 출원번호 입력 (예: 10-2021-0012345)"
          className={`mono flex-1 rounded-xl border border-line2 bg-surface px-4 ${
            big ? "py-3.5 text-base" : "py-2.5 text-sm"
          } text-ink placeholder:text-faint outline-none focus:border-mint focus:ring-2 focus:ring-mint/30`}
          aria-label="특허번호 입력"
        />
        <button
          type="submit"
          className={`btn-primary whitespace-nowrap px-6 ${big ? "py-3.5 text-base" : "py-2.5 text-sm"}`}
        >
          3분 사전진단 →
        </button>
      </div>
      {error && <p className="mt-2 text-sm text-rose">{error}</p>}
    </form>
  );
}
