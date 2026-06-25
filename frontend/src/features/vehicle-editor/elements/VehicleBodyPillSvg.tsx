import { useEffect, useId, useRef } from 'react';
import type { IconContentMetrics } from '../utils/fitIconBounds';
import { deriveBodyPillShades } from '../utils/bodyColor';

const BODY_VIEW_W = 85;
const BODY_VIEW_H = 32;

/** 車體 pill：橫向 SVG 旋轉 -90° 直立顯示，填滿元件框避免縮放時內距跳動 */
export function VehicleBodyPillSvg({
  baseColor,
  boxWidth,
  boxHeight,
  onMetrics,
}: {
  baseColor: string;
  boxWidth: number;
  boxHeight: number;
  onMetrics?: (metrics: IconContentMetrics | null) => void;
}) {
  const uid = useId();
  const s = deriveBodyPillShades(baseColor);
  const onMetricsRef = useRef(onMetrics);
  onMetricsRef.current = onMetrics;

  useEffect(() => {
    onMetricsRef.current?.({ x: 0, y: 0, width: boxWidth, height: boxHeight });
    return () => onMetricsRef.current?.(null);
  }, [boxWidth, boxHeight]);

  const gradId = `body-pill-grad-${uid}`;
  const landscape = boxWidth >= boxHeight * 1.2;
  const svgW = landscape ? boxWidth : boxHeight;
  const svgH = landscape ? boxHeight : boxWidth;

  return (
    <div className="absolute inset-0 overflow-hidden" aria-hidden>
      <svg
        viewBox={`0 0 ${BODY_VIEW_W} ${BODY_VIEW_H}`}
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        preserveAspectRatio="none"
        style={{
          position: 'absolute',
          left: '50%',
          top: '50%',
          width: svgW,
          height: svgH,
          marginLeft: -svgW / 2,
          marginTop: -svgH / 2,
          transform: landscape ? undefined : 'rotate(-90deg)',
        }}
      >
        <defs>
          <linearGradient id={gradId} x1="0" y1="16" x2="85.0995" y2="16" gradientUnits="userSpaceOnUse">
            <stop stopColor={s.edgeDark} />
            <stop offset="0.129808" stopColor={s.midLight} />
            <stop offset="0.899038" stopColor={s.midLight} />
            <stop offset="1" stopColor={s.edgeDark} />
          </linearGradient>
          <filter id="blur-soft" x="-10%" y="-20%" width="120%" height="140%">
            <feGaussianBlur stdDeviation="2" />
          </filter>
        </defs>
        <path
          d="M0 4.72227C0 2.66774 1.55648 0.947312 3.60075 0.742245L11 0L74 0L81.3993 0.742245C83.4435 0.947313 85 2.66774 85 4.72227V27.2777C85 29.3323 83.4435 31.0527 81.3993 31.2578L74 32H11L3.60075 31.2578C1.55648 31.0527 0 29.3323 0 27.2777L0 4.72227Z"
          fill={`url(#${gradId})`}
        />
        <rect x="6" width="73" height="32" fill={s.glow} opacity="0.55" filter="url(#blur-soft)" />
        <rect x="9" width="67" height="32" fill={s.highlight} opacity="0.85" />
      </svg>
    </div>
  );
}
