// Hand-rolled sparkline (no charting library) - a straight port of the
// vanilla app's svgSparkline(), which plots each series against its own
// min/max since these metrics (BP, blood sugar, hemoglobin...) all live
// on different scales and a shared axis would flatten every line.
const W = 240;
const H = 56;
const PAD = 6;

export default function Sparkline({ values, color }) {
  const indexed = values.map((v, i) => ({ v, i })).filter((p) => p.v != null);
  if (indexed.length < 2) return null;

  const nums = indexed.map((p) => p.v);
  const min = Math.min(...nums);
  const max = Math.max(...nums);
  const range = max - min || 1;
  const stepX = values.length > 1 ? (W - PAD * 2) / (values.length - 1) : 0;
  const xy = (v, i) => [PAD + i * stepX, H - PAD - ((v - min) / range) * (H - PAD * 2)];

  let path = "";
  let started = false;
  values.forEach((v, i) => {
    if (v == null) {
      started = false;
      return;
    }
    const [x, y] = xy(v, i);
    path += (started ? " L" : "M") + x.toFixed(1) + "," + y.toFixed(1);
    started = true;
  });

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-14 w-full">
      <path d={path} fill="none" stroke={color} strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" />
      {indexed.map(({ v, i }) => {
        const [x, y] = xy(v, i);
        return <circle key={i} cx={x.toFixed(1)} cy={y.toFixed(1)} r="3" fill={color} />;
      })}
    </svg>
  );
}
