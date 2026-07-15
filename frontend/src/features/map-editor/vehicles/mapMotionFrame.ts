/** @deprecated 圖台車輛改共用 dashboard/utils/simClockFrame（~20fps），避免第二條 60fps rAF */
import { useSyncExternalStore } from 'react';

type Listener = () => void;

const listeners = new Set<Listener>();
let frame = 0;
let rafId = 0;
let subscriberCount = 0;
let lastTickAt = 0;

/** 圖台車輛專用 tick（~60fps），不拖高整個儀表板卡片 */
const MAP_MOTION_INTERVAL_MS = 16;

function emit() {
  for (const listener of listeners) {
    listener();
  }
}

function loop(now: number) {
  rafId = requestAnimationFrame(loop);
  if (now - lastTickAt < MAP_MOTION_INTERVAL_MS) return;
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

export function useMapMotionFrame(enabled: boolean): number {
  return useSyncExternalStore(
    enabled ? subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
}
