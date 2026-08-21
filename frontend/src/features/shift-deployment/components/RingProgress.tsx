type RingProgressProps = {
  value: number;
  caption: string;
};

export function RingProgress({ value, caption }: RingProgressProps) {
  const size = 200;
  const stroke = 12;
  const radius = (size - stroke) / 2 - 4;
  const circumference = 2 * Math.PI * radius;
  const pct = Math.min(1, Math.max(0, value / 100));
  const dashOffset = circumference * (1 - pct);
  const display = Number.isInteger(value) ? String(value) : value.toFixed(1);

  return (
    <div className="relative mx-auto h-[112px] w-[112px]">
      <svg viewBox={`0 0 ${size} ${size}`} className="h-full w-full -rotate-90">
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="rgba(255,255,255,0.08)"
          strokeWidth={stroke}
        />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={radius}
          fill="none"
          stroke="#3B82F6"
          strokeWidth={stroke}
          strokeLinecap="round"
          strokeDasharray={circumference}
          strokeDashoffset={dashOffset}
        />
      </svg>
      <div className="absolute inset-0 flex flex-col items-center justify-center text-center">
        <span className="text-[10px] text-zinc-400">{caption}</span>
        <span className="text-lg font-semibold leading-tight text-white">{display}%</span>
      </div>
    </div>
  );
}
