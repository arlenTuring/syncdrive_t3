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

const DURATION_INPUT_CLASS =
  'h-[42px] w-full rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type StepStationDurationParamsProps = {
  title: string;
  draft: StationDurationTaskDraft;
  onChange: (next: StationDurationTaskDraft) => void;
  showFollowTemplateCheckbox?: boolean;
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
          equipmentId: station.facilityId,
          // 存的是站名——引擎比對拓樸節點時用的就是節點顯示名
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
        {showFollowTemplateCheckbox && (
          <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-4">
            <label className="flex cursor-pointer items-center gap-2 text-sm font-medium text-[#2B7FFF]">
              <input
                type="checkbox"
                checked={task.durationFollowTemplate !== false}
                onChange={(e) =>
                  patchTask({
                    durationFollowTemplate: e.target.checked,
                  })
                }
                className="size-4 rounded border-zinc-700 bg-zinc-900 accent-[#2B7FFF]"
              />
              依照排班調度決定時長
            </label>
            <p className="mt-1.5 pl-6 text-xs leading-normal text-zinc-500">
              勾選後，排班引擎會直接採用時間模板中該任務區間的原始長度，不限固定作業時長。
            </p>
          </div>
        )}

        {(!showFollowTemplateCheckbox || task.durationFollowTemplate === false) && (
          <div>
            <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
              <span className="text-red-500">*</span>
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
