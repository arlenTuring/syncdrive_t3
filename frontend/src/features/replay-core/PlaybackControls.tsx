import { SiteSelect } from '../../components/SiteSelect';
import { Pause, Play, SkipBack, SkipForward } from "lucide-react";
import type { ReactNode } from "react";
import type { TimelineGap, ReplayFrame } from "./replayState";
import { formatClock, formatClockMs, formatDateTime, REPLAY_TIME_ZONE } from "./time";
import { GAP_REASON, SOURCE_LABEL, STREAM_LABEL } from "./replayLabels";
import { REPLAY_SPEEDS, type ReplayPlayer, type ReplaySpeed } from "./useReplayPlayer";
import { IconButton } from '../../components/ui';

/**
 * 回放控制列（一般運行紀錄、歷史降級共用）：播放／暫停、上一幀／下一幀、時間軸（含缺段）、
 * 倍速，以及目前這一幀的來源與在同一毫秒中的位置。
 */
export function PlaybackControls({
  heading,
  subtitle,
  window_,
  player,
  gaps,
  timelineLabel,
  emptyMessage,
}: {
  heading: string;
  subtitle?: ReactNode;
  window_: { from: number; to: number; ongoing: boolean } | null;
  player: ReplayPlayer;
  gaps: readonly TimelineGap[];
  /** 時間軸是哪一種時間（營運時間／後端收到時間） */
  timelineLabel: string;
  emptyMessage: string;
}) {
  const span = window_ ? Math.max(1, window_.to - window_.from) : 1;
  const cursor = player.cursor;
  const disabled = cursor == null || !window_;
  const onKeyDown = (event: React.KeyboardEvent) => {
    if (disabled) return;
    if (event.key === "ArrowLeft" && event.shiftKey) {
      event.preventDefault();
      player.stepPrev();
    } else if (event.key === "ArrowRight" && event.shiftKey) {
      event.preventDefault();
      player.stepNext();
    }
  };
  return (
    <div className="mt-3 shrink-0 rounded-2xl border border-border-quaternary bg-surface-sub-background px-5 py-4" onKeyDown={onKeyDown}>
      <h3 className="text-text-theme">{heading}</h3>
      {!window_ ? (
        <p className="mt-2 text-body-s text-text-quaternary">{emptyMessage}</p>
      ) : (
        <>
          <p className="mt-1 text-body-s text-text-secondary">
            {subtitle ? <>{subtitle}{"\u3000"}</> : null}
            {formatDateTime(window_.from)}～{formatClock(window_.to)}
            {window_.ongoing ? "（進行中，載入時為止）" : ""}
            <span className="ml-2 text-body-xs text-text-quaternary">
              {timelineLabel}・{REPLAY_TIME_ZONE}
            </span>
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2 sm:flex-nowrap sm:gap-3">
            <IconButton
              label="上一幀"
              title="上一幀（Shift＋←）"
              hierarchy="subordinate"
              variant="tonal"
              onPress={player.stepPrev}
              disabled={disabled || player.stepping || player.atStart}
              icon={<SkipBack />}
            />
            <IconButton
              label={player.playing ? "暫停" : "播放"}
              onPress={player.playing ? player.pause : player.play}
              disabled={disabled}
              icon={player.playing ? <Pause /> : <Play />}
            />
            <IconButton
              label="下一幀"
              title="下一幀（Shift＋→）"
              hierarchy="subordinate"
              variant="tonal"
              onPress={player.stepNext}
              disabled={disabled || player.stepping || player.atEnd}
              icon={<SkipForward />}
            />
            <span className="w-28 shrink-0 font-mono text-body-s text-text-primary" aria-live="polite">
              {cursor != null ? formatClockMs(cursor.t) : "—"}
            </span>
            <div className="relative order-last w-full min-w-0 flex-1 sm:order-none sm:w-auto">
              <div className="pointer-events-none absolute inset-x-0 top-1/2 h-1.5 -translate-y-1/2">
                {gaps
                  .filter((gap) => gap.from != null)
                  .map((gap, index) => {
                    const from = Math.max(0, (gap.from! - window_.from) / span);
                    const to = Math.min(1, ((gap.to ?? window_.to) - window_.from) / span);
                    if (to <= 0 || from >= 1) return null;
                    return (
                      <span
                        key={index}
                        className={`absolute h-full rounded ${gap.reason === "not_recorded" ? "bg-status-inactive-light" : "bg-status-error-light"}`}
                        style={{ left: `${from * 100}%`, width: `${Math.max(0.5, (to - from) * 100)}%` }}
                        title={GAP_REASON[gap.reason] ?? gap.reason}
                      />
                    );
                  })}
              </div>
              <input
                type="range"
                min={0}
                max={span}
                step={1}
                value={cursor != null ? Math.min(span, Math.max(0, cursor.t - window_.from)) : 0}
                onChange={(event) => player.seek(window_.from + Number(event.target.value))}
                aria-label="回放時間軸"
                className="relative w-full accent-link-theme-filled"
              />
            </div>
            <SiteSelect
              value={player.speed}
              onChange={(event) => player.setSpeed(Number(event.target.value) as ReplaySpeed)}
              aria-label="回放倍速"
              size="sm"
              className="shrink-0"
            >
              {REPLAY_SPEEDS.map((speed) => (
                <option key={speed} value={speed}>
                  {speed}×
                </option>
              ))}
            </SiteSelect>
          </div>
          <FrameInfo player={player} />
        </>
      )}
    </div>
  );
}

/** 目前這一幀：來源、序號、同一毫秒第幾筆；連續播放時游標是整毫秒，顯示最後套用的那一筆 */
function FrameInfo({ player }: { player: ReplayPlayer }) {
  const frame: ReplayFrame | null = player.state?.last ?? null;
  const position = player.framePosition;
  return (
    <div className="mt-2 flex flex-wrap items-center gap-x-4 gap-y-1 text-body-xs text-text-quaternary">
      {frame ? (
        <>
          <span>
            目前幀：<span className="text-text-secondary">{STREAM_LABEL[frame.stream] ?? frame.stream}</span>
            {frame.vehicle_code ? `・${frame.vehicle_code}` : ""}
            {frame.source ? `・${SOURCE_LABEL[frame.source] ?? frame.source}` : ""}
          </span>
          <span className="font-mono">seq {frame.seq}</span>
          {position ? (
            <span>
              同一毫秒第 {position.index}／{position.total} 筆
            </span>
          ) : null}
          {player.cursor?.seq == null ? <span>（連續播放：已套用到這一毫秒的全部資料）</span> : null}
        </>
      ) : (
        <span>目前幀：起點狀態（游標之前最後保存的資料）</span>
      )}
      {player.atStart ? <span className="text-status-warning">已是第一幀</span> : null}
      {player.atEnd ? <span className="text-status-warning">已是最後一幀</span> : null}
      {player.buffering || player.stepping ? <span>載入回放資料…</span> : null}
      <span className="ml-auto hidden text-text-disabled sm:inline">逐幀：Shift＋← ／ Shift＋→</span>
    </div>
  );
}
