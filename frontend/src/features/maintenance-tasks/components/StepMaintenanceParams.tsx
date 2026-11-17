import { SiteSelect } from '../../../components/SiteSelect';
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
import { IconButton } from '../../../components/ui';

const SMALL_INPUT_CLASS =
  'h-9 w-[88px] rounded-lg border border-border-quaternary bg-surface-primary px-2 text-body-s text-text-primary placeholder:text-text-quaternary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';

const UNIT_SELECT_CLASS =
  'h-9 rounded-lg border border-border-quaternary bg-surface-primary px-2 text-body-s text-text-primary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';

const EVENT_INPUT_CLASS =
  'h-9 min-w-[140px] flex-1 rounded-lg border border-border-quaternary bg-surface-primary px-3 text-body-s text-text-primary placeholder:text-text-quaternary focus:border-border-theme focus:outline-none focus:ring-1 focus:ring-border-theme-light-trn';

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
        <div className="rounded-xl border border-border-quaternary bg-black-30 p-5">
          <div className="mb-4">
            <span className="text-body-s-bold text-text-primary">
              {t('maintenanceTasks.maintenance.cycleTitle')}
            </span>
          </div>

          {maintenance.cycleConditions.length === 0 ? (
            <p className="mb-3 text-body-s text-text-disabled">
              {t('maintenanceTasks.maintenance.cycleEmpty')}
            </p>
          ) : (
            <div className="space-y-3">
              {maintenance.cycleConditions.map((row, index) => (
                <div
                  key={row.id}
                  className="flex flex-wrap items-center gap-2 text-body-s text-text-secondary"
                >
                  <span className="w-6 shrink-0 text-text-quaternary">{index + 1}.</span>
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
                  <SiteSelect
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
                  </SiteSelect>
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
                  <IconButton size="small" hierarchy="subordinate" variant="standard" className="shrink-0" onPress={() => removeCondition(row.id)} label={t('maintenanceTasks.maintenance.removeConditionAria')} icon={<X />} />
                </div>
              ))}
            </div>
          )}

          <IconButton size="small" hierarchy="subordinate" variant="standard" className="mt-4" onPress={addCondition} label={t('maintenanceTasks.maintenance.addConditionAria')} icon={<Plus />} />
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
