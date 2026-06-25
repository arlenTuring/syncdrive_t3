import { AlertTriangle, Play, RotateCcw, ScanLine, SkipForward, Square } from 'lucide-react';
import type { ConnectivityScanState } from '../hooks/useTrackConnectivityScan';
import type { ConnectivityIssueKind } from '../utils/trackConnectivityScan';
import { issueVicinityLabel } from '../utils/trackConnectivityScan';

type TrackConnectivityScanPanelProps = {
  scanState: ConnectivityScanState;
  onStart: () => void;
  onContinue: () => void;
  onStop: () => void;
  onReset: () => void;
  onSelectIssue: (trackId: string, areaId: string) => void;
  embedded?: boolean;
  onClose?: () => void;
};

const ISSUE_LABEL: Record<ConnectivityIssueKind, string> = {
  missing_ref_field: '缺少 refField',
  overlap: 'refField 重疊',
  endpoint_gap: '端點斷開',
  path_gap: '路徑斷點',
};

export function TrackConnectivityScanPanel({
  scanState,
  onStart,
  onContinue,
  onStop,
  onReset,
  onSelectIssue,
  embedded = false,
}: TrackConnectivityScanPanelProps) {
  const {
    phase,
    plan,
    segmentById,
    progressPercent,
    activeProbeCount,
    totalProbeCount,
    activeIssue,
    totalIssues,
    revealedIssues,
  } = scanState;
  const segments = segmentById ?? plan?.segmentById;
  const isRunning = phase === 'scanning' || phase === 'flashing';
  const showDiscovery = phase === 'complete';
  const atIssueStop = phase === 'flashing' && activeIssue;

  const shellClass = embedded
    ? 'flex flex-col'
    : 'flex max-h-[min(80vh,520px)] w-full max-w-md flex-col overflow-hidden rounded-xl border border-zinc-700 bg-zinc-950 shadow-2xl';

  return (
    <div className={shellClass}>
      {!embedded ? (
        <div className="flex items-center justify-between border-b border-zinc-800 px-4 py-3">
          <div className="flex items-center gap-2">
            <ScanLine className="size-4 text-cyan-400" aria-hidden />
            <h2 className="text-sm font-semibold text-zinc-100">斷路掃描</h2>
          </div>
        </div>
      ) : null}

      <div className={`flex flex-col gap-2 ${embedded ? 'px-3 py-2' : 'space-y-3 px-4 py-3'} text-xs text-zinc-400`}>
        {!embedded ? (
          <p className="w-full leading-relaxed">
            鄰接圖檢查 refField 是否接續（物理相鄰 + 端點連續），問題預先定位、掃到才揭示。
            同時最多 {scanState.maxConcurrentProbes} 個探針，其餘排隊，非全段齊發。
          </p>
        ) : null}

        {isRunning || showDiscovery ? (
          <div className="space-y-1.5">
            <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-zinc-300">
              <span className="font-mono">
                {showDiscovery
                  ? '掃描完成'
                  : atIssueStop
                    ? '偵測到斷路 · 雷射已停下'
                    : '偵測池掃描中'}
              </span>
              <span className="font-mono tabular-nums">{progressPercent.toFixed(1)}%</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-zinc-800">
              <div
                className={`h-full rounded-full transition-[width] duration-150 ${atIssueStop ? 'bg-red-500' : 'bg-cyan-500'}`}
                style={{ width: `${Math.min(100, progressPercent)}%` }}
              />
            </div>
            {!showDiscovery ? (
              <p className="text-[10px] text-zinc-500">
                {activeProbeCount} / {scanState.maxConcurrentProbes} 探針運行 · 共{' '}
                {totalProbeCount} 段軌道
              </p>
            ) : null}
          </div>
        ) : (
          <p className="text-[11px] text-zinc-500">尚未開始掃描</p>
        )}

        <div className="flex flex-wrap items-center gap-2">
          {phase === 'idle' || phase === 'complete' ? (
            <button
              type="button"
              onClick={onStart}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-cyan-500"
            >
              <Play className="size-3.5" aria-hidden />
              {phase === 'complete' ? '重新掃描' : '開始'}
            </button>
          ) : null}
          {phase === 'flashing' ? (
            <button
              type="button"
              onClick={onContinue}
              className="inline-flex items-center gap-1.5 rounded-lg bg-cyan-600/90 px-2.5 py-1 text-[11px] font-medium text-white hover:bg-cyan-500"
            >
              <SkipForward className="size-3.5" aria-hidden />
              繼續掃描
            </button>
          ) : null}
          {isRunning ? (
            <button
              type="button"
              onClick={onStop}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600/60 px-2.5 py-1 text-[11px] text-zinc-200 hover:bg-zinc-800/50"
            >
              <Square className="size-3.5" aria-hidden />
              停止
            </button>
          ) : null}
          {phase !== 'idle' ? (
            <button
              type="button"
              onClick={onReset}
              className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600/60 px-2.5 py-1 text-[11px] text-zinc-300 hover:bg-zinc-800/50"
            >
              <RotateCcw className="size-3.5" aria-hidden />
              重置
            </button>
          ) : null}
        </div>
      </div>

      {activeIssue && phase === 'flashing' ? (
        <div className={`${embedded ? 'mx-3 mb-2' : 'mx-4 mb-3'} rounded-lg border border-red-500/35 bg-red-950/25 px-3 py-2`}>
          <div className="flex items-start gap-2">
            <AlertTriangle className="mt-0.5 size-4 shrink-0 text-red-400" aria-hidden />
            <div className="min-w-0">
              <p className="text-xs font-medium text-red-200">
                {ISSUE_LABEL[activeIssue.kind]} · 附近區域
              </p>
              <p className="mt-0.5 text-[11px] leading-relaxed text-red-200/80">
                {issueVicinityLabel(activeIssue, segments)}
              </p>
              <p className="mt-1 text-[10px] leading-relaxed text-red-200/60">
                {activeIssue.message}
              </p>
              <button
                type="button"
                onClick={() => onSelectIssue(activeIssue.trackId, activeIssue.areaId)}
                className="mt-1 text-[11px] text-cyan-300 underline hover:text-cyan-200"
              >
                查看附近軌道
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {revealedIssues.length > 0 && phase === 'complete' ? (
        <div className={`${embedded ? 'mx-3 mb-2' : 'mx-4 mb-2'} border-t border-zinc-800/80 pt-2`}>
          <p className="mb-1 text-[10px] uppercase tracking-wide text-zinc-500">
            掃描已揭示
          </p>
          <ul className="space-y-1">
            {revealedIssues.map((issue) => (
              <li key={`${issue.kind}-${issue.trackId}-${issue.fieldPoint.xM}`}>
                <button
                  type="button"
                  onClick={() => onSelectIssue(issue.trackId, issue.areaId)}
                  className="w-full rounded px-2 py-1 text-left text-[11px] text-zinc-300 hover:bg-zinc-900"
                >
                  <span className="text-red-300">{ISSUE_LABEL[issue.kind]}</span>
                  {' · '}
                  {issueVicinityLabel(issue, segments)}
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {phase === 'complete' ? (
        <p className={`${embedded ? 'px-3 pb-2' : 'border-t border-zinc-800 px-4 py-3'} text-xs ${totalIssues === 0 ? 'text-emerald-400/90' : 'text-amber-200/90'}`}>
          {totalIssues === 0
            ? `掃描完成：${totalProbeCount} 個偵測點，未發現 refField 斷路。`
            : `掃描完成：${totalProbeCount} 個偵測點，${totalIssues} 個斷路問題。`}
        </p>
      ) : null}
    </div>
  );
}
