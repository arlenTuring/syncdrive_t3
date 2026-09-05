import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveActiveMaintenanceMapId } from '../api/fieldEquipmentApi';
import type { FieldEquipmentItem } from '../api/fieldEquipmentApi';
import {
  fetchMapWaypoints,
  type MapWaypointItem,
} from '../api/waypointsApi';
import type { MaintenanceFacilityEquipmentRow } from '../types/create';

const SELECT_CLASS =
  'h-[42px] min-w-0 flex-1 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

const WAYPOINT_SELECT_CLASS =
  'h-[42px] w-[148px] shrink-0 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type FacilityEquipmentRowsEditorProps<TRow extends MaintenanceFacilityEquipmentRow> = {
  rows: TRow[];
  equipment: FieldEquipmentItem[];
  loadingEquipment: boolean;
  equipmentError: string | null;
  equipmentHint?: string;
  newRow: () => TRow;
  onChange: (rows: TRow[]) => void;
  renderExtraFields?: (
    row: TRow,
    updateRow: (patch: Partial<TRow>) => void,
  ) => ReactNode;
};

export function FacilityEquipmentRowsEditor<TRow extends MaintenanceFacilityEquipmentRow>({
  rows,
  equipment,
  loadingEquipment,
  equipmentError,
  equipmentHint,
  newRow,
  onChange,
  renderExtraFields,
}: FacilityEquipmentRowsEditorProps<TRow>) {
  const { t } = useTranslation();
  const [waypoints, setWaypoints] = useState<MapWaypointItem[]>([]);
  const [loadingWaypoints, setLoadingWaypoints] = useState(true);
  const [waypointError, setWaypointError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingWaypoints(true);
    setWaypointError(null);
    void resolveActiveMaintenanceMapId()
      .then((mapId) => fetchMapWaypoints(mapId))
      .then((result) => {
        if (cancelled) return;
        setWaypoints(result.items);
      })
      .catch((error) => {
        if (cancelled) return;
        setWaypointError(error instanceof Error ? error.message : String(error));
        setWaypoints([]);
      })
      .finally(() => {
        if (!cancelled) setLoadingWaypoints(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const selectedCodes = useMemo(
    () => new Set(rows.map((row) => row.mapCode).filter(Boolean)),
    [rows],
  );

  const canAddRow = rows.length < equipment.length;

  const updateRow = (rowId: string, patch: Partial<TRow>) => {
    onChange(
      rows.map((row) => (row.id === rowId ? { ...row, ...patch } : row)),
    );
  };

  const removeRow = (rowId: string) => {
    onChange(rows.filter((row) => row.id !== rowId));
  };

  const addRow = () => {
    if (!canAddRow) return;
    onChange([...rows, newRow()]);
  };

  const optionsForRow = (row: TRow) =>
    equipment.filter(
      (item) => item.mapCode === row.mapCode || !selectedCodes.has(item.mapCode),
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-sm text-zinc-300">{t('maintenanceTasks.facilityRows.loadFacilities')}</span>
        <button
          type="button"
          onClick={addRow}
          disabled={!canAddRow || loadingEquipment || Boolean(equipmentError)}
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-lg border border-zinc-700 text-zinc-300 transition hover:border-zinc-600 hover:bg-zinc-900 disabled:cursor-not-allowed disabled:opacity-40"
          aria-label={t('maintenanceTasks.facilityRows.addRowAria')}
        >
          <Plus className="size-4" />
        </button>
      </div>

      {loadingEquipment && (
        <div className="flex items-center gap-2 py-4 text-sm text-zinc-500">
          <Loader2 className="size-4 animate-spin" />
          {t('maintenanceTasks.facilityRows.loading')}
        </div>
      )}

      {equipmentError && <p className="py-2 text-sm text-red-400">{equipmentError}</p>}

      {!loadingEquipment && !equipmentError && equipment.length === 0 && (
        <p className="py-2 text-sm text-zinc-500">{t('maintenanceTasks.facilityRows.empty')}</p>
      )}

      {loadingWaypoints && rows.length > 0 && (
        <p className="mb-3 text-xs text-zinc-500">{t('maintenanceTasks.facilityRows.loadingWaypoints')}</p>
      )}

      {waypointError && (
        <p className="mb-3 text-sm text-amber-400/90">
          {t('maintenanceTasks.facilityRows.waypointLoadFailed', { error: waypointError })}
        </p>
      )}

      {!loadingEquipment && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-zinc-800/80 bg-zinc-950/30 p-3"
            >
              <select
                value={row.mapCode}
                onChange={(e) => updateRow(row.id, { mapCode: e.target.value } as Partial<TRow>)}
                className={SELECT_CLASS}
              >
                <option value="">{t('maintenanceTasks.facilityRows.selectFacility')}</option>
                {optionsForRow(row).map((item) => (
                  <option key={item.equipmentId} value={item.mapCode}>
                    {item.mapCode}
                  </option>
                ))}
              </select>

              <select
                value={row.waypointCode}
                onChange={(e) =>
                  updateRow(row.id, { waypointCode: e.target.value } as Partial<TRow>)
                }
                disabled={loadingWaypoints}
                className={WAYPOINT_SELECT_CLASS}
                aria-label={t('maintenanceTasks.facilityRows.waypointAria')}
              >
                <option value="">{t('maintenanceTasks.facilityRows.noWaypoint')}</option>
                {waypoints.map((item) => (
                  <option key={item.waypointCode} value={item.waypointCode}>
                    {item.waypointCode}
                  </option>
                ))}
              </select>

              {renderExtraFields?.(row, (patch) => updateRow(row.id, patch))}

              <button
                type="button"
                onClick={() => removeRow(row.id)}
                className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                aria-label={t('maintenanceTasks.facilityRows.removeRowAria')}
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {!loadingEquipment && equipment.length > 0 && equipmentHint ? (
        <p className="mt-2 text-xs text-zinc-600">{equipmentHint}</p>
      ) : null}
    </div>
  );
}
