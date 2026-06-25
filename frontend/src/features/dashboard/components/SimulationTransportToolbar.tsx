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
import { useDemoSimulation } from '../context/DemoSimulationContext';
import { VTMS_DEMO_VEHICLE_CODES } from '../api/demoSimulation';

const SPEED_STOPS = [0.25, 0.5, 1, 1.5, 2, 3, 4, 6, 8, 10, 12, 15] as const;
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
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
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
  const speedIndex = useMemo(() => nearestSpeedIndex(speed), [speed]);
  const holdPrev = useHoldStepAction(stepPrevFrame, loading);
  const holdNext = useHoldStepAction(stepNextFrame, loading);

  if (!toolbarVisible) {
    return (
      <button
        type="button"
        onClick={() => setToolbarVisible(true)}
        className="fixed bottom-3 left-1/2 z-[10000] flex -translate-x-1/2 items-center gap-1.5 rounded-full border border-zinc-600 bg-zinc-900/95 px-4 py-2 text-xs font-medium text-zinc-200 shadow-lg backdrop-blur-sm hover:border-cyan-600 hover:text-cyan-300"
        title="顯示模擬控制"
        style={{ transform: 'translateX(-50%)' }}
      >
        <SlidersHorizontal size={14} />
        模擬控制
      </button>
    );
  }

  return (
    <div
      className="fixed bottom-4 left-1/2 z-[10000] w-[min(720px,calc(100vw-2rem))] -translate-x-1/2 rounded-xl border border-zinc-600/80 bg-zinc-900/95 px-4 py-3 shadow-2xl backdrop-blur-md"
      style={{ transform: 'translateX(-50%)' }}
      role="toolbar"
      aria-label="模擬控制"
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs font-semibold text-zinc-200">
          <Gauge size={14} className="text-cyan-400" />
          模擬控制
          {running && (
            <span className="rounded bg-zinc-800 px-1.5 py-0.5 text-[10px] font-normal text-zinc-400">
              {managed ? '運行中' : '外部程序'}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={() => setToolbarVisible(false)}
          className="inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] text-zinc-400 hover:bg-zinc-800 hover:text-zinc-200"
          title="隱藏控制列"
        >
          隱藏
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
            title="開始 MQTT 班次模擬與 SQL 示範更新"
          >
            {loading ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
            開始模擬
          </button>
          <p className="text-[11px] text-zinc-500">啟動後可調整發送速度、暫停與逐幀播放</p>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              disabled={loading}
              onClick={() => void toggle()}
              className="inline-flex items-center gap-1.5 rounded-lg border border-red-800/60 bg-red-950/30 px-3 py-2 text-xs font-medium text-red-200 transition hover:bg-red-900/30 disabled:opacity-50"
              title="停止模擬（結束 MQTT 發送）"
            >
              {loading ? <Loader2 size={14} className="animate-spin" /> : <Square size={14} />}
              停止模擬
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
                  title={transportPaused ? '繼續自動發送' : '暫停自動發送（可逐幀）'}
                >
                  {transportPaused ? <Play size={14} /> : <Pause size={14} />}
                  {transportPaused ? '繼續發送' : '暫停發送'}
                </button>

                <button
                  type="button"
                  disabled={loading}
                  {...holdPrev}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition enabled:hover:border-cyan-600 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 select-none touch-none"
                  title="回退一幀（按住可連續回退，-100ms/幀，會自動暫停發送）"
                >
                  <SkipBack size={14} />
                  上一幀
                </button>

                <button
                  type="button"
                  disabled={loading}
                  {...holdNext}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-200 transition enabled:hover:border-cyan-600 enabled:hover:text-cyan-300 disabled:cursor-not-allowed disabled:opacity-40 select-none touch-none"
                  title="前進一幀（按住可連續前進，+100ms/幀，會自動暫停發送）"
                >
                  <SkipForward size={14} />
                  下一幀
                </button>
              </>
            )}
          </div>

          {managed && transportPaused && (
            <p className="text-[11px] text-amber-300/90">
              已暫停 MQTT 發送：圖台不會更新。按「繼續發送」或「下一幀」才會收到新座標。
            </p>
          )}

          {managed ? (
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 flex-col gap-1">
                <div className="flex items-center justify-between text-[10px] text-zinc-500">
                  <span>發送速度</span>
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
                  aria-label="模擬資料發送速度"
                />
                <div className="flex justify-between font-mono text-[9px] text-zinc-600">
                  {SPEED_STOPS.map((v) => (
                    <span key={v}>{v}×</span>
                  ))}
                </div>
              </div>

              <div className="shrink-0 text-right text-[10px] text-zinc-500">
                <div>虛擬時間</div>
                <div className="font-mono text-sm text-cyan-300">
                  {formatElapsed(transport?.virtualElapsedMs ?? 0)}
                </div>
              </div>
            </div>
          ) : (
            <p className="text-[11px] text-zinc-500">
              外部模擬程序運行中。按「停止模擬」結束，再按「開始模擬」以使用速度與逐幀控制。
            </p>
          )}

          {managed && (
            <div className="rounded-lg border border-red-900/50 bg-red-950/20 p-3">
              <div className="mb-2 flex items-center gap-1.5 text-[11px] font-semibold text-red-200">
                <TriangleAlert size={13} />
                故障模擬驗收（command/execute → command/ack → event/report → FAULTED）
              </div>
              <div className="flex flex-wrap items-end gap-2">
                <label className="flex flex-col gap-1 text-[10px] text-zinc-400">
                  <span>① 選擇車輛</span>
                  <select
                    value={faultVehicleCode}
                    onChange={(e) => setFaultVehicleCode(e.target.value)}
                    className="rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100"
                    aria-label="選擇要觸發故障的車輛"
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
                  title="下發 EMERGENCY_STOP，車端應回 command/ack 並上報 PATH_BLOCKED"
                >
                  {loading ? <Loader2 size={14} className="animate-spin" /> : <TriangleAlert size={14} />}
                  ② 模擬緊急停車
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void clearVehicleFault(faultVehicleCode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-800/60 bg-emerald-950/30 px-3 py-2 text-xs font-medium text-emerald-200 transition hover:bg-emerald-900/30 disabled:opacity-50"
                  title="清除 FAULTED 並復歸訂單為 PROCESSING"
                >
                  ③ 清除故障
                </button>
                <button
                  type="button"
                  disabled={loading}
                  onClick={() => void simulateVehicleObstacle(faultVehicleCode)}
                  className="inline-flex items-center gap-1.5 rounded-lg border border-amber-800/60 bg-amber-950/30 px-3 py-2 text-xs font-medium text-amber-200 transition hover:bg-amber-900/30 disabled:opacity-50"
                  title="上報 OBSTACLE_DETECTED（WARNING，不轉 FAULTED）"
                >
                  障礙物事件
                </button>
              </div>
              {lastSimulatedEvent && (
                <div className="mt-2 rounded-md border border-zinc-700/80 bg-zinc-900/80 px-2.5 py-2 text-[11px] text-zinc-300">
                  <div className="font-mono text-[10px] text-zinc-500">
                    {lastSimulatedEvent.vehicleCode} · {lastSimulatedEvent.eventCode} · {lastSimulatedEvent.severity}
                  </div>
                  <div className="mt-0.5 text-red-200">{lastSimulatedEvent.message}</div>
                  <div className="mt-1 text-[10px] text-zinc-500">
                    圖台應顯示 vehicle_phase=FAULTED；事件列表亦會出現此描述
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
