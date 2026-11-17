import { SiteSelect } from '../../../components/SiteSelect';
import { Loader2, Plus, X } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { resolveActiveMaintenanceMapId } from '../api/fieldEquipmentApi';
import type { FieldEquipmentItem } from '../api/fieldEquipmentApi';
import {
  fetchMapWaypoints,
  waypointOptionLabel,
  type MapWaypointItem,
} from '../api/waypointsApi';
import type { MaintenanceFacilityEquipmentRow } from '../types/create';
import { IconButton } from '../../../components/ui';

const SELECT_CLASS =
  'h-[42px] min-w-0 flex-1 rounded-lg border border-border-quaternary bg-surface-primary px-3 text-body-s text-text-primary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';

const WAYPOINT_SELECT_CLASS =
  'h-[42px] w-[148px] shrink-0 rounded-lg border border-border-quaternary bg-surface-primary px-3 text-body-s text-text-primary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';

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

  /** 一列指到哪個設施：以設施 ID 為準；沒有 ID 的舊列才用名稱找（後端讀取時通常已補上 ID） */
  const equipmentIdOf = (row: TRow): string =>
    row.equipmentId || equipment.find((item) => item.mapCode === row.mapCode)?.equipmentId || '';
  const selectedIds = new Set(rows.map(equipmentIdOf).filter(Boolean));

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
      (item) => item.equipmentId === equipmentIdOf(row) || !selectedIds.has(item.equipmentId),
    );

  return (
    <div>
      <div className="mb-3 flex items-center justify-between gap-3">
        <span className="text-body-s text-text-secondary">{t('maintenanceTasks.facilityRows.loadFacilities')}</span>
        <IconButton size="small" hierarchy="subordinate" variant="standard" className="shrink-0" onPress={addRow} disabled={!canAddRow || loadingEquipment || Boolean(equipmentError)} label={t('maintenanceTasks.facilityRows.addRowAria')} icon={<Plus />} />
      </div>

      {loadingEquipment && (
        <div className="flex items-center gap-2 py-4 text-body-s text-text-quaternary">
          <Loader2 className="size-4 animate-spin" />
          {t('maintenanceTasks.facilityRows.loading')}
        </div>
      )}

      {equipmentError && <p className="py-2 text-body-s text-status-error-emphasis">{equipmentError}</p>}

      {!loadingEquipment && !equipmentError && equipment.length === 0 && (
        <p className="py-2 text-body-s text-text-quaternary">{t('maintenanceTasks.facilityRows.empty')}</p>
      )}

      {loadingWaypoints && rows.length > 0 && (
        <p className="mb-3 text-body-xs text-text-quaternary">{t('maintenanceTasks.facilityRows.loadingWaypoints')}</p>
      )}

      {waypointError && (
        <p className="mb-3 text-body-s text-status-warning">
          {t('maintenanceTasks.facilityRows.waypointLoadFailed', { error: waypointError })}
        </p>
      )}

      {!loadingEquipment && rows.length > 0 && (
        <div className="space-y-3">
          {rows.map((row) => (
            <div
              key={row.id}
              className="flex flex-wrap items-center gap-3 rounded-xl border border-border-quaternary bg-black-30 p-3"
            >
              <SiteSelect
                value={equipmentIdOf(row)}
                onChange={(e) => {
                  const item = equipment.find((candidate) => candidate.equipmentId === e.target.value);
                  // 存設施 ID（識別）與目前名稱（顯示快照）
                  updateRow(row.id, {
                    equipmentId: item?.equipmentId ?? '',
                    mapCode: item?.mapCode ?? '',
                    unresolved: undefined,
                  } as Partial<TRow>);
                }}
                className={SELECT_CLASS}
              >
                <option value="">{t('maintenanceTasks.facilityRows.selectFacility')}</option>
                {row.unresolved && !equipmentIdOf(row) ? (
                  <option value="" disabled>{`${row.mapCode}（地圖上找不到這個設施）`}</option>
                ) : null}
                {optionsForRow(row).map((item) => (
                  <option key={item.equipmentId} value={item.equipmentId}>
                    {item.mapCode}
                  </option>
                ))}
              </SiteSelect>

              <SiteSelect
                value={row.waypointCode}
                title={t('maintenanceTasks.facilityRows.waypointAria')}
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
                    {waypointOptionLabel(item)}
                  </option>
                ))}
              </SiteSelect>

              {renderExtraFields?.(row, (patch) => updateRow(row.id, patch))}

              <IconButton size="small" hierarchy="subordinate" variant="standard" className="shrink-0" onPress={() => removeRow(row.id)} label={t('maintenanceTasks.facilityRows.removeRowAria')} icon={<X />} />
            </div>
          ))}
        </div>
      )}

      {!loadingEquipment && equipment.length > 0 && equipmentHint ? (
        <p className="mt-2 text-body-xs text-text-disabled">{equipmentHint}</p>
      ) : null}
    </div>
  );
}
