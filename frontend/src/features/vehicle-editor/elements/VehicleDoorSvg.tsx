import type { CSSProperties } from 'react';

const VIEW_W = 85;
const VIEW_H = 3;

/** door.svg 幾何：左右端蓋 + 中央雙門片軌道 */
const DOOR_ZONE_LEFT = 16;
const DOOR_ZONE_RIGHT = 69;
const DOOR_ZONE_W = DOOR_ZONE_RIGHT - DOOR_ZONE_LEFT;
const DOOR_HALF = DOOR_ZONE_W / 2;
/** 全開（100%）時每片門的最小寬度 */
const MIN_LEAF_W = 5;

const TRACK_BG = 'rgba(74, 85, 101, 0.45)';
const END_CAP_BG = 'rgba(100, 116, 139, 0.65)';
const DOOR_ALARM = '#ef4444';

/** 與 door.svg 相同造型的圓角頂門片（寬度可變） */
function doorLeafPath(x: number, w: number): string {
  if (w < 0.6) return '';
  const x2 = x + w;
  const r = Math.min(1, w * 0.037);
  return [
    `M${x} 1`,
    `C${x} ${1 - r * 0.55} ${x + r * 0.45} 0 ${x + r} 0`,
    `H${x2 - r}`,
    `C${x2 - r * 0.45} 0 ${x2} ${1 - r * 0.55} ${x2} 1`,
    `V${VIEW_H}H${x}V1Z`,
  ].join('');
}

function computeDoorLeaves(openPercent: number): { leftX: number; leafW: number; rightX: number } {
  const ratio = Math.min(1, Math.max(0, openPercent / 100));
  const leafW = MIN_LEAF_W + (DOOR_HALF - MIN_LEAF_W) * (1 - ratio);
  return {
    leftX: DOOR_ZONE_LEFT,
    leafW,
    rightX: DOOR_ZONE_RIGHT - leafW,
  };
}

type Props = {
  widthPx: number;
  heightPx: number;
  openPercent: number;
  fillColor: string;
  alarm?: boolean;
  animate?: boolean;
  className?: string;
  style?: CSSProperties;
};

export function VehicleDoorSvg({
  widthPx,
  heightPx,
  openPercent,
  fillColor,
  alarm = false,
  animate = true,
  className,
  style,
}: Props) {
  const { leftX, leafW, rightX } = computeDoorLeaves(openPercent);
  const doorColor = alarm ? DOOR_ALARM : fillColor;
  const leafTransition = animate ? 'd 0.45s cubic-bezier(0.4, 0, 0.2, 1), fill 0.25s ease' : undefined;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      className={className}
      style={{ display: 'block', width: widthPx, height: heightPx, ...style }}
      aria-hidden
    >
      <rect x={DOOR_ZONE_LEFT} y={0} width={DOOR_ZONE_W} height={VIEW_H} fill={TRACK_BG} />
      <rect x={0} y={0} width={DOOR_ZONE_LEFT} height={VIEW_H} fill={END_CAP_BG} />
      <rect x={DOOR_ZONE_RIGHT} y={0} width={VIEW_W - DOOR_ZONE_RIGHT} height={VIEW_H} fill={END_CAP_BG} />

      <path d={doorLeafPath(leftX, leafW)} fill={doorColor} style={{ transition: leafTransition }} />
      <path d={doorLeafPath(rightX, leafW)} fill={doorColor} style={{ transition: leafTransition }} />

      {alarm && (
        <rect
          x={DOOR_ZONE_LEFT}
          y={0}
          width={DOOR_ZONE_W}
          height={VIEW_H}
          fill="none"
          stroke={DOOR_ALARM}
          strokeWidth={0.35}
          opacity={0.85}
        />
      )}
    </svg>
  );
}
