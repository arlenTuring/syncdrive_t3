import { SiteSelect } from '../../../components/SiteSelect';
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
import { Button, Slider } from '../../../components/ui';

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

  const [faultVehicleCode, setFaultVehicleCode] = useState('PMS02');

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
        className="fixed bottom-3 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-border-tertiary bg-zinc-900/95 px-4 py-2 text-body-xs-bold text-text-primary shadow-lg backdrop-blur-sm hover:border-border-theme hover:text-text-theme"
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
        <div className="flex items-center gap-2 text-body-xs-bold text-text-primary">
          <Gauge size={14} className="text-text-theme" />
          {t('dashboard.simulation.title')}
          {running && (
            <span className="rounded bg-surface-secondary px-1.5 py-0.5 text-caption-2 font-normal text-text-tertiary">
              {managed ? t('dashboard.simulation.running') : t('dashboard.simulation.external')}
            </span>
          )}
        </div>
        <Button hierarchy="subordinate" variant="standard" trailingIcon={<ChevronUp />} onPress={() => setToolbarVisible(false)} title={t('dashboard.simulation.hideTitle')}>{t('dashboard.simulation.hide')}</Button>
      </div>

      {!running ? (
        <div className="flex items-center gap-3">
          <Button hierarchy="subordinate" variant="outlined" leadingIcon={loading ? <Loader2 className="animate-spin" /> : <Play />} disabled={loading} onPress={() => void toggle()} title={t('dashboard.simulation.startTitle')}>{t('dashboard.simulation.start')}</Button>
          <p className="text-body-xs text-text-quaternary">{t('dashboard.simulation.startHint')}</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <Button hierarchy="danger" variant="outlined" leadingIcon={loading ? <Loader2 className="animate-spin" /> : <Square />} disabled={loading} onPress={() => void toggle()} title={t('dashboard.simulation.stopTitle')}>{t('dashboard.simulation.stop')}</Button>

            {managed && (
              <>
                <Button hierarchy="subordinate" variant="outlined" leadingIcon={transportPaused ? <Play /> : <Pause />} disabled={loading} onPress={() => void setTransportPaused(!transportPaused)} title={
                    transportPaused
                      ? t('dashboard.simulation.resumeTitle')
                      : t('dashboard.simulation.pauseTitle')
                  }>{transportPaused
                    ? t('dashboard.simulation.resume')
                    : t('dashboard.simulation.pause')}</Button>

                <Button hierarchy="subordinate" variant="outlined" leadingIcon={<SkipBack />} disabled={loading} {...holdPrev} title={t('dashboard.simulation.prevFrameTitle')}>{t('dashboard.simulation.prevFrame')}</Button>

                <Button hierarchy="subordinate" variant="outlined" leadingIcon={<SkipForward />} disabled={loading} {...holdNext} title={t('dashboard.simulation.nextFrameTitle')}>{t('dashboard.simulation.nextFrame')}</Button>
              </>
            )}
          </div>

          {managed && transportPaused && (
            <p className="text-body-xs text-status-warning">
              {t('dashboard.simulation.pausedHint')}
            </p>
          )}

          {managed ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between text-caption-2 text-text-quaternary">
                  <span>{t('dashboard.simulation.sendSpeed')}</span>
                  <span className="font-mono text-text-secondary">{speed.toFixed(2)}×</span>
                </div>
                <Slider
                  min={0}
                  max={SPEED_STOPS.length - 1}
                  step={1}
                  variant="discrete"
                  value={speedIndex}
                  onChange={(idx) => {
                    void setSpeedMultiplier(SPEED_STOPS[idx] ?? 1);
                  }}
                  showLabel={false}
                  getAriaValueText={(idx) => `${SPEED_STOPS[idx] ?? 1}×`}
                  aria-label={t('dashboard.simulation.sendSpeedAria')}
                />
                {/* 刻度文字對齊滑桿軌道：Slider 左右各留 10px */}
                <div className="flex justify-between px-2.5 font-mono text-caption-2 text-text-disabled">
                  {SPEED_STOPS.map((v) => (
                    <span key={v}>{v}×</span>
                  ))}
                </div>
              </div>

              <div className="shrink-0 text-right text-caption-2 text-text-quaternary">
                <div>{t('dashboard.simulation.virtualTime')}</div>
                <div className="font-mono text-body-s text-text-theme">
                  {formatElapsed(liveVirtualMs)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-body-xs text-text-quaternary">
              {t('dashboard.simulation.externalHint')}
            </p>
          )}

          {managed && (
            <div className="rounded-lg border border-border-danger-light bg-status-error-light p-3">
              <div className="mb-2 flex items-center gap-1.5 text-body-xs-bold text-status-error-emphasis">
                <TriangleAlert size={13} />
                {t('dashboard.simulation.faultTitle')}
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-caption-2 text-text-tertiary">
                  <span>{t('dashboard.simulation.pickVehicle')}</span>
                  <SiteSelect
                    value={faultVehicleCode}
                    onChange={(e) => setFaultVehicleCode(e.target.value)}
                    size="sm"
                    aria-label={t('dashboard.simulation.pickVehicleAria')}
                  >
                    {VTMS_DEMO_VEHICLE_CODES.map((code) => (
                      <option key={code} value={code}>
                        {code}
                      </option>
                    ))}
                  </SiteSelect>
                </label>
                <Button hierarchy="danger" variant="outlined" leadingIcon={loading ? <Loader2 className="animate-spin" /> : <TriangleAlert />} disabled={loading} onPress={() => void triggerVehicleFault(faultVehicleCode)} title={t('dashboard.simulation.emergencyStopTitle')}>{t('dashboard.simulation.emergencyStop')}</Button>
                <Button hierarchy="subordinate" variant="outlined" disabled={loading} onPress={() => void clearVehicleFault(faultVehicleCode)} title={t('dashboard.simulation.clearFaultTitle')}>{t('dashboard.simulation.clearFault')}</Button>
                <Button hierarchy="subordinate" variant="outlined" disabled={loading} onPress={() => void simulateVehicleObstacle(faultVehicleCode)} title={t('dashboard.simulation.obstacleTitle')}>{t('dashboard.simulation.obstacle')}</Button>
              </div>
              {lastSimulatedEvent && (
                <div className="mt-2 rounded-md border border-border-quaternary bg-surface-primary px-2.5 py-2 text-body-xs text-text-secondary">
                  <div className="font-mono text-caption-2 text-text-quaternary">
                    {lastSimulatedEvent.vehicleCode} · {lastSimulatedEvent.eventCode} · {lastSimulatedEvent.severity}
                  </div>
                  <div className="mt-0.5 text-status-error-emphasis">{lastSimulatedEvent.message}</div>
                  <div className="mt-1 text-caption-2 text-text-quaternary">
                    {t('dashboard.simulation.faultHint')}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {error && (
        <p className="mt-2 truncate text-caption-2 text-status-error-emphasis" title={error}>
          {error}
        </p>
      )}
    </div>
  );
}
