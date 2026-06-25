import type { AlignGuideLine } from '../utils/dragSnap';

const GUIDE_THICKNESS = 0.5;

/** 在拖曳容器內繪製對齊輔助線（座標為容器本地） */
export function SnapGuideLines({
  guides,
  originX = 0,
  originY = 0,
  color = '#f472b6',
}: {
  guides: AlignGuideLine[];
  originX?: number;
  originY?: number;
  color?: string;
}) {
  if (!guides.length) return null;
  return (
    <>
      {guides.map((g, i) =>
        g.axis === 'x' ? (
          <div
            key={`sg-x-${i}`}
            style={{
              position: 'absolute',
              left: g.at - originX - GUIDE_THICKNESS / 2,
              top: g.from - originY,
              width: GUIDE_THICKNESS,
              height: Math.max(GUIDE_THICKNESS, g.to - g.from),
              background: color,
              opacity: 0.92,
              pointerEvents: 'none',
              zIndex: 2500,
            }}
          />
        ) : (
          <div
            key={`sg-y-${i}`}
            style={{
              position: 'absolute',
              top: g.at - originY - GUIDE_THICKNESS / 2,
              left: g.from - originX,
              height: GUIDE_THICKNESS,
              width: Math.max(GUIDE_THICKNESS, g.to - g.from),
              background: color,
              opacity: 0.92,
              pointerEvents: 'none',
              zIndex: 2500,
            }}
          />
        ),
      )}
    </>
  );
}
