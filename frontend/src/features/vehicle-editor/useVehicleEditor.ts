import { useCallback, useEffect, useRef, useState } from 'react';
import { buildExportFilename } from '../../lib/exportFilename';
import { normalizeDegrees } from '../map-editor/utils/rotation';
import { VEHICLE_DEFINITIONS_STORAGE_KEY } from '../../lib/canvasCacheReset';
import { MAP_TRACK_VEHICLE_HEIGHT, MAP_TRACK_VEHICLE_WIDTH } from './constants/palette';
import {
  createUserRestoredVtmsVehicle,
  USER_RESTORED_VEHICLE_ID,
} from './constants/userRestoredVtmsVehicle';
import { useVehicleHistory, type VehicleEditorSnapshot } from './hooks/useVehicleHistory';
import { createVehicleElement } from './utils/createElement';
import { roundVehicleNudgeCoord } from './utils/vehicleNudge';
import { enrichPatchWithIconFit, fitNewIconElement } from './utils/elementIconFit';
import { migrateVehicleDefinition } from './utils/migrateVehicleDefinition';
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
let saveTimer: ReturnType<typeof setTimeout> | undefined;

export type VehicleUpdateElementOptions = {
  recordHistory?: boolean;
};

function wasReplacedByGenericTemplate(v: VehicleDefinition): boolean {
  if (v.id !== USER_RESTORED_VEHICLE_ID) return false;
  if (v.width === MAP_TRACK_VEHICLE_WIDTH && v.height === MAP_TRACK_VEHICLE_HEIGHT) return true;
  const body = v.elements.find((el) => el.type === 'body');
  if (body && body.y === 0 && body.width >= 400) return true;
  return false;
}

function mergeRestoredUserVehicle(list: VehicleDefinition[]): VehicleDefinition[] {
  const restored = createUserRestoredVtmsVehicle();
  const idx = list.findIndex((v) => v.id === USER_RESTORED_VEHICLE_ID);
  if (idx < 0) return [...list, restored];
  if (wasReplacedByGenericTemplate(list[idx]!)) {
    const next = [...list];
    next[idx] = restored;
    return next;
  }
  return list;
}

function loadVehicles(): VehicleDefinition[] {
  try {
    const raw = localStorage.getItem(VEHICLE_DEFINITIONS_STORAGE_KEY);
    if (!raw) return [migrateVehicleDefinition(createUserRestoredVtmsVehicle())];
    const parsed = JSON.parse(raw) as VehicleDefinition[];
    if (!Array.isArray(parsed) || parsed.length === 0) {
      return [migrateVehicleDefinition(createUserRestoredVtmsVehicle())];
    }
    return mergeRestoredUserVehicle(parsed).map(migrateVehicleDefinition);
  } catch {
    return [migrateVehicleDefinition(createUserRestoredVtmsVehicle())];
  }
}

function loadAndPersistVehicles(): VehicleDefinition[] {
  const next = loadVehicles();
  flushVehiclesSave(next);
  return next;
}

function saveVehicles(vehicles: VehicleDefinition[]) {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    flushVehiclesSave(vehicles);
  }, SAVE_DEBOUNCE_MS);
}

export function flushVehiclesSave(vehicles: VehicleDefinition[]) {
  if (saveTimer) {
    clearTimeout(saveTimer);
    saveTimer = undefined;
  }
  try {
    localStorage.setItem(VEHICLE_DEFINITIONS_STORAGE_KEY, JSON.stringify(vehicles));
  } catch {
    /* ignore quota */
  }
}

export function useVehicleEditor() {
  const [vehicles, setVehicles] = useState<VehicleDefinition[]>(() => loadAndPersistVehicles());
  const [activeVehicleId, setActiveVehicleId] = useState<string | null>(null);
  const [selectedElementId, setSelectedElementId] = useState<string | null>(null);
  const [selectedElementIds, setSelectedElementIds] = useState<string[]>([]);
  const vehiclesRef = useRef(vehicles);
  const activeVehicleIdRef = useRef(activeVehicleId);
  const selectedElementIdRef = useRef(selectedElementId);
  const selectedElementIdsRef = useRef(selectedElementIds);
  const clipboardRef = useRef<VehicleElement | null>(null);

  vehiclesRef.current = vehicles;
  activeVehicleIdRef.current = activeVehicleId;
  selectedElementIdRef.current = selectedElementId;
  selectedElementIdsRef.current = selectedElementIds;

  const activeVehicle = vehicles.find((v) => v.id === activeVehicleId) ?? null;
  const selectedElement =
    activeVehicle?.elements.find((e) => e.id === selectedElementId) ?? null;

  const commit = useCallback((next: VehicleDefinition[]) => {
    setVehicles(next);
    saveVehicles(next);
  }, []);

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
          vehicle_code: 'PMS-01',
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

  const deleteVehicle = useCallback(
    (vehicleId: string) => {
      const next = vehiclesRef.current.filter((v) => v.id !== vehicleId);
      commit(next.length > 0 ? next : [migrateVehicleDefinition(createUserRestoredVtmsVehicle())]);
      if (activeVehicleId === vehicleId) {
        setActiveVehicleId(null);
        setSelectedElementId(null);
        setSelectedElementIds([]);
      }
    },
    [commit, activeVehicleId],
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
      const duplicate = cloneVehicleDefinition(source);
      commit([...vehiclesRef.current, duplicate]);
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
      flushVehiclesSave(vehiclesRef.current);
    },
    [],
  );

  const importVehiclesFromJson = useCallback(
    async (raw: unknown) => {
      const parsed = parseVehicleDefinitionsJson(raw);
      if (parsed.length === 0) return [] as string[];
      const existingIds = new Set(vehiclesRef.current.map((v) => v.id));
      const toAdd = parsed.map((v) => {
        const migrated = migrateVehicleDefinition(v);
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

  const flushSave = useCallback(() => {
    flushVehiclesSave(vehiclesRef.current);
  }, []);

  const duplicateSelectedElement = useCallback(() => {
    if (!copySelectedElement()) return false;
    return pasteElement();
  }, [copySelectedElement, pasteElement]);

  return {
    vehicles,
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
