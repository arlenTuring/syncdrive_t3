import { useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let frame = 0;
let rafId = 0;
let subscriberCount = 0;
let lastTickAt = 0;

/** 模擬 UI 共用 tick（約 20fps），避免每張卡各自 60fps rAF 拖垮分頁 */
const MIN_INTERVAL_MS = 50;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function loop(now: number) {
  rafId = requestAnimationFrame(loop);
  if (now - lastTickAt < MIN_INTERVAL_MS) return;
  lastTickAt = now;
  frame += 1;
  emit();
}

function startLoop() {
  if (rafId !== 0) return;
  lastTickAt = performance.now();
  rafId = requestAnimationFrame(loop);
}

function stopLoop() {
  if (rafId === 0) return;
  cancelAnimationFrame(rafId);
  rafId = 0;
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener);
  subscriberCount += 1;
  if (subscriberCount === 1) startLoop();
  return () => {
    listeners.delete(listener);
    subscriberCount = Math.max(0, subscriberCount - 1);
    if (subscriberCount === 0) stopLoop();
  };
}

function getSnapshot(): number {
  return frame;
}

const noopSubscribe = () => () => {};

/**
 * 模擬播放中的共用畫面 tick。全儀表板只跑一條 rAF，訂閱者以 ~20fps 重繪。
 */
export function useSimClockFrame(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
}
