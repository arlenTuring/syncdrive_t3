import { useEffect, useMemo } from 'react';
import type { CanvasElementProps } from '../types';
import { useWidgetData } from './useWidgetData';
import { useGenericGroupSlots } from './useGenericGroupSlots';
import { useShiftFleetMqttMap } from '../context/ShiftFleetMqttContext';
import { mergeMainlineShiftRoster, mergeMaintenanceShiftRoster } from '../utils/mergeShiftRosterRows';
import { useShiftSourcePostProcessors } from '../hooks/useShiftSourcePostProcessors';

/**
 * 群組在執行畫面上真正會拿到的列——編輯子畫布／樣板時拿來當預覽資料。
 *
 * 原本編輯子畫布時注入的是一列寫死的示範資料（trip_code S0000、eta_remain 00:30:00、
 * vehicle_code PMS01…），畫面看起來每個欄位都有值，使用者沒辦法確認資料到底有沒有接上。
 * 這裡改跑跟執行畫面同一條資料管線（同一組來源、同一個 MQTT 後處理），拿到幾列就是幾列；
 * 沒有資料就回傳空陣列，不補示範值。
 */
export interface GroupPreviewRowsState {
  rows: Record<string, unknown>[];
  loading: boolean;
  error: string | null;
  stale: boolean;
  unplacedCount: number;
}

function GenericGroupRowsProbe({
  group,
  templateId,
  onChange,
}: {
  group: CanvasElementProps;
  templateId: string | null;
  onChange: (state: GroupPreviewRowsState) => void;
}) {
  const config = group.genericGroup;
  const capacity = Math.max(1, config?.capacityConfig?.capacity ?? group.slotCount ?? group.gridColumns ?? 6);
  const sourcePostProcessors = useShiftSourcePostProcessors();
  const { fetchers, candidates, isInitialLoading, sourceStates, postProcessProblems } = useGenericGroupSlots(config, capacity, {
    sourcePostProcessors,
  });
  const rows = useMemo(
    () => candidates
      .filter((candidate) => !templateId || candidate.template?.id === templateId)
      .map((candidate) => candidate.row),
    [candidates, templateId],
  );
  const errors = Object.entries(sourceStates)
    .filter(([, state]) => state.error)
    .map(([id, state]) => `${id}: ${state.error}`);
  const stale = Object.values(sourceStates).some((state) => !!state.error && state.data.length > 0);
  const fingerprint = JSON.stringify(rows);
  useEffect(() => {
    onChange({
      rows,
      loading: isInitialLoading,
      error: [...errors, ...postProcessProblems].join('；') || null,
      stale,
      unplacedCount: Math.max(0, candidates.length - capacity),
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, isInitialLoading, errors.join('|'), stale, postProcessProblems.join('|'), candidates.length, capacity]);
  return <>{fetchers}</>;
}

function LegacyGroupRowsProbe({
  group,
  onChange,
}: {
  group: CanvasElementProps;
  onChange: (state: GroupPreviewRowsState) => void;
}) {
  const { data, loading, error } = useWidgetData({
    dataSourceId: group.dataSourceId,
    sqlQuery: group.sqlQuery,
    dataUrl: group.dataUrl,
    refreshInterval: group.refreshInterval,
    refreshMode: group.refreshMode,
    invalidateTags: group.invalidateTags,
  });
  const fleetMqtt = useShiftFleetMqttMap();
  const rows = useMemo(() => {
    // 跟 GroupCanvasRenderer 執行時同一個合併規則
    if (group.label === '正線班次') return mergeMainlineShiftRoster(data, fleetMqtt);
    if (group.label === '整備班表') return mergeMaintenanceShiftRoster(data, fleetMqtt);
    return data;
  }, [group.label, data, fleetMqtt]);
  const fingerprint = JSON.stringify(rows);
  useEffect(() => {
    onChange({ rows, loading, error: error ?? null, stale: !!error && rows.length > 0, unplacedCount: 0 });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fingerprint, loading, error]);
  return null;
}

/** 掛在編輯器裡（不佔版面），把群組的真實列交給 onChange */
export function GroupPreviewRowsProbe({
  group,
  templateId = null,
  onChange,
}: {
  group: CanvasElementProps;
  templateId?: string | null;
  onChange: (state: GroupPreviewRowsState) => void;
}) {
  if (group.genericGroup?.enabled) {
    return <GenericGroupRowsProbe group={group} templateId={templateId} onChange={onChange} />;
  }
  return <LegacyGroupRowsProbe group={group} onChange={onChange} />;
}
