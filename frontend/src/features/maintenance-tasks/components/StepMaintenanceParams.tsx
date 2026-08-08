import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import {
  DEFAULT_MAINTENANCE_MAP_ID,
  fetchYardFacilityEquipment,
  type FieldEquipmentItem,
} from '../api/fieldEquipmentApi';
import {
  newMaintenanceCycleConditionRowId,
  newMaintenanceFacilityEquipmentRowId,
  normalizeMaintenanceDraft,
  type MaintenanceCycleConditionRow,
  type MaintenanceCycleUnit,
  type MaintenanceFacilityEquipmentRow,
  type MaintenanceTaskMaintenanceDraft,
} from '../types/create';
import { sanitizeIntegerInput } from '../utils/numericInput';
import { FacilityEquipmentRowsEditor } from './FacilityEquipmentRowsEditor';
import { StepSectionToggle } from './StepSectionToggle';

const SMALL_INPUT_CLASS =
  'h-9 w-[88px] rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-2 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

const UNIT_SELECT_CLASS =
  'h-9 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-2 text-sm text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

const EVENT_INPUT_CLASS =
  'h-9 min-w-[140px] flex-1 rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

function cyclePrefixText(unit: MaintenanceCycleUnit): string {
  return unit === 'mileage' ? '當車輛行程每滿' : '當車輛時間每滿';
}

type StepMaintenanceParamsProps = {
  draft: MaintenanceTaskMaintenanceDraft;
  onChange: (next: MaintenanceTaskMaintenanceDraft) => void;
};

export function StepMaintenanceParams({ draft, onChange }: StepMaintenanceParamsProps) {
  const maintenance = normalizeMaintenanceDraft(draft);
  const patchMaintenance = (patch: Partial<MaintenanceTaskMaintenanceDraft>) =>
    onChange(normalizeMaintenanceDraft({ ...maintenance, ...patch }));

  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEquipment(true);
    setEquipmentError(null);
    void fetchYardFacilityEquipment(DEFAULT_MAINTENANCE_MAP_ID, '保養格')
      .then((res) => {
        if (cancelled) return;
        setEquipment(res.items);
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
  }, []);

  const updateCondition = (rowId: string, patch: Partial<MaintenanceCycleConditionRow>) => {
    patchMaintenance({
      cycleConditions: maintenance.cycleConditions.map((row) =>
        row.id === rowId ? { ...row, ...patch } : row,
      ),
    });
  };

  const removeCondition = (rowId: string) => {
    patchMaintenance({
      cycleConditions: maintenance.cycleConditions.filter((row) => row.id !== rowId),
    });
  };

  const addCondition = () => {
    patchMaintenance({
      cycleConditions: [
        ...maintenance.cycleConditions,
        {
          id: newMaintenanceCycleConditionRowId(),
          unit: 'mileage',
          rangeMin: '',
          rangeMax: '',
          eventContent: '',
          durationMinutes: '',
        },
      ],
    });
  };

  return (
    <StepSectionToggle
      title="填入保養任務"
      enabled={maintenance.stepEnabled}
      onEnabledChange={(stepEnabled) => patchMaintenance({ stepEnabled })}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-5">
          <div className="mb-4">
            <span className="text-sm font-medium text-zinc-200">循環條件設定</span>
          </div>

          {maintenance.cycleConditions.length === 0 ? (
            <p className="mb-3 text-sm text-zinc-600">尚未新增循環條件，請點擊下方 + 新增</p>
          ) : (
            <div className="space-y-3">
              {maintenance.cycleConditions.map((row, index) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 text-sm text-zinc-300"
                >
                  <span className="w-6 shrink-0 text-zinc-500">{index + 1}.</span>
                  <span>{cyclePrefixText(row.unit)}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.rangeMin}
                    onChange={(e) =>
                      updateCondition(row.id, {
                        rangeMin: sanitizeIntegerInput(e.target.value),
                      })
                    }
                    placeholder="請輸入值"
                    className={SMALL_INPUT_CLASS}
                  />
                  <span>-</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.rangeMax}
                    onChange={(e) =>
                      updateCondition(row.id, {
                        rangeMax: sanitizeIntegerInput(e.target.value),
                      })
                    }
                    placeholder="請輸入值"
                    className={SMALL_INPUT_CLASS}
                  />
                  <select
                    value={row.unit}
                    onChange={(e) =>
                      updateCondition(row.id, {
                        unit: e.target.value === 'time' ? 'time' : 'mileage',
                      })
                    }
                    className={UNIT_SELECT_CLASS}
                    aria-label="循環條件單位"
                  >
                    <option value="mileage">公里</option>
                    <option value="time">小時</option>
                  </select>
                  <span>，觸發</span>
                  <input
                    type="text"
                    value={row.eventContent}
                    onChange={(e) =>
                      updateCondition(row.id, { eventContent: e.target.value })
                    }
                    placeholder="事件內容"
                    className={EVENT_INPUT_CLASS}
                  />
                  <span>，預估</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.durationMinutes}
                    onChange={(e) =>
                      updateCondition(row.id, {
                        durationMinutes: sanitizeIntegerInput(e.target.value),
                      })
                    }
                    placeholder="作業時長"
                    className={SMALL_INPUT_CLASS}
                  />
                  <span>分</span>
                  <button
                    type="button"
                    onClick={() => removeCondition(row.id)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                    aria-label="移除條件"
                  >
                    <X className="size-4" />
                  </button>
                </div>
              ))}
            </div>
          )}

          <button
            type="button"
            onClick={addCondition}
            className="mt-4 inline-flex size-9 items-center justify-center rounded-lg border border-zinc-700 text-[#2B7FFF] transition hover:border-[#2B7FFF]/50 hover:bg-zinc-900"
            aria-label="新增循環條件"
          >
            <Plus className="size-4" />
          </button>
        </div>

        <FacilityEquipmentRowsEditor<MaintenanceFacilityEquipmentRow>
          rows={maintenance.equipmentRows}
          equipment={equipment}
          loadingEquipment={loadingEquipment}
          equipmentError={equipmentError}
          equipmentHint={
            equipment.length > 0
              ? `場域共 ${equipment.length} 座設施格可掛載（${equipment.map((e) => e.mapCode).join('、')}）；掛哪一座由整備任務決定，不受地圖用途限制`
              : undefined
          }
          newRow={() => ({
            id: newMaintenanceFacilityEquipmentRowId(),
            mapCode: '',
            waypointCode: '',
          })}
          onChange={(equipmentRows) => patchMaintenance({ equipmentRows })}
        />
      </div>
    </StepSectionToggle>
  );
}
