import { useCallback, useEffect, useRef, useState } from 'react';
import { buildExportFilename } from '../../lib/exportFilename';
import { normalizeDegrees } from '../map-editor/utils/rotation';
import { VEHICLE_DEFINITIONS_STORAGE_KEY } from '../../lib/canvasCacheReset';
import {
  deleteVehicleDefinition,
  fetchVehicleDefinitions,
  saveVehicleDefinition,
  VehicleDefinitionConflictError,
} from './api/vehicleDefinitionsApi';
import { useVehicleHistory, type VehicleEditorSnapshot } from './hooks/useVehicleHistory';
import { createVehicleElement } from './utils/createElement';
import { roundVehicleNudgeCoord } from './utils/vehicleNudge';
import { enrichPatchWithIconFit, fitNewIconElement } from './utils/elementIconFit';
import { migrateVehicleDefinition } from './utils/migrateVehicleDefinition';
import { stashLegacyVehicleCache } from './storage/vehicleDefinitionStorage';
import { newVehicleId } from './utils/id';
import {
  cloneVehicleDefinition,
  downloadVehicleDefinitionsJson,
  parseVehicleDefinitionsJson,
} from './utils/vehicleDefinitionIO';
import type {
  VehicleDefinition,
  VehicleElement,
  VehicleElementPatch,
  VehicleElementType,
  VehicleLightElement,
} from './types';

const SAVE_DEBOUNCE_MS = 500;

export type VehicleUpdateElementOptions = {
  recordHistory?: boolean;
};

/** 每個模型跟後端的同步狀態 */
export type VehicleSyncState =
  | { status: 'saving' }
  | { status: 'saved'; at: number }
  | { status: 'conflict'; message: string; current: VehicleDefinition | null }
  | { status: 'error'; message: string };

export type VehicleListLoadState = 'loading' | 'ready' | 'offline';

function readCache(): VehicleDefinition[] {
  try {
    const raw = localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY);
    const parsed = raw ? (JSON.parse(raw) as VehicleDefinition[]) : [];
    return Array.isArray(parsed) ? parsed.map(migrateVehicleDefinition) : [];
  } catch {
    return [];
  }
}

function writeCache(vehicles: VehicleDefinition[]) {
  try {
    localStorage.setItem(VEHICLE_DEFINITIONS_STORAGE_KEY, JSON.stringify(vehicles));
  } catch {
    /* ignore quota */
  }
}

/*
 * <strong>後端是真相，逐筆存。</strong>
 *
 * 以前這裡一開編輯器就把瀏覽器快取整批推上後端（整批取代、沒列到的刪掉），還會塞進或
 * 換掉一個內建範例模型——一台快取過期的瀏覽器就能蓋掉別人剛存的模型。現在：
 * - 清單以後端為準；後端回來之前不給編輯（快取只用來在載入中先畫出畫面）。
 * - 每個模型自己 debounce，存的時候帶它從後端拿到的版本（serverVersion）；後端已經是
 *   別的版本就回 409，這裡標成衝突、不覆蓋，讓使用者選擇載入伺服器版本。
 * - 本機才有的舊模型不會自動上傳，改在「此瀏覽器的舊模型」由使用者比對後匯入。
 */
export function useVehicleEditor() {
  const [vehicles, setVehicles] = useState<VehicleDefinition[]>(() => readCache());
  const [loadState, setLoadState] = useState<VehicleListLoadState>('loading');
  const [syncState, setSyncState] = useState<Record<string, VehicleSyncState>>({});
  const saveTimers = useRef(new Map<string, ReturnType<typeof setTimeout>>());
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const vehiclesRef = useRef(vehicles);
  const activeVehicleIdRef = useRef(activeVehicleId);
  const selectedElementIdRef = useRef(selectedElementId);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const clipboardRef = useRef<VehicleElement | null>(null);

  const reloadFromServer = useCallback(async () => {
    try {
      const remote = (await fetchVehicleDefinitions()).map(migrateVehicleDefinition);
      stashLegacyVehicleCache(remote);
      setVehicles(remote);
      writeCache(remote);
      setSyncState({});
      setLoadState('ready');
      return remote;
    } catch {
      // 後端不可用：快取照常顯示但不給存（存了也送不上去，還可能跟別人衝突）
      setLoadState('offline');
      return null;
    }
  }, []);

  useEffect(() => {
  // eslint-disable-next-line react-hooks/set-state-in-effect -- 後端讀取是非同步，回來之後才寫狀態
    void reloadFromServer();
  }, [reloadFromServer]);

  vehiclesRef.current = vehicles;
  activeVehicleIdRef.current = activeVehicleId;
  selectedElementIdRef.current = selectedElementId;
  selectedElementIdsRef.current = selectedElementIds;

  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;
  const selectedElement =
    activeVehicle?.elements.find((e) => e.id === selectedElementId) ?? null;

  const setSync = useCallback((id: string, state: VehicleSyncState | null) => {
    setSyncState((current) => {
      const next = { ...current };
      if (state) next[id] = state;
      else delete next[id];
      return next;
    });
  }, []);

  /** 存一個模型（帶它的 serverVersion）；成功後把新版本號寫回清單 */
  const saveNow = useCallback(
    async (id: string) => {
      saveTimers.current.delete(id);
      const vehicle = vehiclesRef.current.find((v) => v.id === id);
      if (!vehicle) return;
      setSync(id, { status: 'saving' });
      try {
        const saved = await saveVehicleDefinition(vehicle, vehicle.serverVersion ?? null);
        setVehicles((current) => {
          const next = current.map((v) =>
            v.id === id ? { ...v, serverVersion: saved.serverVersion } : v,
          );
          writeCache(next);
          return next;
        });
        setSync(id, { status: 'saved', at: Date.now() });
      } catch (error) {
        if (error instanceof VehicleDefinitionConflictError) {
          setSync(id, { status: 'conflict', message: error.message, current: error.current });
        } else {
          setSync(id, {
            status: 'error',
            message: error instanceof Error ? error.message : '儲存失敗',
          });
        }
      }
    },
    [setSync],
  );

  const scheduleSave = useCallback(
    (id: string) => {
      const timer = saveTimers.current.get(id);
      if (timer) clearTimeout(timer);
      saveTimers.current.set(
        id,
        setTimeout(() => void saveNow(id), SAVE_DEBOUNCE_MS),
      );
    },
    [saveNow],
  );

  /** 寫進清單；有變的那幾個模型排程存檔（清單本身不整批送） */
  const commit = useCallback(
    (next: VehicleDefinition[]) => {
      const before = new Map(vehiclesRef.current.map((v) => [v.id, v]));
      vehiclesRef.current = next;
      setVehicles(next);
      writeCache(next);
      for (const vehicle of next) {
        if (before.get(vehicle.id) !== vehicle) scheduleSave(vehicle.id);
      }
    },
    [scheduleSave],
  );

  /** 衝突時：放棄本機修改，改用伺服器上的版本 */
  const takeServerVersion = useCallback(
    (id: string) => {
      const state = syncState[id];
      const current = state?.status === 'conflict' ? state.current : null;
      const timer = saveTimers.current.get(id);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(id);
      setVehicles((list) => {
        const next = current
          ? list.map((v) => (v.id === id ? migrateVehicleDefinition(current) : v))
          : list.filter((v) => v.id !== id);
        writeCache(next);
        return next;
      });
      setSync(id, null);
    },
    [setSync, syncState],
  );

  const getSnapshot = useCallback(() => {
    const id = activeVehicleIdRef.current;
    if (!id) return null;
    const vehicle = vehiclesRef.current.find((v) => v.id === id);
    if (!vehicle) return null;
    return {
      vehicle: structuredClone(vehicle),
      selectedElementId: selectedElementIdRef.current,
      selectedElementIds: [...selectedElementIdsRef.current],
    };
  }, []);

  const applySnapshot = useCallback(
    (snap: VehicleEditorSnapshot) => {
      commit(
        vehiclesRef.current.map((v) => (v.id === snap.vehicle.id ? snap.vehicle : v)),
      );
      setSelectedElementId(snap.selectedElementId);
      setSelectedElementIds(snap.selectedElementIds);
    },
    [commit],
  );

  const { pushHistory, undo, redo, resetHistory, canUndo, canRedo } = useVehicleHistory({
    getSnapshot,
    applySnapshot,
  });

  useEffect(() => {
    resetHistory();
  }, [activeVehicleId, resetHistory]);

  const updateVehicle = useCallback(
    (vehicleId: string, patch: Partial<VehicleDefinition>, options?: VehicleUpdateElementOptions) => {
      if (options?.recordHistory !== false) pushHistory();
      commit(
        vehiclesRef.current.map((v) =>
          v.id === vehicleId ? { ...v, ...patch, updatedAt: Date.now() } : v,
        ),
      );
    },
    [commit, pushHistory],
  );

  const createVehicle = useCallback(
    (name: string, width: number, height: number) => {
      const now = Date.now();
      const vehicle: VehicleDefinition = {
        id: newVehicleId(),
        name: name.trim() || '未命名載具',
        width,
        height,
        backgroundColor: '#000000',
        previewData: {
          vehicle_code: 'PMS01',
          trip_code: 'D0950',
          overall_health: 'OK',
        },
        elements: [],
        createdAt: now,
        updatedAt: now,
      };
      const next = [...vehiclesRef.current, vehicle];
      commit(next);
      setActiveVehicleId(vehicle.id);
      setSelectedElementId(null);
      setSelectedElementIds([]);
      return vehicle.id;
    },
    [commit],
  );

  /**
   * 刪除：先問後端（仍被地圖、預設設定或儀表板引用就拒絕，錯誤裡帶引用清單），
   * 後端刪成功才從清單拿掉。還沒存上後端的新模型直接拿掉。
   */
  const deleteVehicle = useCallback(
    async (vehicleId: string) => {
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!vehicle) return;
      const timer = saveTimers.current.get(vehicleId);
      if (timer) clearTimeout(timer);
      saveTimers.current.delete(vehicleId);
      if (vehicle.serverVersion !== undefined) await deleteVehicleDefinition(vehicleId);
      const next = vehiclesRef.current.filter((v) => v.id !== vehicleId);
      vehiclesRef.current = next;
      setVehicles(next);
      writeCache(next);
      setSync(vehicleId, null);
      if (activeVehicleIdRef.current === vehicleId) {
        setActiveVehicleId(null);
        setSelectedElementId(null);
        setSelectedElementIds([]);
      }
    },
    [setSync],
  );

  const addElement = useCallback(
    (vehicleId: string, type: VehicleElementType, x: number, y: number) => {
      pushHistory();
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!vehicle) return undefined;

      void (async () => {
        let el = createVehicleElement(type, x, y);
        if (el.type === 'light') {
          const lights = vehicle.elements.filter(
            (e): e is VehicleLightElement => e.type === 'light',
          );
          const visibilityField = lights.length === 0 ? 'head_light_on' : 'tail_light_on';
          el = { ...el, visibilityField };
        }
        el = await fitNewIconElement(el);
        const nextElements = [...vehicle.elements, el];
        commit(
          vehiclesRef.current.map((v) =>
            v.id === vehicleId
              ? { ...v, elements: nextElements, updatedAt: Date.now() }
              : v,
          ),
        );
        setSelectedElementId(el.id);
        setSelectedElementIds([el.id]);
      })();

      return undefined;
    },
    [commit, pushHistory],
  );

  const updateElement = useCallback(
    (
      vehicleId: string,
      elementId: string,
      patch: VehicleElementPatch,
      options?: VehicleUpdateElementOptions,
    ) => {
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      const el = vehicle?.elements.find((e) => e.id === elementId);
      if (!vehicle || !el) return;

      if (options?.recordHistory !== false) pushHistory();

      void enrichPatchWithIconFit(el, patch).then((finalPatch) => {
        if (!vehiclesRef.current.some((v) => v.id === vehicleId)) return;
        commit(
          vehiclesRef.current.map((v) =>
            v.id === vehicleId
              ? {
                  ...v,
                  updatedAt: Date.now(),
                  elements: v.elements.map((e) =>
                    e.id === elementId ? ({ ...e, ...finalPatch } as VehicleElement) : e,
                  ),
                }
              : v,
          ),
        );
      });
    },
    [commit, pushHistory],
  );

  const batchUpdateElements = useCallback(
    (
      vehicleId: string,
      updates: Array<{ elementId: string; patch: VehicleElementPatch }>,
      options?: VehicleUpdateElementOptions,
    ) => {
      if (updates.length === 0) return;
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!vehicle) return;
      if (options?.recordHistory !== false) pushHistory();
      const patchMap = new Map(updates.map((u) => [u.elementId, u.patch]));
      commit(
        vehiclesRef.current.map((v) =>
          v.id === vehicleId
            ? {
                ...v,
                updatedAt: Date.now(),
                elements: v.elements.map((e) => {
                  const patch = patchMap.get(e.id);
                  return patch ? ({ ...e, ...patch } as VehicleElement) : e;
                }),
              }
            : v,
        ),
      );
    },
    [commit, pushHistory],
  );

  const deleteElement = useCallback(
    (vehicleId: string, elementId: string) => {
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!vehicle) return;
      pushHistory();
      updateVehicle(
        vehicleId,
        {
          elements: vehicle.elements.filter((e) => e.id !== elementId),
        },
        { recordHistory: false },
      );
      if (selectedElementId === elementId) {
        setSelectedElementId(null);
        setSelectedElementIds([]);
      } else {
        setSelectedElementIds((prev) => prev.filter((id) => id !== elementId));
      }
    },
    [pushHistory, updateVehicle, selectedElementId],
  );

  const deleteSelectedElements = useCallback(
    (vehicleId: string) => {
      const ids = selectedElementIdsRef.current;
      if (ids.length === 0) return;
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!vehicle) return;
      pushHistory();
      const remove = new Set(ids);
      updateVehicle(
        vehicleId,
        { elements: vehicle.elements.filter((e) => !remove.has(e.id)) },
        { recordHistory: false },
      );
      setSelectedElementId(null);
      setSelectedElementIds([]);
    },
    [pushHistory, updateVehicle],
  );

  const selectElement = useCallback((id: string | null, opts?: { additive?: boolean }) => {
    if (!id) {
      setSelectedElementId(null);
      setSelectedElementIds([]);
      return;
    }
    if (opts?.additive) {
      setSelectedElementIds((prev) => {
        const next = prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id];
        setSelectedElementId(next[next.length - 1] ?? null);
        return next;
      });
      return;
    }
    const prev = selectedElementIdsRef.current;
    if (prev.length > 1 && prev.includes(id)) {
      setSelectedElementId(id);
      return;
    }
    setSelectedElementId(id);
    setSelectedElementIds([id]);
  }, []);

  const selectElements = useCallback((ids: string[], opts?: { additive?: boolean }) => {
    if (opts?.additive) {
      setSelectedElementIds((prev) => {
        const set = new Set(prev);
        for (const id of ids) set.add(id);
        const next = [...set];
        setSelectedElementId(next[next.length - 1] ?? null);
        return next;
      });
      return;
    }
    setSelectedElementIds(ids);
    setSelectedElementId(ids[ids.length - 1] ?? null);
  }, []);

  const nudgeSelectedElements = useCallback(
    (dx: number, dy: number) => {
      const vehicleId = activeVehicleIdRef.current;
      const ids = selectedElementIdsRef.current;
      if (!vehicleId || ids.length === 0 || (dx === 0 && dy === 0)) return;
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!vehicle) return;
      pushHistory();
      const idSet = new Set(ids);
      const updates = vehicle.elements
        .filter((e) => idSet.has(e.id))
        .map((e) => ({
          elementId: e.id,
          patch: {
            x: roundVehicleNudgeCoord(e.x + dx),
            y: roundVehicleNudgeCoord(e.y + dy),
          },
        }));
      batchUpdateElements(vehicleId, updates, { recordHistory: false });
    },
    [pushHistory, batchUpdateElements],
  );

  const rotateElement = useCallback(
    (vehicleId: string, elementId: string, deltaDeg: number) => {
      const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
      const el = vehicle?.elements.find((e) => e.id === elementId);
      if (!el) return;
      pushHistory();
      const nextElements = vehicle!.elements.map((e) =>
        e.id === elementId
          ? { ...e, rotationDeg: normalizeDegrees((e.rotationDeg ?? 0) + deltaDeg) }
          : e,
      );
      updateVehicle(vehicleId, { elements: nextElements }, { recordHistory: false });
    },
    [pushHistory, updateVehicle],
  );

  const beginEditSession = useCallback(() => {
    pushHistory();
  }, [pushHistory]);

  const copySelectedElement = useCallback(() => {
    const el = vehiclesRef.current
      .find((v) => v.id === activeVehicleIdRef.current)
      ?.elements.find((e) => e.id === selectedElementIdRef.current);
    if (!el) return false;
    clipboardRef.current = structuredClone(el);
    return true;
  }, []);

  const pasteElement = useCallback(() => {
    const vehicleId = activeVehicleIdRef.current;
    const source = clipboardRef.current;
    if (!vehicleId || !source) return false;
    const vehicle = vehiclesRef.current.find((v) => v.id === vehicleId);
    if (!vehicle) return false;

    pushHistory();
    void (async () => {
      let el: VehicleElement = {
        ...structuredClone(source),
        id: newVehicleId('el'),
        x: source.x + 10,
        y: source.y + 10,
      };
      el = await fitNewIconElement(el);
      commit(
        vehiclesRef.current.map((v) =>
          v.id === vehicleId
            ? {
                ...v,
                updatedAt: Date.now(),
                elements: [...v.elements, el],
              }
            : v,
        ),
      );
      setSelectedElementId(el.id);
      setSelectedElementIds([el.id]);
    })();
    return true;
  }, [commit, pushHistory]);

  const duplicateVehicle = useCallback(
    (vehicleId: string) => {
      const source = vehiclesRef.current.find((v) => v.id === vehicleId);
      if (!source) return null;
      // 複本是新模型：新 ID、沒有伺服器版本
      const { serverVersion: _version, ...rest } = cloneVehicleDefinition(source);
      void _version;
      commit([...vehiclesRef.current, rest]);
      const duplicate = rest;
      return duplicate.id;
    },
    [commit],
  );

  const exportVehiclesJson = useCallback(
    (ids?: string[]) => {
      const list =
        ids && ids.length > 0
          ? vehiclesRef.current.filter((v) => ids.includes(v.id))
          : vehiclesRef.current;
      const label =
        ids?.length === 1
          ? `syncdrive-vehicles-${list[0]?.name ?? 'one'}`
          : 'syncdrive-vehicles';
      downloadVehicleDefinitionsJson(
        list,
        buildExportFilename(label, { kind: 'vehicle-template' }),
      );
    },
    [],
  );

  const importVehiclesFromJson = useCallback(
    async (raw: unknown) => {
      const parsed = parseVehicleDefinitionsJson(raw);
      if (parsed.length === 0) return [] as string[];
      const existingIds = new Set(vehiclesRef.current.map((v) => v.id));
      // 匯入一律當新模型：同 ID 已存在就換新 ID，不覆蓋既有模型
      const toAdd = parsed.map((v) => {
        const { serverVersion: _version, ...migrated } = migrateVehicleDefinition(v);
        void _version;
        return existingIds.has(migrated.id) ? cloneVehicleDefinition(migrated) : migrated;
      });
      commit([...vehiclesRef.current, ...toAdd]);
      return toAdd.map((v) => v.id);
    },
    [commit],
  );

  const importVehiclesFromFile = useCallback(
    async (file: File) => {
      const text = await file.text();
      const raw = JSON.parse(text) as unknown;
      return importVehiclesFromJson(raw);
    },
    [importVehiclesFromJson],
  );

  /** 離開編輯器時把還在 debounce 的修改立刻送出 */
  const flushSave = useCallback(() => {
    for (const [id, timer] of saveTimers.current) {
      clearTimeout(timer);
      void saveNow(id);
    }
  }, [saveNow]);

  const duplicateSelectedElement = useCallback(() => {
    if (!copySelectedElement()) return false;
    return pasteElement();
  }, [copySelectedElement, pasteElement]);

  return {
    vehicles,
    loadState,
    syncState,
    reloadFromServer,
    takeServerVersion,
    activeVehicle,
    activeVehicleId,
    setActiveVehicleId,
    selectedElementId,
    selectedElementIds,
    selectedElement,
    selectElement,
    selectElements,
    createVehicle,
    deleteVehicle,
    duplicateVehicle,
    exportVehiclesJson,
    importVehiclesFromFile,
    flushSave,
    updateVehicle,
    addElement,
    updateElement,
    batchUpdateElements,
    deleteElement,
    deleteSelectedElements,
    nudgeSelectedElements,
    rotateElement,
    beginEditSession,
    copySelectedElement,
    pasteElement,
    duplicateSelectedElement,
    undo,
    redo,
    canUndo,
    canRedo,
    hasClipboard: () => clipboardRef.current !== null,
  };
}
