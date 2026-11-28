import { useEffect, useState } from 'react';
import {
  fetchYardFacilityEquipment,
  resolveActiveMaintenanceMapId,
  type FieldEquipmentItem,
} from '../api/fieldEquipmentApi';
import { fetchMapStations } from '../api/waypointsApi';
import {
  newStationDurationEquipmentRowId,
  normalizeStationDurationDraft,
  type MaintenanceFacilityEquipmentRow,
  type StationDurationTaskDraft,
} from '../types/create';
import { sanitizeIntegerInput } from '../utils/numericInput';
import { FacilityEquipmentRowsEditor } from './FacilityEquipmentRowsEditor';
import { StepSectionToggle } from './StepSectionToggle';
import { Checkbox, cn, fieldClass } from '../../../components/ui';

const DURATION_INPUT_CLASS =
  cn(fieldClass({ size: 'md', fullWidth: true }));

type StepStationDurationParamsProps = {
  title: string;
  draft: StationDurationTaskDraft;
  onChange: (next: StationDurationTaskDraft) => void;
  showFollowTemplateCheckbox?: boolean;
  /** 時長一律照時間模板（機動）：不顯示勾選框，也不顯示作業時長欄 */
  durationAlwaysFollowsTemplate?: boolean;
  /**
   * 設施下拉的偏好排序用途（例「保養格」／「調度格」）。
   * 只影響排序，不影響可選範圍——任何設施格都掛得上。
   */
  preferredFacilityPurpose?: string;
  /**
   * 把地圖上的<strong>停靠站</strong>也一併列進可選清單。
   * <strong>只有待命任務會開</strong>：待命的車就是在場上候用，可以直接停在
   * 正線停靠站等待；其他整備任務一定要進實體設施格（充電要有充電樁、
   * 保養要有維修坑），不能佔著正線站位當工作區。
   */
  includeStations?: boolean;
};

export function StepStationDurationParams({
  title,
  draft,
  onChange,
  showFollowTemplateCheckbox = false,
  durationAlwaysFollowsTemplate = false,
  preferredFacilityPurpose,
  includeStations = false,
}: StepStationDurationParamsProps) {
  const task = normalizeStationDurationDraft(draft);
  const patchTask = (patch: Partial<StationDurationTaskDraft>) =>
    onChange(normalizeStationDurationDraft({ ...task, ...patch }));

  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEquipment(true);
    setEquipmentError(null);
    void (async () => {
      const facilities = await fetchYardFacilityEquipment(undefined, preferredFacilityPurpose);
      if (!includeStations) return facilities.items;
      // 停靠站排在設施格之後——設施才是主要選項，停靠站是待命才有的額外選擇
      const mapId = await resolveActiveMaintenanceMapId();
      const stations = await fetchMapStations(mapId);
      return [
        ...facilities.items,
        ...stations.stations.map((station): FieldEquipmentItem => ({
          // 識別是停靠點的地圖設施 ID（＝拓樸節點 ID）；站名只是顯示，改名不影響對應
          equipmentId: station.facilityId,
          mapCode: station.stationName,
          equipmentKind: 'docking',
          objectCategory: 'facility',
          label: station.stationName,
          purpose: '停靠站',
          areaId: station.areaId,
          areaName: '停靠站',
        })),
      ];
    })()
      .then((items) => {
        if (cancelled) return;
        setEquipment(items);
      })
      .catch((error) => {
        if (!cancelled) {
          setEquipment([]);
          setEquipmentError(error instanceof Error ? error.message : String(error));
        }
      })
      .finally(() => {
        if (!cancelled) setLoadingEquipment(false);
      });
    return () => {
      cancelled = true;
    };
  }, [preferredFacilityPurpose, includeStations]);

  return (
    <StepSectionToggle
      title={title}
      enabled={task.stepEnabled}
      onEnabledChange={(stepEnabled) => patchTask({ stepEnabled })}
    >
      <div className="space-y-6">
        {showFollowTemplateCheckbox && !durationAlwaysFollowsTemplate && (
          <div className="rounded-lg border border-border-quaternary bg-surface-primary p-4">
            <label className="flex cursor-pointer items-center gap-2 text-body-s-bold text-text-theme-light">
              <Checkbox checked={task.durationFollowTemplate !== false} onCheckedChange={(checked) => patchTask({
                    durationFollowTemplate: checked,
                  })
                } />
              依照排班調度決定時長
            </label>
            <p className="mt-1.5 pl-6 text-body-xs text-text-quaternary">
              勾選後，排班引擎會直接採用時間模板中該任務區間的原始長度，不限固定作業時長。
            </p>
          </div>
        )}

        {!durationAlwaysFollowsTemplate && (!showFollowTemplateCheckbox || task.durationFollowTemplate === false) && (
          <div>
            <span className="mb-2 flex items-center gap-1 text-body-s text-text-secondary">
              <span className="text-status-error">*</span>
              單次作業時長 (分鐘)
            </span>
            <input
              type="text"
              inputMode="numeric"
              value={task.operationDurationMinutes}
              onChange={(e) =>
                patchTask({
                  operationDurationMinutes: sanitizeIntegerInput(e.target.value),
                })
              }
              placeholder="請輸入分鐘數"
              className={DURATION_INPUT_CLASS}
            />
          </div>
        )}

        <FacilityEquipmentRowsEditor<MaintenanceFacilityEquipmentRow>
          rows={task.equipmentRows}
          equipment={equipment}
          loadingEquipment={loadingEquipment}
          equipmentError={equipmentError}
          equipmentHint={
            equipment.length > 0
              ? `場域共 ${equipment.length} 座設施格可掛載（${equipment.map((e) => e.mapCode).join('、')}）；掛哪一座由整備任務決定，不受地圖用途限制`
              : undefined
          }
          newRow={() => ({
            id: newStationDurationEquipmentRowId(),
            mapCode: '',
            waypointCode: '',
          })}
          onChange={(equipmentRows) => patchTask({ equipmentRows })}
        />
      </div>
    </StepSectionToggle>
  );
}
