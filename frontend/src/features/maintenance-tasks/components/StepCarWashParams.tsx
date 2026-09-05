import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchYardFacilityEquipment,
  type FieldEquipmentItem,
} from '../api/fieldEquipmentApi';
import {
  newCarWashEquipmentRowId,
  normalizeCarWashDraft,
  type CarWashEquipmentRow,
  type MaintenanceTaskCarWashDraft,
} from '../types/create';
import { sanitizeIntegerInput } from '../utils/numericInput';
import { FacilityEquipmentRowsEditor } from './FacilityEquipmentRowsEditor';
import { StepSectionToggle } from './StepSectionToggle';
import { TriggerFieldRow } from './TriggerFieldRow';

const INLINE_INPUT_ENABLED =
  'h-[42px] w-[90%] min-w-[180px] flex-1 max-w-[900px] rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type StepCarWashParamsProps = {
  draft: MaintenanceTaskCarWashDraft;
  onChange: (next: MaintenanceTaskCarWashDraft) => void;
};

export function StepCarWashParams({ draft, onChange }: StepCarWashParamsProps) {
  const { t } = useTranslation();
  const carWash = normalizeCarWashDraft(draft);
  const patchCarWash = (patch: Partial<MaintenanceTaskCarWashDraft>) =>
    onChange(normalizeCarWashDraft({ ...carWash, ...patch }));

  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEquipment(true);
    setEquipmentError(null);
    void fetchYardFacilityEquipment(undefined, '洗車格')
      .then((res) => {
        if (cancelled) return;
        setEquipment(res.items);
      })
      .catch((e) => {
        if (cancelled) return;
        setEquipmentError(e instanceof Error ? e.message : String(e));
      })
      .finally(() => {
        if (!cancelled) setLoadingEquipment(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <StepSectionToggle
      title={t('maintenanceTasks.carWash.title')}
      enabled={carWash.stepEnabled}
      onEnabledChange={(stepEnabled) => patchCarWash({ stepEnabled })}
    >
      <div className="space-y-5">
        <TriggerFieldRow
          label={t('maintenanceTasks.carWash.mileageLabel')}
          enabled={carWash.mileageDetectionEnabled}
          value={carWash.mileageTriggerKm}
          onEnabledChange={(mileageDetectionEnabled) =>
            patchCarWash({ mileageDetectionEnabled })
          }
          onValueChange={(mileageTriggerKm) => patchCarWash({ mileageTriggerKm })}
          prefixText={t('maintenanceTasks.carWash.mileagePrefix')}
          suffixText={t('maintenanceTasks.carWash.mileageSuffix')}
          sanitizeValue={sanitizeIntegerInput}
        />

        <TriggerFieldRow
          label={t('maintenanceTasks.carWash.timeLabel')}
          enabled={carWash.timeDetectionEnabled}
          value={carWash.timeTriggerHours}
          onEnabledChange={(timeDetectionEnabled) => patchCarWash({ timeDetectionEnabled })}
          onValueChange={(timeTriggerHours) => patchCarWash({ timeTriggerHours })}
          prefixText={t('maintenanceTasks.carWash.timePrefix')}
          suffixText={t('maintenanceTasks.carWash.timeSuffix')}
          sanitizeValue={sanitizeIntegerInput}
        />

        <div className="block">
          <span className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
            <span className="text-red-500">*</span>
            {t('maintenanceTasks.carWash.durationLabel')}
          </span>
          <div className="flex w-full flex-wrap items-center gap-2 text-sm text-zinc-300">
            <span>{t('maintenanceTasks.carWash.durationPrefix')}</span>
            <input
              type="text"
              inputMode="numeric"
              value={carWash.operationDurationMinutes}
              onChange={(e) =>
                patchCarWash({
                  operationDurationMinutes: sanitizeIntegerInput(e.target.value),
                })
              }
              placeholder={t('maintenanceTasks.triggerField.placeholder')}
              className={INLINE_INPUT_ENABLED}
            />
            <span>{t('maintenanceTasks.carWash.durationSuffix')}</span>
          </div>
        </div>

        <FacilityEquipmentRowsEditor<CarWashEquipmentRow>
          rows={carWash.equipmentRows}
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
            id: newCarWashEquipmentRowId(),
            mapCode: '',
            waypointCode: '',
          })}
          onChange={(equipmentRows) => patchCarWash({ equipmentRows })}
        />
      </div>
    </StepSectionToggle>
  );
}
