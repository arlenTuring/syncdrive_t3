import { useEffect, useMemo, useRef, useState } from "react";
import { cursorOf, cursorOrder, type ReplayCursor } from "./cursor";
import { stateAt, stateFromSnapshot, type ReplayFrame, type ReplayState } from "./replayState";
import type { ReplaySource } from "./useReplayPlayer";

/** 一次要多長的背景資料 */
const WINDOW_MS = 5 * 60_000;
const PREFETCH_RATIO = 0.35;
/** 游標跳出已載入範圍後，合併請求的間隔 */
const RELOAD_DEBOUNCE_MS = 150;
const REBASE_AFTER_FRAMES = 40_000;

export type BackgroundSource = Pick<ReplaySource, "key" | "window" | "snapshot" | "frames">;

type Buffer = {
  baseCursor: ReplayCursor;
  base: ReplayState;
  frames: ReplayFrame[];
  coveredTo: number;
  next: ReplayCursor | null;
};

/**
 * 背景狀態：跟著別人的游標（調查載具的游標）重建「當時其他車與場站」的狀態。
 *
 * 自己分段載入、自己預取，但沒有自己的游標、不能逐幀，也不會把資料塞進調查載具的序列。
 * 游標之後的資料一筆都不套用（序號是全表共用的 bigserial，(t, seq) 可以跨範圍比較）。
 * 游標跳出已載入範圍時回 null，不拿別的時刻的背景頂著。
 */
export function useBackgroundState(source: BackgroundSource | null, cursor: ReplayCursor | null): {
  state: ReplayState | null;
  loading: boolean;
  error: string | null;
} {
  const [buffer, setBuffer] = useState<Buffer | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loadController = useRef<AbortController | null>(null);
  const prefetchController = useRef<AbortController | null>(null);
  const timer = useRef<number | null>(null);
  const cursorRef = useRef(cursor);
  useEffect(() => {
    cursorRef.current = cursor;
  });

  // 換來源：丟掉一切，過期回應不寫回
  useEffect(() => {
    return () => {
      loadController.current?.abort();
      prefetchController.current?.abort();
      if (timer.current) window.clearTimeout(timer.current);
      loadController.current = null;
      prefetchController.current = null;
      timer.current = null;
    };
  }, [source]);

  const covers = (current: Buffer | null, at: ReplayCursor | null) =>
    !!current && !!at && cursorOrder(at, current.baseCursor) >= 0 && at.t <= current.coveredTo;

  // 游標跳出範圍：從游標重新載入（起點快照＋之後一段）
  useEffect(() => {
    if (!source || !cursor || covers(buffer, cursor)) return undefined;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      timer.current = null;
      const at = cursorRef.current;
      if (!at) return;
      loadController.current?.abort();
      prefetchController.current?.abort();
      prefetchController.current = null;
      const controller = new AbortController();
      loadController.current = controller;
      const base: ReplayCursor = { t: at.t, seq: at.seq };
      const to = Math.min(source.window.to, base.t + WINDOW_MS);
      void Promise.all([source.snapshot(base, controller.signal), source.frames({ after: base, to }, controller.signal)])
        .then(([snapshot, page]) => {
          if (controller.signal.aborted) return;
          setBuffer({ baseCursor: base, base: stateFromSnapshot(snapshot.frames, snapshot.reference), frames: page.frames, coveredTo: page.coveredTo, next: page.next });
          setError(null);
        })
        .catch((reason) => {
          if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "背景資料載入失敗");
        })
        .finally(() => {
          if (loadController.current === controller) loadController.current = null;
        });
    }, RELOAD_DEBOUNCE_MS);
    return undefined;
    // eslint-disable-next-line react-hooks/exhaustive-deps -- 只在游標跳出範圍時重載
  }, [source, cursor?.t, cursor?.seq, buffer]);

  // 預取下一段
  useEffect(() => {
    if (!source || !buffer || !cursor || !covers(buffer, cursor)) return;
    if (prefetchController.current || loadController.current) return;
    if (buffer.coveredTo >= source.window.to && !buffer.next) return;
    const span = Math.max(1, buffer.coveredTo - buffer.baseCursor.t);
    if (cursor.t < buffer.coveredTo - span * PREFETCH_RATIO) return;
    const controller = new AbortController();
    prefetchController.current = controller;
    const last = buffer.frames.at(-1);
    const after: ReplayCursor = buffer.next ?? (last && last.t >= buffer.coveredTo ? cursorOf(last) : { t: buffer.coveredTo, seq: null });
    const to = Math.min(source.window.to, after.t + WINDOW_MS);
    void source
      .frames({ after, to }, controller.signal)
      .then((page) => {
        if (controller.signal.aborted) return;
        setBuffer((current) => {
          if (current !== buffer) return current;
          const merged = current.frames.concat(page.frames);
          let next: Buffer = { ...current, frames: merged, coveredTo: page.coveredTo, next: page.next };
          const at = cursorRef.current;
          if (merged.length > REBASE_AFTER_FRAMES && at && cursorOrder(at, current.baseCursor) > 0) {
            const index = merged.findIndex((frame) => cursorOrder(cursorOf(frame), at) > 0);
            const cut = index < 0 ? merged.length : index;
            next = { ...next, baseCursor: at, base: stateAt(current.base, merged.slice(0, cut), at), frames: merged.slice(cut) };
          }
          return next;
        });
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason instanceof Error ? reason.message : "背景資料載入失敗");
      })
      .finally(() => {
        if (prefetchController.current === controller) prefetchController.current = null;
      });
  }, [buffer, cursor, source]);

  const state = useMemo(
    () => (source && buffer && cursor && covers(buffer, cursor) ? stateAt(buffer.base, buffer.frames, cursor) : null),
    [buffer, cursor, source],
  );
  return { state, loading: !!source && !!cursor && !state && !error, error };
}
