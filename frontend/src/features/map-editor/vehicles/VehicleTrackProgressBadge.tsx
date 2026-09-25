import type { ResolvedRoofIndicatorConfig } from './vehicleRoofIndicator';

/**
 * 車頂軌道進度：`U19 ──●──▷ 47%`
 * 放在車身外面、不隨車身旋轉，永遠水平可讀。只畫名稱、進度線、百分比；呼叫端確認有有效軌道
 * 與有限的進度值才會畫它。
 */
export function VehicleTrackProgressBadge({
  config,
  trackName,
  progress,
}: {
  config: ResolvedRoofIndicatorConfig;
  trackName: string | null;
  /** 這次通行的進度 0–1 */
  progress: number;
}) {
  const fs = config.fontSizePx;
  const w = Math.max(24, config.barWidthPx);
  const h = Math.max(10, Math.round(fs * 0.75));
  const mid = h / 2;
  const r = Math.max(2, Math.round(h * 0.22));
  const arrow = Math.max(4, Math.round(h * 0.4));
  const x0 = r + 1;
  const x1 = w - arrow - 1;
  const p = Math.min(1, Math.max(0, progress));
  const xp = x0 + (x1 - x0) * p;

  return (
    <span className="flex items-center gap-2" style={{ color: config.textColor, fontSize: fs }}>
      {config.showTrackName && trackName && <span style={{ fontWeight: 600 }}>{trackName}</span>}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
        <line x1={x0} y1={mid} x2={x1} y2={mid} stroke={config.railColor} strokeWidth={Math.max(1, h * 0.12)} />
        <line x1={x0} y1={mid} x2={xp} y2={mid} stroke={config.progressColor} strokeWidth={Math.max(2, h * 0.28)} strokeLinecap="round" />
        <circle cx={x0} cy={mid} r={r} fill="none" stroke={config.railColor} strokeWidth={1.5} />
        <path d={`M ${x1} ${mid - arrow / 1.4} L ${w - 1} ${mid} L ${x1} ${mid + arrow / 1.4} Z`} fill={config.railColor} />
        <circle cx={xp} cy={mid} r={r + 1} fill={config.progressColor} stroke="rgba(15,23,42,0.9)" strokeWidth={1} />
      </svg>
      {config.showPercent && <span>{Math.round(p * 100)}%</span>}
    </span>
  );
}
