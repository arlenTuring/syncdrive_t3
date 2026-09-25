import type { ResolvedRoofIndicatorConfig } from './vehicleRoofIndicator';
import { formatOffsetM, shouldShowOffset } from './vehicleRoofIndicator';

/**
 * 車頂軌道進度：`U28  ○━━━━●────▷  42%   偏移 −0.12 m`
 * 放在車身外面、不隨車身旋轉，永遠水平可讀。
 */
export function VehicleTrackProgressBadge({
  config,
  trackName,
  progress,
  offsetM,
  offTrack,
  unconfirmed,
  title,
}: {
  config: ResolvedRoofIndicatorConfig;
  trackName: string | null;
  /** 這次通行的進度 0–1 */
  progress: number;
  offsetM: number | null;
  offTrack: boolean;
  /** 沒有可信的軌道判定：不畫進度，只寫「定位未確認」 */
  unconfirmed: boolean;
  title?: string;
}) {
  const fs = config.fontSizePx;
  if (unconfirmed) {
    return (
      <span title={title} style={{ color: '#fcd34d', fontSize: fs }}>
        定位未確認
      </span>
    );
  }

  const w = Math.max(24, config.barWidthPx);
  const h = Math.max(10, Math.round(fs * 0.75));
  const mid = h / 2;
  const r = Math.max(2, Math.round(h * 0.22));
  const arrow = Math.max(4, Math.round(h * 0.4));
  const x0 = r + 1;
  const x1 = w - arrow - 1;
  const p = Math.min(1, Math.max(0, progress));
  const xp = x0 + (x1 - x0) * p;
  const showOffset = shouldShowOffset(config.offsetMode, config.offsetThresholdM, offsetM, offTrack);

  return (
    <span title={title} className="flex items-center gap-2" style={{ color: config.textColor, fontSize: fs }}>
      {config.showTrackName && (
        <span style={{ fontWeight: 600 }}>{trackName ?? '—'}</span>
      )}
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} aria-hidden style={{ display: 'block' }}>
        <line x1={x0} y1={mid} x2={x1} y2={mid} stroke={config.railColor} strokeWidth={Math.max(1, h * 0.12)} />
        <line x1={x0} y1={mid} x2={xp} y2={mid} stroke={config.progressColor} strokeWidth={Math.max(2, h * 0.28)} strokeLinecap="round" />
        <circle cx={x0} cy={mid} r={r} fill="none" stroke={config.railColor} strokeWidth={1.5} />
        <path d={`M ${x1} ${mid - arrow / 1.4} L ${w - 1} ${mid} L ${x1} ${mid + arrow / 1.4} Z`} fill={config.railColor} />
        <circle cx={xp} cy={mid} r={r + 1} fill={config.progressColor} stroke="rgba(15,23,42,0.9)" strokeWidth={1} />
      </svg>
      {config.showPercent && <span>{Math.round(p * 100)}%</span>}
      {showOffset && (
        <span style={{ color: offTrack ? '#fda4af' : config.textColor, opacity: offTrack ? 1 : 0.85 }}>
          偏移 {formatOffsetM(offsetM)}
        </span>
      )}
    </span>
  );
}
