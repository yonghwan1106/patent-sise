// ============================================================
//  /api/memo — Claude(@anthropic-ai/sdk) 스트리밍 여신심사 메모
//  점수 산출에는 관여하지 않음. 13지표 JSON을 받아 근거 서술만 생성.
// ============================================================

import Anthropic from "@anthropic-ai/sdk";
import { getPatentRaw } from "@/lib/kipris";
import { assess } from "@/lib/score";
import type { Assessment } from "@/lib/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// 사용자 지시 모델 (선례 vguard-prototype 과 동일 문자열 사용)
const MODEL = "claude-haiku-4-5-20251001";

const SYSTEM_PROMPT = `당신은 은행 여신심사역에게 제출되는 IP담보 사전진단 메모를 작성하는 분석가입니다.

[점수·등급 엄수 규칙 — 최우선 적용]
- 입력 JSON에 totalScore, grade, axes 값이 명시되어 있습니다.
- 본문에 점수나 등급을 언급할 경우 반드시 입력 JSON의 값을 그대로 인용해야 합니다.
- 입력에 없는 점수·수치를 절대 생성하거나 계산하지 마세요.
- 각 축(권리성·기술성·활용성·금융적합성)의 평가는 점수 재산정이 아니라 입력 점수의 근거 서술입니다.
- 종합점수·등급·4축 점수는 메모 첫머리에 한 줄로 요약하지 마세요. 클라이언트에서 별도 렌더합니다.

[일반 작성 규칙]
- 모든 판단 문장에 [KIPRIS 등록사항: ○○] [KIPRIS 권리자변동: ○○] [KIPRIS 심판사항: ○○] [KIPRIS 특허서지: ○○] [KIPRIS 인용문헌: ○○] [KIPRIS 피인용문헌: ○○] 형식으로 원천 데이터 근거를 인용하세요.
- 결측 지표는 반드시 N/A로 명시하고 추정하지 마세요. 데이터에 없는 사실을 만들어내지 마세요.
- 구성: ①담보 적격성 관문 판정 요약 ②권리 안정성 ③기술·활용성 ④여신 참고 의견으로 4개 단락.
- 여신 참고 의견 단락은 "담보 설정 가능" 같은 단정적 판정 표현 대신 "담보 설정 가능성이 있는 것으로 참고됩니다" 같은 참고 의견 형태로 작성하세요.
- 진단일은 입력 JSON의 diagnosisDate 값을 그대로 사용하세요.
- 은행 심사역이 읽는 간결한 실무 문체. 단락당 3~5문장.
- 마지막 줄에 정확히 다음 고지를 포함하세요: "본 메모는 참고용 사전진단으로 공식 특허가치평가를 대체하지 않습니다."`;

/** KST 오늘 날짜 YYYY-MM-DD */
function todayKST(): string {
  // UTC+9
  const now = new Date(Date.now() + 9 * 60 * 60 * 1000);
  return now.toISOString().slice(0, 10);
}

function buildUserPrompt(a: Assessment): string {
  const diagnosisDate = todayKST();
  const lines = a.metrics.map(
    (m) => `- 지표${m.id} ${m.label}: ${m.value} (신뢰도 ${m.confidence}, 출처 ${m.source})`
  );
  const gateLines = [
    `- 관문 통과: ${a.gate.passed ? "통과" : "미통과"}`,
    `- 법적상태 유지: ${a.gate.legalAlive ? "예" : "아니오"}`,
    `- 단독 권리: ${a.gate.soleOwner ? "예" : "아니오"}`,
    `- 심판 계류 없음: ${a.gate.noPendingTrial ? "예" : "아니오"}`,
    a.gate.reasons.length ? `- 미통과 사유: ${a.gate.reasons.join(" / ")}` : "",
  ].filter(Boolean);

  return [
    `[대상 특허] ${a.raw.bibliography.inventionTitle} (입력번호 ${a.raw.inputNumber})`,
    `[데이터 출처] ${a.raw.source === "sample" ? "데모 샘플 데이터" : "KIPRIS 실데이터"}`,
    `[진단일] ${diagnosisDate}  ← 메모에 진단일 기재 시 이 값을 그대로 사용하세요.`,
    ``,
    `[코드 직산 결과 — 이 값만 사용, 임의 수치 생성 금지]`,
    `  종합점수: ${a.totalScore}점`,
    `  담보적합 등급: ${a.grade}`,
    `  4축 점수: ${a.axes.map((x) => `${x.label} ${x.score}점`).join(" / ")}`,
    ``,
    `[담보 적격성 관문]`,
    ...gateLines,
    ``,
    `[정량지표 13종]`,
    ...lines,
    ``,
    `위 데이터만 근거로 여신심사 메모를 작성하세요.`,
    `점수·등급은 위 [코드 직산 결과]의 값을 그대로 인용하고, 입력에 없는 수치를 절대 생성하지 마세요.`,
    `데이터에 없는 내용은 쓰지 마세요.`,
  ].join("\n");
}

export async function POST(req: Request) {
  let no = "";
  try {
    const body = await req.json();
    no = String(body?.no ?? "");
  } catch {
    return new Response("invalid body", { status: 400 });
  }
  if (!no) return new Response("missing patent number", { status: 400 });

  // 데이터·점수는 서버에서 결정론적으로 재산출(클라이언트 신뢰 안 함)
  const raw = await getPatentRaw(no);
  const assessment = assess(raw);

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    // 키 없을 때 폴백 메모(규칙기반) — 스트림 형태로 동일하게 반환
    const fallback = ruleBasedMemo(assessment);
    return new Response(fallback, {
      headers: { "content-type": "text/plain; charset=utf-8" },
    });
  }

  const client = new Anthropic({ apiKey });
  const encoder = new TextEncoder();

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const llmStream = client.messages.stream({
          model: MODEL,
          max_tokens: 1600,
          system: SYSTEM_PROMPT,
          messages: [{ role: "user", content: buildUserPrompt(assessment) }],
        });

        for await (const event of llmStream) {
          if (event.type === "content_block_delta" && event.delta.type === "text_delta") {
            controller.enqueue(encoder.encode(event.delta.text));
          }
        }
        await llmStream.finalMessage();
        controller.close();
      } catch {
        // 스트리밍 중 실패 → 규칙기반 메모로 마무리
        controller.enqueue(encoder.encode("\n\n" + ruleBasedMemo(assessment)));
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "content-type": "text/plain; charset=utf-8",
      "cache-control": "no-store, no-transform",
      "x-accel-buffering": "no",
    },
  });
}

/** API 키 부재/실패 시 규칙기반 폴백 메모 (스트림 콘텐츠와 동일 형식) */
function ruleBasedMemo(a: Assessment): string {
  const g = a.gate;
  const m = (id: number) => a.metrics.find((x) => x.id === id);
  const opinion = g.passed
    ? "담보 설정 가능 대상으로 판단됩니다. 다만 공식 가치평가로 담보가액을 확정해야 합니다."
    : "현 상태로는 담보 부적합 또는 조건부입니다. 아래 사유 해소 후 재검토를 권고합니다.";

  return [
    `[담보 적격성 관문] 관문 ${g.passed ? "통과" : "미통과"}. 법적상태 유지 ${g.legalAlive ? "충족" : "미충족"}, 단독 권리 ${g.soleOwner ? "충족" : "미충족"}, 심판 계류 없음 ${g.noPendingTrial ? "충족" : "미충족"}. [KIPRIS 등록사항: ${m(1)?.value ?? "N/A"}]${g.reasons.length ? " 미통과 사유 — " + g.reasons.join("; ") + "." : ""}`,
    ``,
    `[권리 안정성] 청구항 ${m(3)?.value ?? "N/A"}, 공유권리자 ${m(6)?.value ?? "N/A"}, 무효심판 ${m(7)?.value ?? "N/A"}. [KIPRIS 심판사항: ${m(7)?.value ?? "N/A"}] 권리이전 ${m(5)?.value ?? "N/A"}로 권리 귀속의 안정성을 확인했습니다.`,
    ``,
    `[기술·활용성] 후방인용 ${m(9)?.value ?? "N/A"}, IPC ${m(12)?.value ?? "N/A"}. [KIPRIS 특허서지: ${m(12)?.value ?? "N/A"}] 잔존 존속기간 ${m(2)?.value ?? "N/A"}, 연차료 ${m(4)?.value ?? "N/A"}로 권리 유지 의지를 확인했습니다.`,
    ``,
    `[여신 의견] 코드 직산 종합 ${a.totalScore}점·등급 ${a.grade}. ${opinion}`,
    ``,
    `본 메모는 참고용 사전진단으로 공식 특허가치평가를 대체하지 않습니다.`,
  ].join("\n");
}
