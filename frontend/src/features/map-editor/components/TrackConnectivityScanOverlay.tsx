import type { ConnectivityScanState } from '../hooks/useTrackConnectivityScan';
import { issueVicinityLabel } from '../utils/trackConnectivityScan';

type TrackConnectivityScanOverlayProps = {
  scanState: ConnectivityScanState;
};

function extendTrail(
  head: { x: number; y: number },
  tail: { x: number; y: number },
  minLenPx: number,
): { x: number; y: number } {
  const dx = head.x - tail.x;
  const dy = head.y - tail.y;
  const len = Math.hypot(dx, dy);
  if (len >= minLenPx) return tail;
  if (len < 0.01) return { x: head.x - minLenPx, y: head.y };
  const scale = minLenPx / len;
  return { x: head.x - dx * scale, y: head.y - dy * scale };
}

/** 並行雷射掃描 overlay（地圖 content 像素座標） */
export function TrackConnectivityScanOverlay({
  scanState,
}: TrackConnectivityScanOverlayProps) {
  const { phase, lasers, activeIssue, flashing, segmentById } = scanState;
  if (phase === 'idle' || phase === 'complete' || lasers.length === 0) return null;

  return (
    <div
      className="pointer-events-none absolute inset-0 z-[12000]"
      aria-hidden
    >
      <svg
        className="absolute left-0 top-0 overflow-visible"
        width="100%"
        height="100%"
        style={{ pointerEvents: 'none' }}
      >
        <defs>
          <linearGradient id="connectivity-laser-beam" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="rgba(34,211,238,0.15)" />
            <stop offset="45%" stopColor="rgba(34,211,238,0.85)" />
            <stop offset="100%" stopColor="rgba(250,204,21,1)" />
          </linearGradient>
        </defs>
        {lasers.map((laser) => {
          const isIssueLaser = laser.discovering === true;
          const trail = extendTrail(laser.laserPx, laser.laserTrailPx, isIssueLaser ? 32 : 18);
          return (
            <line
              key={`beam-${laser.trackId}`}
              x1={trail.x}
              y1={trail.y}
              x2={laser.laserPx.x}
              y2={laser.laserPx.y}
              stroke={isIssueLaser ? 'rgba(248,113,113,0.9)' : 'url(#connectivity-laser-beam)'}
              strokeWidth={isIssueLaser ? 6 : 4}
              strokeLinecap="round"
              style={{
                filter: isIssueLaser
                  ? 'drop-shadow(0 0 12px rgba(248,113,113,0.95))'
                  : 'drop-shadow(0 0 8px rgba(34,211,238,0.85))',
              }}
            />
          );
        })}
      </svg>

      {lasers.map((laser) => {
        const isIssueLaser = laser.discovering === true;
        return (
          <div
            key={`dot-${laser.trackId}`}
            className="absolute -translate-x-1/2 -translate-y-1/2"
            style={{ left: laser.laserPx.x, top: laser.laserPx.y }}
          >
            {isIssueLaser ? (
              <>
                <div
                  className="absolute left-1/2 top-1/2 size-24 -translate-x-1/2 -translate-y-1/2 rounded-full border-2 border-red-400/70 bg-red-500/15"
                  style={{ animation: 'connectivity-issue-ring 0.9s ease-out infinite' }}
                />
                <div
                  className="absolute left-1/2 top-1/2 size-36 -translate-x-1/2 -translate-y-1/2 rounded-full border border-red-400/35"
                  style={{ animation: 'connectivity-issue-ring 1.2s ease-out infinite 0.15s' }}
                />
              </>
            ) : (
              <div
                className="absolute left-1/2 top-1/2 size-10 -translate-x-1/2 -translate-y-1/2 rounded-full bg-cyan-400/25"
                style={{ animation: 'connectivity-issue-ring 1.4s ease-out infinite' }}
              />
            )}
            <div
              className={`rounded-full ${isIssueLaser ? 'size-6 bg-red-400' : 'size-4 bg-yellow-300'}`}
              style={{
                boxShadow: isIssueLaser
                  ? '0 0 16px 6px rgba(248,113,113,0.95), 0 0 36px 14px rgba(239,68,68,0.55)'
                  : '0 0 10px 3px rgba(250,204,21,1), 0 0 22px 8px rgba(34,211,238,0.75)',
              }}
            />
            {isIssueLaser && activeIssue ? (
              <div className="absolute left-1/2 top-full mt-2 flex max-w-[220px] -translate-x-1/2 flex-col items-center gap-1">
                <div
                  className={`whitespace-nowrap rounded-md border border-red-400/60 bg-red-600 px-2.5 py-1 text-[11px] font-semibold text-white shadow-lg ${flashing ? 'animate-connectivity-scan-flash-loop' : ''}`}
                >
                  問題在附近
                </div>
                <div className="rounded-md border border-red-400/40 bg-red-950/90 px-2 py-0.5 text-center text-[10px] font-medium leading-snug text-red-100 shadow-md">
                  {issueVicinityLabel(activeIssue, segmentById)}
                </div>
              </div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
