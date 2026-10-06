// Slow moving wave lines behind the logo on the locked page.
// Each line is one SVG twice as wide as the screen with a repeating wave; sliding it left by
// exactly half its width (CSS animation, GPU-friendly) loops forever with no visible jump.
// Turned off by Windows' "show animations" setting (prefers-reduced-motion, see styles.css).

type Wave = {
  readonly y: number; // vertical centre, in the 0..400 view box
  readonly amplitude: number;
  readonly period: number; // must divide 1200 so the loop is seamless
  readonly seconds: number; // one loop
  readonly color: "burgundy" | "navy";
  readonly width: number;
  readonly opacity: number;
};

const WAVES: readonly Wave[] = [
  { y: 150, amplitude: 38, period: 1200, seconds: 38, color: "navy", width: 2.5, opacity: 0.35 },
  { y: 175, amplitude: 26, period: 600, seconds: 26, color: "burgundy", width: 2, opacity: 0.45 },
  { y: 200, amplitude: 44, period: 400, seconds: 31, color: "navy", width: 1.5, opacity: 0.25 },
  { y: 220, amplitude: 30, period: 1200, seconds: 45, color: "burgundy", width: 3, opacity: 0.3 },
  { y: 245, amplitude: 20, period: 300, seconds: 22, color: "navy", width: 1.5, opacity: 0.35 },
  { y: 265, amplitude: 34, period: 600, seconds: 34, color: "burgundy", width: 1.5, opacity: 0.25 },
];

const VIEW_WIDTH = 2400;

// A smooth wave: quadratic curves alternating up and down ("t" mirrors the previous control point)
function wavePath(wave: Wave): string {
  const quarter = wave.period / 4;
  const half = wave.period / 2;
  let d = `M 0 ${wave.y} q ${quarter} ${-wave.amplitude * 2} ${half} 0`;
  for (let x = half; x < VIEW_WIDTH; x += half) d += ` t ${half} 0`;
  return d;
}

export function Waves() {
  return (
    <div className="waves" aria-hidden="true">
      {WAVES.map((wave, index) => (
        <svg
          key={index}
          className="wave"
          viewBox={`0 0 ${VIEW_WIDTH} 400`}
          preserveAspectRatio="none"
          style={{ animationDuration: `${wave.seconds}s`, animationDirection: index % 2 === 0 ? "normal" : "reverse" }}
        >
          <path d={wavePath(wave)} fill="none" stroke={`var(--wave-${wave.color})`} strokeWidth={wave.width} opacity={wave.opacity} vectorEffect="non-scaling-stroke" />
        </svg>
      ))}
    </div>
  );
}
