import { useCallback, useState } from 'react';
import type { VehicleDefinition } from '../types';

export type VehicleEditorSnapshot = {
  vehicle: VehicleDefinition;
  selectedElementId: string | null;
  selectedElementIds: string[];
};

const MAX_HISTORY = 50;

function cloneSnapshot(s: VehicleEditorSnapshot): VehicleEditorSnapshot {
  return {
    vehicle: structuredClone(s.vehicle),
    selectedElementId: s.selectedElementId,
    selectedElementIds: [...s.selectedElementIds],
  };
}

type Params = {
  getSnapshot: () => VehicleEditorSnapshot | null;
  applySnapshot: (s: VehicleEditorSnapshot) => void;
};

export function useVehicleHistory({ getSnapshot, applySnapshot }: Params) {
  const [past, setPast] = useState<VehicleEditorSnapshot[]>([]);
  const [future, setFuture] = useState<VehicleEditorSnapshot[]>([]);

  const pushHistory = useCallback(() => {
    const snap = getSnapshot();
    if (!snap) return;
    setPast((prev) => [...prev, cloneSnapshot(snap)].slice(-MAX_HISTORY));
    setFuture([]);
  }, [getSnapshot]);

  const undo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev;
      const before = prev[prev.length - 1];
      const current = getSnapshot();
      if (current) {
        setFuture((f) => [cloneSnapshot(current), ...f].slice(0, MAX_HISTORY));
      }
      applySnapshot(before);
      return prev.slice(0, -1);
    });
  }, [getSnapshot, applySnapshot]);

  const redo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      const current = getSnapshot();
      if (current) {
        setPast((p) => [...p, cloneSnapshot(current)].slice(-MAX_HISTORY));
      }
      applySnapshot(next);
      return prev.slice(1);
    });
  }, [getSnapshot, applySnapshot]);

  const resetHistory = useCallback(() => {
    setPast([]);
    setFuture([]);
  }, []);

  return {
    pushHistory,
    undo,
    redo,
    resetHistory,
    canUndo: past.length > 0,
    canRedo: future.length > 0,
  };
}
