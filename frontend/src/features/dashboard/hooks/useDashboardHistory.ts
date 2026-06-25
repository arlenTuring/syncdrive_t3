import { useCallback, useState } from 'react';
import type { DashboardPlane } from '../types';

export type DashboardEditorSnapshot = {
  planes: DashboardPlane[];
  activePlaneId: string | null;
  selectedElementId: string | null;
  selectedElementIds: string[];
  selectedChildId: string | null;
  selectedChildIds: string[];
};

const MAX_HISTORY = 50;

function cloneSnapshot(s: DashboardEditorSnapshot): DashboardEditorSnapshot {
  return {
    planes: structuredClone(s.planes),
    activePlaneId: s.activePlaneId,
    selectedElementId: s.selectedElementId,
    selectedElementIds: [...s.selectedElementIds],
    selectedChildId: s.selectedChildId,
    selectedChildIds: [...s.selectedChildIds],
  };
}

type UseDashboardHistoryParams = {
  getSnapshot: () => DashboardEditorSnapshot;
  applySnapshot: (s: DashboardEditorSnapshot) => void;
};

export function useDashboardHistory({
  getSnapshot,
  applySnapshot,
}: UseDashboardHistoryParams) {
  const [past, setPast] = useState<DashboardEditorSnapshot[]>([]);
  const [future, setFuture] = useState<DashboardEditorSnapshot[]>([]);

  const pushHistory = useCallback(() => {
    const snap = cloneSnapshot(getSnapshot());
    setPast((prev) => [...prev, snap].slice(-MAX_HISTORY));
    setFuture([]);
  }, [getSnapshot]);

  const undo = useCallback(() => {
    setPast((prev) => {
      if (prev.length === 0) return prev;
      const before = prev[prev.length - 1];
      const current = cloneSnapshot(getSnapshot());
      setFuture((f) => [current, ...f].slice(0, MAX_HISTORY));
      applySnapshot(before);
      return prev.slice(0, -1);
    });
  }, [getSnapshot, applySnapshot]);

  const redo = useCallback(() => {
    setFuture((prev) => {
      if (prev.length === 0) return prev;
      const next = prev[0];
      const current = cloneSnapshot(getSnapshot());
      setPast((p) => [...p, current].slice(-MAX_HISTORY));
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
