import type { AxisScore } from "@/lib/types";

/** 4축 SVG 레이더 차트 (의존성 없는 순수 SVG, 서버 렌더) */
export default function RadarChart({ axes, size = 280 }: { axes: AxisScore[]; size?: number }) {
  const cx = size / 2;
  const cy = size / 2;
  const r = size / 2 - 46;
  const n = axes.length; // 4

  // 축 각도: 상단(12시)부터 시계방향
  const angle = (i: number) => (Math.PI * 2 * i) / n - Math.PI / 2;
  const point = (i: number, frac: number) => {
    const a = angle(i);
    return [cx + Math.cos(a) * r * frac, cy + Math.sin(a) * r * frac] as const;
  };

  // 격자 링 (25/50/75/100)
  const rings = [0.25, 0.5, 0.75, 1].map((frac) =>
    axes.map((_, i) => point(i, frac).join(",")).join(" ")
  );

  // 데이터 폴리곤
  const dataPts = axes.map((a, i) => point(i, Math.max(0.04, a.score / 100)).join(",")).join(" ");

  return (
    <svg viewBox={`0 0 ${size} ${size}`} width="100%" className="h-auto" role="img" aria-label="4축 점수 레이더 차트">
      {/* 격자 */}
      {rings.map((pts, idx) => (
        <polygon
          key={idx}
          points={pts}
          fill="none"
          stroke={idx === rings.length - 1 ? "#c8d3e2" : "#e4eaf2"}
          strokeWidth={idx === rings.length - 1 ? 1.2 : 1}
        />
      ))}
      {/* 축선 */}
      {axes.map((_, i) => {
        const [x, y] = point(i, 1);
        return <line key={i} x1={cx} y1={cy} x2={x} y2={y} stroke="#e4eaf2" strokeWidth={1} />;
      })}
      {/* 데이터 영역 */}
      <polygon points={dataPts} fill="rgba(31,191,156,0.18)" stroke="#1fbf9c" strokeWidth={2} />
      {axes.map((a, i) => {
        const [x, y] = point(i, Math.max(0.04, a.score / 100));
        return <circle key={i} cx={x} cy={y} r={3.5} fill="#14a888" />;
      })}
      {/* 라벨 */}
      {axes.map((a, i) => {
        const [x, y] = point(i, 1.22);
        return (
          <text
            key={i}
            x={x}
            y={y}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-[#0b1f3a]"
            fontSize={13}
            fontWeight={700}
          >
            {a.label}
            <tspan x={x} dy={16} fontSize={12} className="fill-[#14a888]" fontFamily="IBM Plex Mono, monospace">
              {a.score}
            </tspan>
          </text>
        );
      })}
    </svg>
  );
}
