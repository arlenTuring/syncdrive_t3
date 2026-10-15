import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { cursorOf, cursorOrder, type ReplayCursor } from "./cursor";
import {
  nextFrameCursor,
  positionInMillisecond,
  prevFrameCursor,
  stateAt,
  stateFromSnapshot,
  type ReplayFrame,
  type ReplayState,
} from "./replayState";

/** 一次要多長的回放時間（後端另有筆數上限，沒拿完會從斷點接著要） */
const WINDOW_MS = 10 * 60_000;
/** 已載入範圍剩下不到這個比例時先要下一段 */
const PREFETCH_RATIO = 0.35;
/** 拖曳時合併請求的間隔 */
const SEEK_DEBOUNCE_MS = 120;
/** 往前播放時，載入的資料超過這麼多筆就把起點往前移，避免一直累積（記憶體上限） */
const REBASE_AFTER_FRAMES = 40_000;

export const REPLAY_SPEEDS = [1, 10, 60] as const;
export type ReplaySpeed = (typeof REPLAY_SPEEDS)[number];

/** 回放資料來源（一般運行紀錄、歷史降級各自實作；只讀） */
export type ReplaySource = {
  /** 來源身分：換了就整個重建（呼叫端以它當 key） */
  key: string;
  window: { from: number; to: number; ongoing: boolean };
  snapshot: (
    cursor: ReplayCursor,
    signal: AbortSignal,
  ) => Promise<{ frames: ReplayFrame[]; reference: { received_at: number; t: number; seq: string } | null }>;
  /** 嚴格晚於 after 的資料，到 to（含）為止 */
  frames: (
    input: { after: ReplayCursor; to: number },
    signal: AbortSignal,
  ) => Promise<{ frames: ReplayFrame[]; coveredTo: number; next: ReplayCursor | null }>;
  /** 嚴格早於／晚於游標的那一筆 */
  neighbor: (cursor: ReplayCursor, dir: "prev" | "next", signal: AbortSignal) => Promise<ReplayFrame | null>;
};

type Buffer = {
  /** 起點游標與起點狀態（snapshot） */
  baseCursor: ReplayCursor;
  base: ReplayState;
  /** 起點之後的資料，依 (t, seq) 排序 */
  frames: ReplayFrame[];
  /** 保證完整到哪個時刻（含） */
  coveredTo: number;
  next: ReplayCursor | null;
};

export type ReplayPlayer = {
  cursor: ReplayCursor | null;
  playing: boolean;
  speed: ReplaySpeed;
  /** 起點或下一段資料還在路上 */
  buffering: boolean;
  error: string | null;
  state: ReplayState | null;
  /** 最近一次狀態是跳轉、逐幀得來的：畫面不補間，直接呈現 */
  jumped: boolean;
  /** 已載入的期間資料（補間長度、同毫秒筆數用） */
  frames: readonly ReplayFrame[];
  /** 游標所在那一筆在同一毫秒中的位置 */
  framePosition: { index: number; total: number } | null;
  /** 上一幀／下一幀已經到頭（起點、終點） */
  atStart: boolean;
  atEnd: boolean;
  stepping: boolean;
  play: () => void;
  pause: () => void;
  seek: (t: number) => void;
  stepNext: () => void;
  stepPrev: () => void;
  setSpeed: (speed: ReplaySpeed) => void;
};

/**
 * 歷史回放播放器：游標、播放／暫停、拖曳、逐幀、分段載入。
 *
 * 只讀歷史 API；不改營運時鐘、不寫訂單、不送 MQTT。一個實例只服務一個來源：呼叫端以
 * source.key 當 key 重建，換來源時前一個的播放、請求、資料一起丟掉，過期回應不會蓋到新的上。
 * 查詢成功後停在起點，不自動播放。
 */
export function useReplayPlayer(source: ReplaySource | null): ReplayPlayer {
  const window_ = source?.window ?? null;
  const [cursorState, setCursor] = useState<ReplayCursor | null>(null);
  const cursor = useMemo<ReplayCursor | null>(
    () => (source ? (cursorState ?? (window_ ? { t: window_.from, seq: null } : null)) : null),
    [cursorState, source, window_],
  );
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<ReplaySpeed>(1);
  const [buffer, setBuffer] = useState<Buffer | null>(null);
  const [buffering, setBuffering] = useState(false);
  const [stepping, setStepping] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [jumped, setJumped] = useState(true);
  const [edge, setEdge] = useState<{ start: boolean; end: boolean }>({ start: false, end: false });

  const generation = useRef(0);
  const seekController = useRef<AbortController | null>(null);
  const prefetchController = useRef<AbortController | null>(null);
  const stepController = useRef<AbortController | null>(null);
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
    stepController.current?.abort();
    seekController.current = null;
    prefetchController.current = null;
    stepController.current = null;
    if (seekTimer.current) window.clearTimeout(seekTimer.current);
    seekTimer.current = null;
  }, []);

  /**
   * 從指定游標重建：起點快照＋之後一段資料。
   * exact（逐幀落在已載入範圍外）：起點取「那一毫秒之前」，讓同一毫秒的每一筆都在已載入資料裡，
   * 游標所在那一筆、它在同一毫秒的位置、前後幀都能就地算出。
   */
  const load = useCallback(
    async (at: ReplayCursor, exact = false) => {
      if (!source || !window_) return;
      const ticket = generation.current;
      seekController.current?.abort();
      prefetchController.current?.abort();
      const controller = new AbortController();
      seekController.current = controller;
      setBuffering(true);
      try {
        const baseCursor: ReplayCursor = exact && at.seq != null ? { t: at.t - 1, seq: null } : at;
        const to = Math.min(window_.to, baseCursor.t + WINDOW_MS);
        const [snapshot, page] = await Promise.all([
          source.snapshot(baseCursor, controller.signal),
          source.frames({ after: baseCursor, to }, controller.signal),
        ]);
        if (ticket !== generation.current || controller.signal.aborted) return;
        setBuffer({
          baseCursor,
          base: stateFromSnapshot(snapshot.frames, snapshot.reference),
          frames: page.frames,
          coveredTo: page.coveredTo,
          next: page.next,
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
    [source, window_],
  );

  // 停在起點：從可回放範圍開頭載入；離開時取消所有請求，過期回應不再寫入
  useEffect(() => {
    if (!source || !window_) return undefined;
    const ticket = generation.current;
    // load 只在請求回來之後才寫狀態（非同步）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load({ t: window_.from, seq: null });
    return () => {
      if (generation.current === ticket) generation.current += 1;
      abortAll();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [source?.key, window_?.from]);

  const inBuffer = useCallback((at: ReplayCursor) => {
    const current = bufferRef.current;
    return !!current && cursorOrder(at, current.baseCursor) >= 0 && at.t <= current.coveredTo;
  }, []);

  const seek = useCallback(
    (raw: number) => {
      if (!window_) return;
      const t = Math.max(window_.from, Math.min(window_.to, Math.round(raw)));
      const at = { t, seq: null };
      setCursor(at);
      setJumped(true);
      setEdge({ start: false, end: false });
      // 已載入範圍內（含往回到起點為止）：直接重建，不打 API
      if (inBuffer(at)) return;
      if (seekTimer.current) window.clearTimeout(seekTimer.current);
      setBuffering(true);
      seekTimer.current = window.setTimeout(() => {
        seekTimer.current = null;
        void load(at);
      }, SEEK_DEBOUNCE_MS);
    },
    [inBuffer, load, window_],
  );

  /** 逐幀：自動暫停，精確移到相鄰那一筆；超出已載入範圍就向後端要相鄰那一筆再重建 */
  const step = useCallback(
    async (dir: "prev" | "next") => {
      const current = bufferRef.current;
      const at = cursorRef.current;
      if (!source || !window_ || !current || !at) return;
      // 拖曳後還沒送出的載入：以逐幀為準
      if (seekTimer.current) {
        window.clearTimeout(seekTimer.current);
        seekTimer.current = null;
        if (!inBuffer(at)) {
          setPlaying(false);
          await load(at);
          return;
        }
      }
      setPlaying(false);
      setJumped(true);
      if (dir === "next") {
        const local = nextFrameCursor(current.frames, at);
        if (local && local.t <= window_.to) {
          setCursor(local);
          setEdge({ start: false, end: false });
          return;
        }
      } else {
        // 只在前一筆也在已載入資料裡時就地退；退到起點快照時改問後端，才知道確切是哪一筆
        const local = prevFrameCursor(current.frames, at, current.baseCursor);
        if (local !== "outside" && local !== current.baseCursor && cursorOrder(local, at) < 0 && local.t >= window_.from) {
          setCursor(local);
          setEdge({ start: false, end: false });
          return;
        }
      }
      // 已載入範圍以外：問後端相鄰那一筆（同一毫秒也精確），不跳筆、不倒推
      stepController.current?.abort();
      const controller = new AbortController();
      stepController.current = controller;
      const ticket = generation.current;
      setStepping(true);
      try {
        let anchor: ReplayCursor = at;
        if (dir === "prev" && at.seq == null) {
          // 游標是整毫秒：游標所在那一筆＝不晚於它的最後一筆，退掉它才是上一幀
          const currentFrame = await source.neighbor({ t: at.t, seq: null }, "prev", controller.signal);
          if (!currentFrame) {
            setEdge({ start: true, end: false });
            return;
          }
          anchor = cursorOf(currentFrame);
        }
        const target = await source.neighbor(anchor, dir, controller.signal);
        if (ticket !== generation.current || controller.signal.aborted) return;
        if (!target || target.t < window_.from || target.t > window_.to) {
          setEdge({ start: dir === "prev", end: dir === "next" });
          return;
        }
        const targetCursor = cursorOf(target);
        setCursor(targetCursor);
        setEdge({ start: false, end: false });
        const latest = bufferRef.current;
        if (!latest || !inBuffer(targetCursor) || !latest.frames.some((frame) => frame.seq === target.seq))
          await load(targetCursor, true);
      } catch (reason) {
        if (controller.signal.aborted || ticket !== generation.current) return;
        setError(reason instanceof Error ? reason.message : "逐幀資料載入失敗");
      } finally {
        if (stepController.current === controller) {
          stepController.current = null;
          setStepping(false);
        }
      }
    },
    [inBuffer, load, source, window_],
  );

  // 下一段：播放或逐幀接近已載入範圍的尾巴前先要
  useEffect(() => {
    if (!source || !window_ || !buffer || cursor == null) return;
    if (prefetchController.current || seekController.current) return;
    const atEnd = buffer.coveredTo >= window_.to && !buffer.next;
    if (atEnd) return;
    const span = Math.max(1, buffer.coveredTo - buffer.baseCursor.t);
    if (cursor.t < buffer.coveredTo - span * PREFETCH_RATIO) return;
    const ticket = generation.current;
    const controller = new AbortController();
    prefetchController.current = controller;
    const lastFrame = buffer.frames.at(-1);
    const after: ReplayCursor = buffer.next ?? (lastFrame && lastFrame.t >= buffer.coveredTo ? cursorOf(lastFrame) : { t: buffer.coveredTo, seq: null });
    const to = Math.min(window_.to, after.t + WINDOW_MS);
    void source
      .frames({ after, to }, controller.signal)
      .then((page) => {
        if (ticket !== generation.current || controller.signal.aborted) return;
        setBuffer((current) => {
          if (!current || current.coveredTo !== buffer.coveredTo || current.baseCursor !== buffer.baseCursor) return current;
          const merged = current.frames.concat(page.frames);
          let next: Buffer = { ...current, frames: merged, coveredTo: page.coveredTo, next: page.next };
          // 起點往前移：把游標前一段收進起點狀態，不讓記憶體一直長
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
        if (controller.signal.aborted || ticket !== generation.current) return;
        setError(reason instanceof Error ? reason.message : "回放資料載入失敗");
        setPlaying(false);
      })
      .finally(() => {
        if (prefetchController.current === controller) prefetchController.current = null;
      });
  }, [buffer, cursor, source, window_]);

  // 播放：游標照倍速推進；資料沒到就等，到結束時間停，不循環
  useEffect(() => {
    if (!playing || !window_) return undefined;
    let frame = 0;
    let last = performance.now();
    const tick = (now: number) => {
      const elapsed = now - last;
      last = now;
      const current = bufferRef.current;
      const at = cursorRef.current;
      if (current && at != null && at.t < current.coveredTo) {
        const target = Math.min(at.t + elapsed * speed, current.coveredTo, window_.to);
        setJumped(false);
        setCursor({ t: target, seq: null });
        if (target >= window_.to) {
          setPlaying(false);
          return;
        }
      } else if (current && at != null && at.t >= window_.to) {
        setPlaying(false);
        return;
      }
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(frame);
  }, [playing, speed, window_]);

  const state = useMemo(() => {
    if (!buffer || cursor == null || cursorOrder(cursor, buffer.baseCursor) < 0) return null;
    return stateAt(buffer.base, buffer.frames, cursor);
  }, [buffer, cursor]);

  const play = useCallback(() => {
    if (!window_ || cursorRef.current == null) return;
    // 停在結尾時再按播放：從頭開始
    if (cursorRef.current.t >= window_.to) seek(window_.from);
    setEdge({ start: false, end: false });
    setPlaying(true);
  }, [seek, window_]);
  const pause = useCallback(() => setPlaying(false), []);
  const stepNext = useCallback(() => void step("next"), [step]);
  const stepPrev = useCallback(() => void step("prev"), [step]);

  const frames = buffer?.frames ?? EMPTY_FRAMES;
  return {
    cursor,
    playing,
    speed,
    buffering: buffering || (!!source && !buffer && !error),
    error,
    state,
    jumped,
    frames,
    framePosition: positionInMillisecond(frames, state?.last ?? null),
    atStart: edge.start || (cursor != null && window_ != null && cursor.t <= window_.from && !state?.last),
    atEnd: edge.end,
    stepping,
    play,
    pause,
    seek,
    stepNext,
    stepPrev,
    setSpeed,
  };
}

const EMPTY_FRAMES: readonly ReplayFrame[] = [];
