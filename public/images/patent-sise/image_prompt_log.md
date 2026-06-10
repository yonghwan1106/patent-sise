# Patent-Sise Image Prompt Log

Generated on 2026-06-10 for the `patent-sise` contest prototype.

## Execution Path

- Requested direction: GPT Image 2.0 / `gpt-image-2`, Korean fintech infographic.
- Local explicit CLI path checked: `C:\Users\user\.codex\skills\.system\imagegen\scripts\image_gen.py`.
- CLI status: not used because `OPENAI_API_KEY` was not available in the local environment.
- Actual generation path: built-in `imagegen` tool, then copied into this project.
- Workspace normalization: all final PNGs resized to `2048x1152`.

## Assets

### `patent-sise-hero-pipeline.png`

Prompt summary:

> 특허번호 입력 -> KIPRIS 6종 -> 13지표 직산 -> 4축 등급 -> XAI 여신 메모 -> 3분 사전진단을 보여주는 네이비/민트/골드 톤의 한국어 핀테크 데이터 파이프라인.

Required text:

- 특허번호 입력
- KIPRIS 6종
- 13지표 직산
- 4축 등급
- XAI 여신 메모
- 3분 사전진단

Visual QA:

- Required headline labels are legible and spelled correctly.
- The inner decorative axis labels include non-final wording, so the page HTML states the exact axes: 권리성, 기술성, 활용성, 금융적합성.

### `ip-finance-bottleneck.png`

Prompt summary:

> IP금융 성장과 IP담보대출 감소, 평가 병목, 기존 평가 기간/비용, 3분 무료 사전진단을 비교하는 한국어 시장 문제 인포그래픽.

Required text:

- IP금융 12.4조
- +14.8%
- IP담보대출 2.09조
- -2.8%
- 평가 병목
- 4~6주·500만원
- 3분·무료 사전진단

Visual QA:

- Required numbers and bottleneck message are legible.
- The generated image adds a descriptive title and `Patent-Sise` label; the surrounding HTML carries the exact contest-facing wording.

### `kipris-data-map.png`

Prompt summary:

> KIPRIS 6종 공공데이터가 13지표와 4개 평가축을 거쳐 XAI 메모로 이어지는 데이터 계보 지도.

Required text:

- 서지
- 등록사항
- 권리자 변동
- 심판
- 후방인용
- 전방인용
- 13지표
- 권리성
- 기술성
- 활용성
- 금융적합성
- XAI 메모

Visual QA:

- Required Korean labels are legible and aligned with the prototype data flow.

### `report-decision-strip.png`

Prompt summary:

> 리포트 상단용 얇은 의사결정 흐름 이미지: 관문 판정 -> 등급 A~E -> 원천근거 인용 -> 은행 제출용 요약.

Required text:

- 관문 판정
- 등급 A~E
- 원천근거 인용
- 은행 제출용 요약

Visual QA:

- Required step labels are legible.
- The surrounding report includes the same labels in HTML chips for accessibility and text exactness.
