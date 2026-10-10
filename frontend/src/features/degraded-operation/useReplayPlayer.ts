import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  fetchReplayFrames,
  fetchReplaySnapshot,
  type ReplayFrame,
  type ReplayMeta,
} from "./api";
import {
  stateAt,
  stateFromSnapshot,
  type ReplayState,
} from "./replayState";

/** 一次要多長的營運時間（後端另有筆數上限，沒拿完會從斷點接著要） */
const WINDOW_MS = 10 * 60_000;
/** 已載入範圍剩下不到這個比例時先要下一段 */
const PREFETCH_RATIO = 0.35;
/** 往前拖曳時合併請求的間隔 */
const SEEK_DEBOUNCE_MS = 120;
/** 往前播放時，載入的資料超過這麼多筆就把起點往前移，避免一直累積 */
const REBASE_AFTER_FRAMES = 40_000;

export const REPLAY_SPEEDS = [1, 10, 60] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

type Buffer = {
  /** 起點時刻與起點狀態（snapshot） */
  baseAt: number;
  base: ReplayState;
  /** 起點之後的資料，依（營運時間, seq）排序 */
  frames: ReplayFrame[];
  /** 保證完整到哪個時刻 */
  coveredTo: number;
  next: { from: number; afterSeq: number } | null;
};

export type ReplayPlayer = {
  cursor: number | null;
  playing: boolean;
  speed: ReplaySpeed;
  /** 起點或下一段資料還在路上 */
  buffering: boolean;
  error: string | null;
  state: ReplayState | null;
  /** 最近一次狀態是跳轉（拖曳、切換）得來的：畫面不補間 */
  jumped: boolean;
  /** 本段資料相鄰兩筆遙測的營運時間間隔（決定補間長度） */
  frames: readonly ReplayFrame[];
  play: () => void;
  pause: () => void;
  seek: (at: number) => void;
  setSpeed: (speed: ReplaySpeed) => void;
};

/**
 * 歷史回放的播放器：游標、播放／暫停、拖曳、分段載入。
 *
 * 只讀歷史 API；不改營運時鐘、不寫訂單、不送 MQTT。一個實例只服務一筆紀錄：呼叫端以
 * executionId 當 key 重建，換紀錄時前一筆的播放、請求、資料一起丟掉，過期回應不會蓋到
 * 新選的那一筆上。
 */
export function useReplayPlayer(
  executionId: string | null,
  meta: ReplayMeta | null,
): ReplayPlayer {
  const window_ = meta?.window ?? null;
  const replayable =
    !!executionId &&
    !!window_ &&
    (meta?.availability.state === "complete" ||
      meta?.availability.state === "partial" ||
      meta?.availability.state === "recording");

  // 還沒操作過時游標在實際開始時間；換紀錄由呼叫端以 key 重建，狀態自然歸零
  const [cursorState, setCursor] = useState<number | null>(null);
  const cursor = replayable ? (cursorState ?? window_?.from_operating ?? null) : null;
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [buffer, setBuffer] = useState<Buffer | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumped, setJumped] = useState(true);

  const generation = useRef(0);
  const seekController = useRef<AbortController | null>(null);
  const prefetchController = useRef<AbortController | null>(null);
  const seekTimer = useRef<number | null>(null);
  const bufferRef = useRef(buffer);
  const cursorRef = useRef(cursor);
  useLayoutEffect(() => {
    bufferRef.current = buffer;
    cursorRef.current = cursor;
  });

  const abortAll = useCallback(() => {
    seekController.current?.abort();
    prefetchController.current?.abort();
    seekController.current = null;
    prefetchController.current = null;
    if (seekTimer.current) window.clearTimeout(seekTimer.current);
    seekTimer.current = null;
  }, []);

  const load = useCallback(
    async (at: number) => {
      if (!executionId || !window_) return;
      const ticket = generation.current;
      seekController.current?.abort();
      prefetchController.current?.abort();
      const controller = new AbortController();
      seekController.current = controller;
      try {
        const to = Math.min(window_.to_operating, at + WINDOW_MS);
        const [snapshot, page] = await Promise.all([
          fetchReplaySnapshot(executionId, at, controller.signal),
          // 起點（含）以前的都在 snapshot 裡：之後的從嚴格大於起點開始
          fetchReplayFrames(
            executionId,
            { from: at, to, afterSeq: Number.MAX_SAFE_INTEGER },
            controller.signal,
          ),
        ]);
        if (ticket !== generation.current || controller.signal.aborted) return;
        setBuffer({
          baseAt: at,
          base: stateFromSnapshot(snapshot.frames, snapshot.reference),
          frames: page.frames,
          coveredTo: page.covered_to,
          next: page.next
            ? { from: page.next.from, afterSeq: page.next.after_seq }
            : null,
        });
        setError(null);
      } catch (reason) {
        if (controller.signal.aborted || ticket !== generation.current) return;
        setError(reason instanceof Error ? reason.message : "回放資料載入失敗");
        setPlaying(false);
      } finally {
        if (ticket === generation.current && seekController.current === controller) {
          seekController.current = null;
          setBuffering(false);
        }
      }
    },
    [executionId, window_],
  );

  // 從實際開始時間載入；離開（換紀錄、返回即時）時取消所有請求，過期回應不再寫入
  useEffect(() => {
    if (!replayable || !window_) return undefined;
    const ticket = generation.current;
    // load 只在請求回來之後才寫狀態（非同步），不是在 effect 裡同步 setState
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load(window_.from_operating);
    return () => {
      if (generation.current === ticket) generation.current += 1;
      abortAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [executionId, replayable, window_?.from_operating]);

  const seek = useCallback(
    (raw: number) => {
      if (!window_) return;
      const at = Math.max(window_.from_operating, Math.min(window_.to_operating, raw));
      setCursor(at);
      setJumped(true);
      const current = bufferRef.current;
      // 已載入範圍內（含往回到起點為止）：直接重建，不打 API
      if (current && at >= current.baseAt && at <= current.coveredTo) return;
      if (seekTimer.current) window.clearTimeout(seekTimer.current);
      setBuffering(true);
      seekTimer.current = window.setTimeout(() => {
        seekTimer.current = null;
        void load(at);
      }, SEEK_DEBOUNCE_MS);
    },
    [load, window_],
  );

  // 下一段：快播到已載入範圍的尾巴前先要
  useEffect(() => {
    if (!executionId || !window_ || !buffer || cursor == null) return;
    if (prefetchController.current || seekController.current) return;
    const atEnd = buffer.coveredTo >= window_.to_operating && !buffer.next;
    if (atEnd) return;
    const span = Math.max(1, buffer.coveredTo - buffer.baseAt);
    if (cursor < buffer.coveredTo - span * PREFETCH_RATIO) return;
    const ticket = generation.current;
    const controller = new AbortController();
    prefetchController.current = controller;
    const from = buffer.next?.from ?? buffer.coveredTo;
    const afterSeq =
      buffer.next?.afterSeq ?? buffer.frames.at(-1)?.seq ?? Number.MAX_SAFE_INTEGER;
    const to = Math.min(window_.to_operating, from + WINDOW_MS);
    void fetchReplayFrames(executionId, { from, to, afterSeq }, controller.signal)
      .then((page) => {
        if (ticket !== generation.current || controller.signal.aborted) return;
        setBuffer((current) => {
          if (!current || current.coveredTo !== buffer.coveredTo) return current;
          const merged = current.frames.concat(page.frames);
          let next: Buffer = {
            ...current,
            frames: merged,
            coveredTo: page.covered_to,
            next: page.next ? { from: page.next.from, afterSeq: page.next.after_seq } : null,
          };
          // 起點往前移：把游標前一段收進起點狀態，不讓記憶體一直長
          const at = cursorRef.current ?? current.baseAt;
          if (merged.length > REBASE_AFTER_FRAMES && at > current.baseAt) {
            const index = merged.findIndex((frame) => frame.operating_at > at);
            const cut = index < 0 ? merged.length : index;
            next = {
              ...next,
              baseAt: at,
              base: stateAt(current.base, merged.slice(0, cut), at),
              frames: merged.slice(cut),
            };
          }
          return next;
        });
      })
      .catch((reason) => {
        if (controller.signal.aborted || ticket !== generation.current) return;
        setError(reason instanceof Error ? reason.message : "回放資料載入失敗");
        setPlaying(false);
      })
      .finally(() => {
        if (prefetchController.current === controller) prefetchController.current = null;
      });
  }, [buffer, cursor, executionId, window_]);

  // 播放：游標照倍速推進；資料沒到就等，到結束時間停，不循環
  useEffect(() => {
    if (!playing || !window_) return undefined;
    let frame = 0;
    let last = performance.now();
    const step = (now: number) => {
      const elapsed = now - last;
      last = now;
      const current = bufferRef.current;
      const at = cursorRef.current;
      if (current && at != null && at < current.coveredTo) {
        const target = Math.min(at + elapsed * speed, current.coveredTo, window_.to_operating);
        setJumped(false);
        setCursor(target);
        if (target >= window_.to_operating) {
          setPlaying(false);
          return;
        }
      } else if (current && at != null && at >= window_.to_operating) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(step);
    };
    frame = requestAnimationFrame(step);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, window_]);

  const state = useMemo(() => {
    if (!buffer || cursor == null || cursor < buffer.baseAt) return null;
    return stateAt(buffer.base, buffer.frames, cursor);
  }, [buffer, cursor]);

  const play = useCallback(() => {
    if (!window_ || cursorRef.current == null) return;
    // 停在結尾時再按播放：從頭開始
    if (cursorRef.current >= window_.to_operating) seek(window_.from_operating);
    setPlaying(true);
  }, [seek, window_]);
  const pause = useCallback(() => setPlaying(false), []);

  return {
    cursor,
    playing,
    speed,
    // 第一段還沒到也算載入中
    buffering: buffering || (replayable && !buffer && !error),
    error,
    state,
    jumped,
    frames: buffer?.frames ?? EMPTY_FRAMES,
    play,
    pause,
    seek,
    setSpeed,
  };
}

const EMPTY_FRAMES: readonly ReplayFrame[] = [];
