import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { useOperatingClock } from '../utils/operatingClock';
import {
  fetchDemoSimulationStatus,
  pauseDemoSimulation,
  startDemoSimulation,
  stepDemoSimulationTransport,
  triggerDemoVehicleFault,
  clearDemoVehicleFault,
  simulateDemoVehicleObstacle,
  updateDemoSimulationTransport,
  type DemoSimulationStatus,
  type DemoSimulationTransport,
  type SimulatedFaultEvent,
} from '../api/demoSimulation';
import {
  DemoSimulationLiveProvider,
  DemoSimulationPlaybackProvider,
  type DemoSimulationPlayback,
} from './DemoSimulationPlaybackContext';
import { getDataSourceById } from '../store/useDataSourceStore';
import { resolveBrowserApiBaseUrl } from '../../../lib/browserApiBase';
import i18n from '../../../i18n';

const TOOLBAR_VISIBLE_KEY = 'syncdrive-sim-transport-toolbar-visible';

/** 開發模式走 Vite 代理，避免 localhost IPv6 / 跨域問題 */
function resolveSimulationBackendUrl(): string {
  return resolveBrowserApiBaseUrl(getDataSourceById('default-internal')?.backendUrl);
}

type DemoSimulationContextValue = {
  status: DemoSimulationStatus;
  transport: DemoSimulationTransport | null;
  /** 儀表板是否凍結（未運行時為 true） */
  paused: boolean;
  /** 傳輸暫停（模擬運行中暫停 MQTT 自動發送） */
  transportPaused: boolean;
  /** 遞增時清除地圖上的即時車輛與 MQTT 殘留 */
  liveClearEpoch: number;
  loading: boolean;
  error: string | null;
  toolbarVisible: boolean;
  setToolbarVisible: (visible: boolean) => void;
  start: () => Promise<void>;
  pause: () => Promise<void>;
  toggle: () => Promise<void>;
  refresh: () => Promise<void>;
  setTransportPaused: (paused: boolean) => Promise<void>;
  setSpeedMultiplier: (speed: number) => Promise<void>;
  stepNextFrame: () => Promise<void>;
  stepPrevFrame: () => Promise<void>;
  triggerVehicleFault: (vehicleCode: string) => Promise<void>;
  clearVehicleFault: (vehicleCode: string) => Promise<void>;
  simulateVehicleObstacle: (vehicleCode: string) => Promise<void>;
  lastSimulatedEvent: SimulatedFaultEvent | null;
};

const defaultStatus: DemoSimulationStatus = {
  running: false,
  paused: true,
  source: 'none',
  startedAt: null,
  pid: null,
  transport: null,
};

const DemoSimulationContext = createContext<DemoSimulationContextValue | null>(null);

function readToolbarVisible(): boolean {
  try {
    const raw = localStorage.getItem(TOOLBAR_VISIBLE_KEY);
    if (raw === '0') return false;
    return true;
  } catch {
    return true;
  }
}

export function DemoSimulationProvider({ children }: { children: ReactNode }) {
  const [status, setStatus] = useState<DemoSimulationStatus>(defaultStatus);
  const [transport, setTransport] = useState<DemoSimulationTransport | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [toolbarVisible, setToolbarVisibleState] = useState(readToolbarVisible);
  const [liveClearEpoch, setLiveClearEpoch] = useState(0);
  const [lastSimulatedEvent, setLastSimulatedEvent] = useState<SimulatedFaultEvent | null>(null);
  const transportPatchAt = useRef(0);
  const pollFingerprintRef = useRef('');

  const bumpLiveClear = useCallback(() => {
    setLiveClearEpoch((n) => n + 1);
  }, []);

  const backendUrl = useMemo(() => resolveSimulationBackendUrl(), []);

  const setToolbarVisible = useCallback((visible: boolean) => {
    setToolbarVisibleState(visible);
    try {
      localStorage.setItem(TOOLBAR_VISIBLE_KEY, visible ? '1' : '0');
    } catch {
      /* ignore */
    }
  }, []);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchDemoSimulationStatus(backendUrl);
      const nextTransport = next.transport ?? null;
      const fp = [
        next.running,
        next.paused,
        next.source,
        next.pid,
        nextTransport?.transportPaused,
        nextTransport?.speedMultiplier,
        nextTransport?.virtualElapsedMs,
        nextTransport?.stepNonce,
      ].join('|');
      if (fp !== pollFingerprintRef.current) {
        pollFingerprintRef.current = fp;
        setStatus(next);
        setTransport((prev) => {
          if (!next.transport) return next.transport;
          const patchRecent = Date.now() - transportPatchAt.current < 2000;
          if (patchRecent && prev) {
            return {
              ...next.transport,
              speedMultiplier: prev.speedMultiplier,
              transportPaused: prev.transportPaused,
            };
          }
          return next.transport;
        });
      }
      if (next.transport?.lastSimulatedEvent) {
        setLastSimulatedEvent(next.transport.lastSimulatedEvent);
      }
      setError(null);
    } catch (e) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [backendUrl]);

  useEffect(() => {
    void refresh();
    if (!toolbarVisible && !status.running) return undefined;
    const intervalMs = status.running ? 3000 : 10_000;
    const id = setInterval(() => void refresh(), intervalMs);
    return () => clearInterval(id);
  }, [refresh, toolbarVisible, status.running]);

  const start = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await startDemoSimulation(backendUrl);
      setStatus(next);
      setTransport(next.transport);
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('fetch') || msg.includes('Failed')
          ? i18n.t('dashboard.demoSim.backendUnreachable')
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }, [backendUrl]);

  const pause = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await pauseDemoSimulation(backendUrl);
      setStatus(next);
      setTransport(next.transport);
      bumpLiveClear();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(
        msg.includes('fetch') || msg.includes('Failed')
          ? i18n.t('dashboard.demoSim.backendUnreachable')
          : msg,
      );
    } finally {
      setLoading(false);
    }
  }, [backendUrl, bumpLiveClear]);

  const toggle = useCallback(async () => {
    if (status.running) await pause();
    else await start();
  }, [status.running, start, pause]);

  const setTransportPaused = useCallback(
    async (transportPaused: boolean) => {
      if (!status.running) return;
      if (status.source !== 'managed') {
        setError(i18n.t('dashboard.demoSim.useManagedStart'));
        return;
      }
      setError(null);
      transportPatchAt.current = Date.now();
      setTransport((prev) =>
        prev ? { ...prev, transportPaused } : prev,
      );
      setStatus((prev) => ({
        ...prev,
        transport: prev.transport
          ? { ...prev.transport, transportPaused }
          : null,
      }));
      try {
        const next = await updateDemoSimulationTransport(backendUrl, { transportPaused });
        setTransport(next);
        setStatus((prev) => ({
          ...prev,
          transport: next,
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        void refresh();
      }
    },
    [backendUrl, status.running, status.source, refresh],
  );

  const setSpeedMultiplier = useCallback(
    async (speedMultiplier: number) => {
      if (!status.running) return;
      if (status.source !== 'managed') {
        setError(i18n.t('dashboard.demoSim.useManagedStart'));
        return;
      }
      transportPatchAt.current = Date.now();
      setTransport((prev) =>
        prev ? { ...prev, speedMultiplier } : prev,
      );
      setStatus((prev) => ({
        ...prev,
        transport: prev.transport
          ? { ...prev.transport, speedMultiplier }
          : null,
      }));
      try {
        const next = await updateDemoSimulationTransport(backendUrl, { speedMultiplier });
        setTransport(next);
        setStatus((prev) => ({
          ...prev,
          transport: next,
        }));
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
        void refresh();
      }
    },
    [backendUrl, status.running, status.source, refresh],
  );

  const stepByDirection = useCallback(async (direction: 'next' | 'prev') => {
    if (!status.running || status.source !== 'managed') return;
    setError(null);
    transportPatchAt.current = Date.now();
    setTransport((prev) =>
      prev ? { ...prev, transportPaused: true } : prev,
    );
    try {
      const next = await stepDemoSimulationTransport(backendUrl, direction);
      setTransport(next);
      setStatus((prev) => ({
        ...prev,
        transport: next,
      }));
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : String(e);
      setError(msg);
    }
  }, [backendUrl, status.running, status.source]);

  const stepNextFrame = useCallback(async () => {
    await stepByDirection('next');
  }, [stepByDirection]);

  const stepPrevFrame = useCallback(async () => {
    await stepByDirection('prev');
  }, [stepByDirection]);

  const triggerVehicleFault = useCallback(
    async (vehicleCode: string) => {
      if (!status.running || status.source !== 'managed') {
        setError(i18n.t('dashboard.demoSim.startManagedFirst'));
        return;
      }
      setLoading(true);
      setError(null);
      try {
        const result = await triggerDemoVehicleFault(backendUrl, vehicleCode);
        setLastSimulatedEvent({
          vehicleCode: result.vehicleCode,
          eventCode: result.expectedEvent.eventCode,
          severity: result.expectedEvent.severity,
          message: result.expectedEvent.message,
          timestamp: Date.now(),
          commandId: result.commandId,
        });
        void refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [backendUrl, status.running, status.source, refresh],
  );

  const runSimulatorVehicleAction = useCallback(
    async (
      vehicleCode: string,
      action: (url: string, code: string) => Promise<{ vehicleCode: string; action: string }>,
      eventPreview: SimulatedFaultEvent,
    ) => {
      if (!status.running || status.source !== 'managed') {
        setError(i18n.t('dashboard.demoSim.startManagedFirst'));
        return;
      }
      setLoading(true);
      setError(null);
      try {
        await action(backendUrl, vehicleCode);
        setLastSimulatedEvent({ ...eventPreview, vehicleCode, timestamp: Date.now() });
        void refresh();
      } catch (e: unknown) {
        const msg = e instanceof Error ? e.message : String(e);
        setError(msg);
      } finally {
        setLoading(false);
      }
    },
    [backendUrl, status.running, status.source, refresh],
  );

  const clearVehicleFault = useCallback(
    async (vehicleCode: string) => {
      await runSimulatorVehicleAction(vehicleCode, clearDemoVehicleFault, {
        vehicleCode,
        eventCode: 'SYSTEM_HEALTH_DEGRADED',
        severity: 'INFO',
        message: i18n.t('dashboard.demoSim.faultCleared', { vehicleCode }),
        timestamp: Date.now(),
      });
    },
    [runSimulatorVehicleAction],
  );

  const simulateVehicleObstacle = useCallback(
    async (vehicleCode: string) => {
      await runSimulatorVehicleAction(vehicleCode, simulateDemoVehicleObstacle, {
        vehicleCode,
        eventCode: 'OBSTACLE_DETECTED',
        severity: 'WARNING',
        message: i18n.t('dashboard.demoSim.obstacleDetected', { vehicleCode }),
        timestamp: Date.now(),
      });
    },
    [runSimulatorVehicleAction],
  );

  const paused = !status.running;
  const transportPaused = transport?.transportPaused ?? false;
  const speedMultiplier = Math.max(1, transport?.speedMultiplier ?? 1);

  /*
   * 執行端（模擬器或任何車端程式）推進營運時鐘時，動畫與倒數照營運時鐘的倍速推：
   * 跟示範模擬同一套外插，只是時鐘來源不同。示範模擬在跑時以它為準。
   */
  const operatingClock = useOperatingClock();
  const clockReplay = operatingClock.snapshot?.mode === 'replay';
  const playback = useMemo<DemoSimulationPlayback>(
    () => (status.running || !clockReplay
      ? { running: status.running, paused, transportPaused, speedMultiplier }
      : {
          running: true,
          paused: !operatingClock.advancing,
          transportPaused: false,
          speedMultiplier: Math.max(1, operatingClock.rate),
        }),
    [status.running, paused, transportPaused, speedMultiplier, clockReplay, operatingClock.advancing, operatingClock.rate],
  );

  const value = useMemo(
    () => ({
      status,
      transport,
      paused,
      transportPaused,
      liveClearEpoch,
      loading,
      error,
      toolbarVisible,
      setToolbarVisible,
      start,
      pause,
      toggle,
      refresh,
      setTransportPaused,
      setSpeedMultiplier,
      stepNextFrame,
      stepPrevFrame,
      triggerVehicleFault,
      clearVehicleFault,
      simulateVehicleObstacle,
      lastSimulatedEvent,
    }),
    [
      status,
      transport,
      paused,
      transportPaused,
      liveClearEpoch,
      loading,
      error,
      toolbarVisible,
      setToolbarVisible,
      start,
      pause,
      toggle,
      refresh,
      setTransportPaused,
      setSpeedMultiplier,
      stepNextFrame,
      stepPrevFrame,
      triggerVehicleFault,
      clearVehicleFault,
      simulateVehicleObstacle,
      lastSimulatedEvent,
    ],
  );

  return (
    <DemoSimulationPlaybackProvider value={playback}>
      <DemoSimulationLiveProvider liveClearEpoch={liveClearEpoch}>
        <DemoSimulationContext.Provider value={value}>
          {children}
        </DemoSimulationContext.Provider>
      </DemoSimulationLiveProvider>
    </DemoSimulationPlaybackProvider>
  );
}

export function useDemoSimulation(): DemoSimulationContextValue {
  const ctx = useContext(DemoSimulationContext);
  if (!ctx) {
    return {
      status: defaultStatus,
      transport: null,
      paused: false,
      transportPaused: false,
      liveClearEpoch: 0,
      loading: false,
      error: null,
      toolbarVisible: true,
      setToolbarVisible: () => {},
      start: async () => {},
      pause: async () => {},
      toggle: async () => {},
      refresh: async () => {},
      setTransportPaused: async () => {},
      setSpeedMultiplier: async () => {},
      stepNextFrame: async () => {},
      stepPrevFrame: async () => {},
      triggerVehicleFault: async () => {},
      clearVehicleFault: async () => {},
      simulateVehicleObstacle: async () => {},
      lastSimulatedEvent: null,
    };
  }
  return ctx;
}
