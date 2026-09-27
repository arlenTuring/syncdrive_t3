import {
  createContext,
  useCallback,
  useContext,
  useLayoutEffect,
  useState,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import {
  useVehicleFleetMqttHub,
  type VehicleFleetMqttHub,
} from '../hooks/useVehicleFleetMqttHub';
import type { VtmsStreamKind } from '../utils/vtmsTopic';

/**
 * 全儀表板共用 VTMS 車隊 MQTT。
 *
 * <h3>兩個 context</h3>
 * <ul>
 *   <li><code>VehicleFleetMqttContext</code>：hub 本身，每次 flush 換一個值。用它的元件
 *       每一波遙測都重畫——只有真的要看整個車隊的（圖台）才該用。</li>
 *   <li><code>VehicleFleetStoreContext</code>：固定不變的 store＋訂閱。元件用
 *       {@link useVehicleFleetSelector} 挑自己要的那一個值，<strong>值變了才重畫</strong>。</li>
 * </ul>
 *
 * 先前所有 widget（KPI 卡、文字、儀表、徽章、進度條…）都經 useMqttData 讀 hub context，
 * 連沒有綁 MQTT 的也一樣；每一波遙測整張儀表板重畫一次，實測每秒一個 100～190 毫秒的長任務，
 * 圖台上的車跟著頓一下（2026-09-27）。
 */

const VehicleFleetMqttContext = createContext<VehicleFleetMqttHub | null>(null);

export type VehicleFleetStore = {
  getHub: () => VehicleFleetMqttHub;
  subscribe: (listener: () => void) => () => void;
  /** 換新 hub 並通知訂閱者；同一個 hub 不通知 */
  publish: (hub: VehicleFleetMqttHub) => void;
};

function createVehicleFleetStore(initial: VehicleFleetMqttHub): VehicleFleetStore {
  let current = initial;
  const listeners = new Set<() => void>();
  return {
    getHub: () => current,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    publish: (hub) => {
      if (hub === current) return;
      current = hub;
      for (const listener of listeners) listener();
    },
  };
}

const VehicleFleetStoreContext = createContext<VehicleFleetStore | null>(null);

export function VehicleFleetMqttProvider({ children }: { children: ReactNode }) {
  const hub = useVehicleFleetMqttHub(true);
  const [store] = useState(() => createVehicleFleetStore(hub));

  // commit 後才通知：訂閱者在同一輪繪製前拿到新 hub
  useLayoutEffect(() => {
    store.publish(hub);
  }, [store, hub]);

  return (
    <VehicleFleetStoreContext.Provider value={store}>
      <VehicleFleetMqttContext.Provider value={hub}>
        {children}
      </VehicleFleetMqttContext.Provider>
    </VehicleFleetStoreContext.Provider>
  );
}

/** 整個 hub（每一波遙測都會重畫）；只給真的要看整個車隊的元件用 */
export function useVehicleFleetMqttHubContext(): VehicleFleetMqttHub | null {
  return useContext(VehicleFleetMqttContext);
}

/** 車隊 store（身分固定，不隨遙測重畫）；要在 effect 裡跟著每一波遙測做事的用它訂閱 */
export function useVehicleFleetStore(): VehicleFleetStore | null {
  return useContext(VehicleFleetStoreContext);
}

/** 有沒有車隊 hub（不隨遙測重畫） */
export function useHasVehicleFleetHub(): boolean {
  return useContext(VehicleFleetStoreContext) !== null;
}

const noopSubscribe = () => () => {};

/**
 * 從車隊 hub 挑一個值；值（=== 比較）變了才重畫。
 * selector 要回傳穩定的值：原始值，或 hub 裡現成的物件（沒變的列 hub 不會換物件）。
 */
export function useVehicleFleetSelector<T>(selector: (hub: VehicleFleetMqttHub) => T, fallback: T): T {
  const store = useContext(VehicleFleetStoreContext);
  const subscribe = useCallback(
    (listener: () => void) => (store ? store.subscribe(listener) : noopSubscribe()),
    [store],
  );
  const getSnapshot = () => (store ? selector(store.getHub()) : fallback);
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

export function useVehicleFleetStreamPayload(
  vehicleCode: string | undefined,
  stream: VtmsStreamKind,
): Record<string, unknown> | null {
  const code = vehicleCode?.trim().toUpperCase();
  return useVehicleFleetSelector(
    (hub) => (code ? hub[stream].get(code) ?? null : null),
    null,
  );
}

const EMPTY_OPERATION = new Map<string, Record<string, unknown>>();

/**
 * 全車隊營運訊息（hub 的 Map，內容就地更新；只有暫停／斷線重置時換一個新的）。
 *
 * 不隨遙測重畫：呼叫端拿它做 useMemo 的相依，Map 身分不變就不會重算，原本每一波遙測
 * 跟著重畫也只是白白重畫整組班次卡。資料列（SQL）更新時會帶到最新內容。
 */
export function useShiftFleetMqttMap(): Map<string, Record<string, unknown>> {
  return useVehicleFleetSelector((hub) => hub.operation, EMPTY_OPERATION);
}

export function useShiftVehicleOperationMqtt(
  vehicleCode: string | undefined,
): Record<string, unknown> | null {
  return useVehicleFleetStreamPayload(vehicleCode, 'operation');
}
