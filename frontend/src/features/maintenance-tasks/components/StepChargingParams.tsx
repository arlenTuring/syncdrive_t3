import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  fetchYardFacilityEquipment,
  type FieldEquipmentItem,
} from '../api/fieldEquipmentApi';
import {
  newChargingEquipmentRowId,
  normalizeChargingDraft,
  type ChargingEquipmentRow,
  type MaintenanceTaskChargingDraft,
} from '../types/create';
import { sanitizeIntegerInput } from '../utils/numericInput';
import { FacilityEquipmentRowsEditor } from './FacilityEquipmentRowsEditor';
import { StepSectionToggle } from './StepSectionToggle';
import { TriggerFieldRow } from './TriggerFieldRow';

const RATE_INPUT_CLASS =
  'h-[42px] w-[88px] rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

type StepChargingParamsProps = {
  draft: MaintenanceTaskChargingDraft;
  onChange: (next: MaintenanceTaskChargingDraft) => void;
};

export function StepChargingParams({ draft, onChange }: StepChargingParamsProps) {
  const { t } = useTranslation();
  const charging = normalizeChargingDraft(draft);
  const patchCharging = (patch: Partial<MaintenanceTaskChargingDraft>) =>
    onChange(normalizeChargingDraft({ ...charging, ...patch }));

  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoadingEquipment(true);
    setEquipmentError(null);
    void fetchYardFacilityEquipment(undefined, '充電格')
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
      title={t('maintenanceTasks.charging.title')}
      enabled={charging.stepEnabled}
      onEnabledChange={(stepEnabled) => patchCharging({ stepEnabled })}
    >
      <div className="space-y-5">
        <TriggerFieldRow
          label={t('maintenanceTasks.charging.triggerLabel')}
          showToggle={false}
          required
          enabled
          value={charging.triggerPercent}
          onEnabledChange={() => {}}
          onValueChange={(triggerPercent) =>
            patchCharging({ triggerPercent, triggerDetectionEnabled: true })
          }
          prefixText={t('maintenanceTasks.charging.triggerPrefix')}
          suffixText={t('maintenanceTasks.charging.triggerSuffix')}
          sanitizeValue={(raw) => sanitizeIntegerInput(raw, 99)}
        />

        <TriggerFieldRow
          label={t('maintenanceTasks.charging.upperLabel')}
          enabled={charging.upperLimitDetectionEnabled}
          value={charging.upperLimitPercent}
          onEnabledChange={(upperLimitDetectionEnabled) =>
            patchCharging({ upperLimitDetectionEnabled })
          }
          onValueChange={(upperLimitPercent) => patchCharging({ upperLimitPercent })}
          prefixText={t('maintenanceTasks.charging.upperPrefix')}
          suffixText={t('maintenanceTasks.charging.upperSuffix')}
          sanitizeValue={(raw) => sanitizeIntegerInput(raw, 100)}
        />

        <FacilityEquipmentRowsEditor<ChargingEquipmentRow>
          rows={charging.equipmentRows}
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
            id: newChargingEquipmentRowId(),
            mapCode: '',
            chargeRateKwhPerMin: '',
            waypointCode: '',
          })}
          onChange={(equipmentRows) => patchCharging({ equipmentRows })}
          renderExtraFields={(row, updateRow) => (
            <div className="flex shrink-0 items-center gap-2 text-sm text-zinc-400">
              <span className="whitespace-nowrap">{t('maintenanceTasks.charging.chargeRate')}</span>
              <input
                type="text"
                inputMode="numeric"
                value={row.chargeRateKwhPerMin}
                onChange={(e) =>
                  updateRow({
                    chargeRateKwhPerMin: sanitizeIntegerInput(e.target.value),
                  })
                }
                placeholder={t('maintenanceTasks.triggerField.placeholder')}
                className={RATE_INPUT_CLASS}
              />
              <span className="whitespace-nowrap text-zinc-500">
                {t('maintenanceTasks.charging.chargeRateUnit')}
              </span>
            </div>
          )}
        />
      </div>
    </StepSectionToggle>
  );
}
