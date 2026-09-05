import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ChevronUp,
  Gauge,
  Loader2,
  Pause,
  Play,
  SkipBack,
  SkipForward,
  SlidersHorizontal,
  Square,
  TriangleAlert,
} from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { useDemoSimulation } from '../context/DemoSimulationContext';
import { VTMS_DEMO_VEHICLE_CODES } from '../api/demoSimulation';
import type { DemoSimulationTransport } from '../api/demoSimulation';
import { useSimClockFrame } from '../utils/simClockFrame';

const SPEED_STOPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8] as const;
const HOLD_REPEAT_DELAY_MS = 350;
const HOLD_REPEAT_INTERVAL_MS = 80;

function useHoldStepAction(
  action: () => Promise<void>,
  disabled: boolean,
): {
  onPointerDown: (e: React.PointerEvent<HTMLButtonElement>) => void;
  onPointerUp: () => void;
  onPointerLeave: () => void;
  onPointerCancel: () => void;
} {
  const actionRef = useRef(action);
  const busyRef = useRef(false);
  const holdDelayRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const holdIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  actionRef.current = action;

  const clearHold = () => {
    if (holdDelayRef.current) {
      clearTimeout(holdDelayRef.current);
      holdDelayRef.current = null;
    }
    if (holdIntervalRef.current) {
      clearInterval(holdIntervalRef.current);
      holdIntervalRef.current = null;
    }
  };

  useEffect(() => () => clearHold(), []);

  const runOnce = async () => {
    if (disabled || busyRef.current) return;
    busyRef.current = true;
    try {
      await actionRef.current();
    } finally {
      busyRef.current = false;
    }
  };

  const onPointerDown = (e: React.PointerEvent<HTMLButtonElement>) => {
    if (disabled || e.button !== 0) return;
    e.preventDefault();
    e.currentTarget.setPointerCapture(e.pointerId);
    clearHold();
    void runOnce();
    holdDelayRef.current = setTimeout(() => {
      holdIntervalRef.current = setInterval(() => {
        void runOnce();
      }, HOLD_REPEAT_INTERVAL_MS);
    }, HOLD_REPEAT_DELAY_MS);
  };

  const onPointerUp = () => clearHold();
  const onPointerLeave = () => clearHold();
  const onPointerCancel = () => clearHold();

  return { onPointerDown, onPointerUp, onPointerLeave, onPointerCancel };
}

function formatElapsed(ms: number): string {
  const totalSec = Math.max(0, ms) / 1000;
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const secFrac = totalSec % 60;
  const secStr = secFrac.toFixed(2).padStart(5, '0');
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${secStr}`;
  }
  return `${String(m).padStart(2, '0')}:${secStr}`;
}

type SimEpoch = { baseMs: number; wallAt: number; speed: number };

function readEpochFromTransport(transport: DemoSimulationTransport | null): SimEpoch {
  const baseMs = transport?.virtualElapsedMs ?? 0;
  const wallAt =
    transport?.lastAckWallMs && Number.isFinite(transport.lastAckWallMs)
      ? transport.lastAckWallMs
      : Date.now();
  const speed = transport?.speedMultiplier ?? 1;
  return { baseMs, wallAt, speed };
}

function extrapolateMs(epoch: SimEpoch): number {
  return epoch.baseMs + (Date.now() - epoch.wallAt) * epoch.speed;
}

/**
 * 虛擬時鐘顯示：單一連續外推，不依 status 輪詢重設錨點（輪詢會帶 tick 格點造成跳秒）。
 * 僅在暫停／逐幀／倍速變更／開始時重設錨點。
 */
function useLiveVirtualElapsedMs(
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

  // 開始、逐幀、暫停切換：採用伺服器錨點
  useEffect(() => {
    if (!running) return;
    epochRef.current = readEpochFromTransport(transport);
    if (transportPaused) {
      frozenMsRef.current = transport?.virtualElapsedMs ?? 0;
    }
  }, [running, transportPaused, stepNonce]); // eslint-disable-line react-hooks/exhaustive-deps

  // 倍速變更：以當下顯示值重設錨點，不 snap 到伺服器格點
  useEffect(() => {
    if (!running || transportPaused) return;
    const now = Date.now();
    const current = extrapolateMs(epochRef.current);
    epochRef.current = { baseMs: current, wallAt: now, speed };
  }, [speed]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!running) return 0;
  if (transportPaused) return transport?.virtualElapsedMs ?? frozenMsRef.current;
  return extrapolateMs({ ...epochRef.current, speed });
}

function nearestSpeedIndex(speed: number): number {
  let best = 0;
  let bestDiff = Infinity;
  SPEED_STOPS.forEach((v, i) => {
    const diff = Math.abs(v - speed);
    if (diff < bestDiff) {
      bestDiff = diff;
      best = i;
    }
  });
  return best;
}

/**
 * 漂浮於視窗底部的模擬控制列（fixed，不受地圖 scale 影響）。
 */
export function SimulationTransportToolbar() {
  const { t } = useTranslation();
  const {
    status,
    transport,
    loading,
    error,
    toolbarVisible,
    setToolbarVisible,
    toggle,
    setTransportPaused,
    setSpeedMultiplier,
    stepNextFrame,
    stepPrevFrame,
    triggerVehicleFault,
    clearVehicleFault,
    simulateVehicleObstacle,
    lastSimulatedEvent,
  } = useDemoSimulation();

  const [faultVehicleCode, setFaultVehicleCode] = useState('PMS-02');

  const running = status.running;
  const managed = running && status.source === 'managed';
  const transportPaused = transport?.transportPaused ?? false;
  const speed = transport?.speedMultiplier ?? 1;
  const liveVirtualMs = useLiveVirtualElapsedMs(transport, running);
  const speedIndex = useMemo(() => nearestSpeedIndex(speed), [speed]);
  const holdPrev = useHoldStepAction(stepPrevFrame, loading);
  const holdNext = useHoldStepAction(stepNextFrame, loading);

  if (!toolbarVisible) {
    return (
      <button
        type="button"
        onClick={() => setToolbarVisible(true)}
        className="fixed bottom-3 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-600 bg-zinc-900/95 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur-sm hover:border-cyan-600 hover:text-cyan-300"
        title={t('dashboard.simulation.show')}
        style={{ transform: 'translateX(-50%)' }}
      >
        <SlidersHorizontal size={14} />
        {t('dashboard.simulation.title')}
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[10000] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-zinc-600/80 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur-md"
      style={{ transform: 'translateX(-50%)' }}
      role="toolbar"
      aria-label={t('dashboard.simulation.title')}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Gauge size={14} className="text-cyan-400" />
          {t('dashboard.simulation.title')}
          {running && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal text-zinc-400">
              {managed ? t('dashboard.simulation.running') : t('dashboard.simulation.external')}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setToolbarVisible(false)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title={t('dashboard.simulation.hideTitle')}
        >
          {t('dashboard.simulation.hide')}
          <ChevronUp size={12} />
        </button>
      </div>

      {!running ? (
        <div className="flex items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void toggle()}
            className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-700/60 bg-emerald-950/40 px-4 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/40 disabled:opacity-50"
            title={t('dashboard.simulation.startTitle')}
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            {t('dashboard.simulation.start')}
          </button>
          <p className="text-[11px] text-zinc-500">{t('dashboard.simulation.startHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => void toggle()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-900/30 disabled:opacity-50"
              title={t('dashboard.simulation.stopTitle')}
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
              {t('dashboard.simulation.stop')}
            </button>

            {managed && (
              <>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void setTransportPaused(!transportPaused)}
                  className={`inline-flex items-center gap-1.5 rounded-lg border px-3 py-2 text-xs font-medium transition disabled:opacity-50 ${
                    transportPaused
                      ? 'border-emerald-700/60 bg-emerald-950/40 text-emerald-200 hover:bg-emerald-900/40'
                      : 'border-amber-700/60 bg-amber-950/40 text-amber-200 hover:bg-amber-900/40'
                  }`}
                  title={
                    transportPaused
                      ? t('dashboard.simulation.resumeTitle')
                      : t('dashboard.simulation.pauseTitle')
                  }
                >
                  {transportPaused ? <Play size={14} /> : <Pause size={14} />}
                  {transportPaused
                    ? t('dashboard.simulation.resume')
                    : t('dashboard.simulation.pause')}
                </button>

                <button
                  type="button"
                  disabled={loading}
                  {...holdPrev}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition enabled:hover:border-cyan-600 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 select-none touch-none"
                  title={t('dashboard.simulation.prevFrameTitle')}
                >
                  <SkipBack size={14} />
                  {t('dashboard.simulation.prevFrame')}
                </button>

                <button
                  type="button"
                  disabled={loading}
                  {...holdNext}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition enabled:hover:border-cyan-600 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 select-none touch-none"
                  title={t('dashboard.simulation.nextFrameTitle')}
                >
                  <SkipForward size={14} />
                  {t('dashboard.simulation.nextFrame')}
                </button>
              </>
            )}
          </div>

          {managed && transportPaused && (
            <p className="text-[11px] text-amber-300/90">
              {t('dashboard.simulation.pausedHint')}
            </p>
          )}

          {managed ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>{t('dashboard.simulation.sendSpeed')}</span>
                  <span className="font-mono text-zinc-300">{speed.toFixed(2)}×</span>
                </div>
                <input
                  type="range"
                  min={0}
                  max={SPEED_STOPS.length - 1}
                  step={1}
                  value={speedIndex}
                  onChange={(e) => {
                    const idx = Number(e.target.value);
                    void setSpeedMultiplier(SPEED_STOPS[idx] ?? 1);
                  }}
                  className="h-2 w-full cursor-pointer accent-cyan-500"
                  aria-label={t('dashboard.simulation.sendSpeedAria')}
                />
                <div className="flex justify-between font-mono text-[9px] text-zinc-600">
                  {SPEED_STOPS.map((v) => (
                    <span key={v}>{v}×</span>
                  ))}
                </div>
              </div>

              <div className="shrink-0 text-right text-[10px] text-zinc-500">
                <div>{t('dashboard.simulation.virtualTime')}</div>
                <div className="font-mono text-sm text-cyan-300">
                  {formatElapsed(liveVirtualMs)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">
              {t('dashboard.simulation.externalHint')}
            </p>
          )}

          {managed && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-200">
                <TriangleAlert size={13} />
                {t('dashboard.simulation.faultTitle')}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
                  <span>{t('dashboard.simulation.pickVehicle')}</span>
                  <select
                    value={faultVehicleCode}
                    onChange={(e) => setFaultVehicleCode(e.target.value)}
                    className="rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                    aria-label={t('dashboard.simulation.pickVehicleAria')}
                  >
                    {VTMS_DEMO_VEHICLE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </select>
                </label>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void triggerVehicleFault(faultVehicleCode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-red-700/70 bg-red-950/50 px-3 py-2 text-xs font-medium text-red-100 transition hover:bg-red-900/40 disabled:opacity-50"
                  title={t('dashboard.simulation.emergencyStopTitle')}
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <TriangleAlert size={14} />}
                  {t('dashboard.simulation.emergencyStop')}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void clearVehicleFault(faultVehicleCode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/30 disabled:opacity-50"
                  title={t('dashboard.simulation.clearFaultTitle')}
                >
                  {t('dashboard.simulation.clearFault')}
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void simulateVehicleObstacle(faultVehicleCode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-900/30 disabled:opacity-50"
                  title={t('dashboard.simulation.obstacleTitle')}
                >
                  {t('dashboard.simulation.obstacle')}
                </button>
              </div>
              {lastSimulatedEvent && (
                <div className="mt-2 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-2.5 py-2 text-[11px] text-zinc-300">
                  <div className="font-mono text-[10px] text-zinc-500">
                    {lastSimulatedEvent.vehicleCode} · {lastSimulatedEvent.eventCode} · {lastSimulatedEvent.severity}
                  </div>
                  <div className="mt-0.5 text-red-200">{lastSimulatedEvent.message}</div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    {t('dashboard.simulation.faultHint')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 truncate text-[10px] text-red-400" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
