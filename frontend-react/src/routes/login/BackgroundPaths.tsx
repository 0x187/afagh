/**
 * Animated line-art backdrop for the login screen — port of the reference
 * app's "Background Paths" (two mirrored SVG layers of 36 drifting curves).
 *
 * The curve family follows a fixed parametric form: each path starts 5px to
 * the right and 6px higher than the previous one, keeping the same control
 * points relative to its start. Dash length, duration and delay cycle the
 * same way as the reference so the composition is identical.
 */

const PATH_COUNT = 36;

interface DriftPath {
  d: string;
  strokeWidth: number;
  strokeOpacity: number;
  dash: string;
  duration: string;
  delay: string;
}

// Deterministic, so computed once at module load instead of per render.
const PATHS: DriftPath[] = Array.from({ length: PATH_COUNT }, (_, i) => {
  const x = -380 + 5 * i;
  const y = -189 - 6 * i;
  const dash = 140 + 29 * i - 120 * Math.floor(i / 5);
  return {
    d:
      `M${x} ${y}C${x} ${y} ${x + 68} ${y + 405} ${x + 532} ${y + 532}` +
      `C${x + 996} ${y + 659} ${x + 1064} ${y + 1064} ${x + 1064} ${y + 1064}`,
    strokeWidth: Number((0.5 + 0.03 * i).toFixed(2)),
    strokeOpacity: Number((0.1 + 0.03 * i).toFixed(2)),
    dash: `${dash} ${1400 - dash}`,
    duration: `${16 + (i % 12)}s`,
    delay: `${-(5 * (i % 5) + Math.floor(i / 5))}s`,
  };
});

function Layer() {
  return (
    <svg
      className="h-full w-full text-white"
      viewBox="0 0 696 316"
      fill="none"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden
    >
      <title>Background Paths</title>
      {PATHS.map((p, i) => (
        <path
          key={i}
          d={p.d}
          stroke="currentColor"
          strokeWidth={p.strokeWidth}
          strokeOpacity={p.strokeOpacity}
          strokeDasharray={p.dash}
          strokeDashoffset={0}
          pathLength={1400}
          className="lgn-drift"
          style={{ animationDuration: p.duration, animationDelay: p.delay }}
        />
      ))}
    </svg>
  );
}

export function BackgroundPaths() {
  return (
    <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden opacity-70">
      <div className="absolute inset-0">
        <Layer />
      </div>
      <div className="absolute inset-0 scale-x-[-1]">
        <Layer />
      </div>
    </div>
  );
}
