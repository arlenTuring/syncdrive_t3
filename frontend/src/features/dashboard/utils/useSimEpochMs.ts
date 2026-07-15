import { useEffect, useRef } from 'react';
import type { DemoSimulationTransport } from '../api/demoSimulation';
import { useSimClockFrame } from './simClockFrame';

export type SimEpoch = { baseMs: number; wallAt: number; speed: number };

export function readEpochFromTransport(transport: DemoSimulationTransport | null): SimEpoch {
  const baseMs = transport?.virtualElapsedMs ?? 0;
  const wallAt =
    transport?.lastAckWallMs && Number.isFinite(transport.lastAckWallMs)
      ? transport.lastAckWallMs
      : Date.now();
  const speed = transport?.speedMultiplier ?? 1;
  return { baseMs, wallAt, speed };
}

export function extrapolateEpochMs(epoch: SimEpoch): number {
  return epoch.baseMs + (Date.now() - epoch.wallAt) * epoch.speed;
}

/**
 * 連續模擬時鐘（與工具列相同）：不在每筆 MQTT 重設錨點，避免高倍速 lerp 失效。
 */
export function useSimEpochMs(
  transport: DemoSimulationTransport | null,
  running: boolean,
): number {
  const epochRef = useRef<SimEpoch>(readEpochFromTransport(transport));
  const frozenMsRef = useRef(0);

  const transportPaused = transport?.transportPaused ?? false;
  const stepNonce = transport?.stepNonce ?? 0;
  const speed = transport?.speedMultiplier ?? 1;
  const active = running && !transportPaused;

  useSimClockFrame(active);

  useEffect(() => {
    if (!running) return;
    epochRef.current = readEpochFromTransport(transport);
    if (transportPaused) {
      frozenMsRef.current = transport?.virtualElapsedMs ?? 0;
    }
  }, [running, transportPaused, stepNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!running || transportPaused) return;
    const now = Date.now();
    const current = extrapolateEpochMs(epochRef.current);
    epochRef.current = { baseMs: current, wallAt: now, speed };
  }, [speed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!running) return 0;
  if (transportPaused) return transport?.virtualElapsedMs ?? frozenMsRef.current;
  return extrapolateEpochMs({ ...epochRef.current, speed });
}
