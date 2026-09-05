import { Plus, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
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

type StepMaintenanceParamsProps = {
  draft: MaintenanceTaskMaintenanceDraft;
  onChange: (next: MaintenanceTaskMaintenanceDraft) => void;
};

export function StepMaintenanceParams({ draft, onChange }: StepMaintenanceParamsProps) {
  const { t } = useTranslation();
  const maintenance = normalizeMaintenanceDraft(draft);
  const patchMaintenance = (patch: Partial<MaintenanceTaskMaintenanceDraft>) =>
    onChange(normalizeMaintenanceDraft({ ...maintenance, ...patch }));

  const cyclePrefixText = (unit: MaintenanceCycleUnit): string =>
    unit === 'mileage'
      ? t('maintenanceTasks.maintenance.cyclePrefixMileage')
      : t('maintenanceTasks.maintenance.cyclePrefixTime');

  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEquipment(true);
    setEquipmentError(null);
    void fetchYardFacilityEquipment(undefined, '保養格')
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
      title={t('maintenanceTasks.maintenance.title')}
      enabled={maintenance.stepEnabled}
      onEnabledChange={(stepEnabled) => patchMaintenance({ stepEnabled })}
    >
      <div className="space-y-6">
        <div className="rounded-xl border border-zinc-800/80 bg-zinc-950/40 p-5">
          <div className="mb-4">
            <span className="text-sm font-medium text-zinc-200">
              {t('maintenanceTasks.maintenance.cycleTitle')}
            </span>
          </div>

          {maintenance.cycleConditions.length === 0 ? (
            <p className="mb-3 text-sm text-zinc-600">
              {t('maintenanceTasks.maintenance.cycleEmpty')}
            </p>
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
                    placeholder={t('maintenanceTasks.maintenance.valuePlaceholder')}
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
                    placeholder={t('maintenanceTasks.maintenance.valuePlaceholder')}
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
                    aria-label={t('maintenanceTasks.maintenance.unitAria')}
                  >
                    <option value="mileage">{t('maintenanceTasks.maintenance.unitKm')}</option>
                    <option value="time">{t('maintenanceTasks.maintenance.unitHour')}</option>
                  </select>
                  <span>{t('maintenanceTasks.maintenance.triggerMid')}</span>
                  <input
                    type="text"
                    value={row.eventContent}
                    onChange={(e) =>
                      updateCondition(row.id, { eventContent: e.target.value })
                    }
                    placeholder={t('maintenanceTasks.maintenance.eventPlaceholder')}
                    className={EVENT_INPUT_CLASS}
                  />
                  <span>{t('maintenanceTasks.maintenance.estimateMid')}</span>
                  <input
                    type="text"
                    inputMode="numeric"
                    value={row.durationMinutes}
                    onChange={(e) =>
                      updateCondition(row.id, {
                        durationMinutes: sanitizeIntegerInput(e.target.value),
                      })
                    }
                    placeholder={t('maintenanceTasks.maintenance.durationPlaceholder')}
                    className={SMALL_INPUT_CLASS}
                  />
                  <span>{t('maintenanceTasks.maintenance.minutes')}</span>
                  <button
                    type="button"
                    onClick={() => removeCondition(row.id)}
                    className="inline-flex size-8 shrink-0 items-center justify-center rounded-lg text-zinc-500 transition hover:bg-zinc-800 hover:text-zinc-300"
                    aria-label={t('maintenanceTasks.maintenance.removeConditionAria')}
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
            aria-label={t('maintenanceTasks.maintenance.addConditionAria')}
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
              ? t('maintenanceTasks.equipmentHint', {
                  count: equipment.length,
                  codes: equipment.map((e) => e.mapCode).join('、'),
                })
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
