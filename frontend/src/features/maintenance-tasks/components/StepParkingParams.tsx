import { useEffect, useState } from 'react';
import {
  fetchYardFacilityEquipment,
} from '../api/fieldEquipmentApi';
import type { FieldEquipmentItem } from '../api/fieldEquipmentApi';
import {
  newStationDurationEquipmentRowId,
  type MaintenanceFacilityEquipmentRow,
  type MaintenanceTaskParkingDraft,
} from '../types/create';
import { FacilityEquipmentRowsEditor } from './FacilityEquipmentRowsEditor';
import { StepSectionToggle } from './StepSectionToggle';

type StepParkingParamsProps = {
  draft: MaintenanceTaskParkingDraft;
  onChange: (next: MaintenanceTaskParkingDraft) => void;
};

/**
 * 調度任務：只載入調度設施，沒有觸發條件也沒有作業時長。
 *
 * 用途是「車暫時不能跑正線，先找個地方停一下」——由調度入廠卡（PI）開進來、
 * 調度出廠卡（PO）開回首站。停多久由排班決定（看什麼時候有班次可接），
 * 不是這裡設一個固定值。
 */
export function StepParkingParams({ draft, onChange }: StepParkingParamsProps) {
  const [equipment, setEquipment] = useState<FieldEquipmentItem[]>([]);
  const [loadingEquipment, setLoadingEquipment] = useState(true);
  const [equipmentError, setEquipmentError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    // loadingEquipment 初值就是 true、error 初值就是 null，
    // 不必在 effect 開頭再 set 一次（那會觸發多餘的 render）
    void fetchYardFacilityEquipment(undefined, '調度格')
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
      title="填入調度任務"
      enabled={draft.stepEnabled}
      onEnabledChange={(stepEnabled: boolean) =>
        onChange({ ...draft, stepEnabled })
      }
    >
      <p className="mb-3 text-xs leading-5 text-zinc-400">
        車輛暫時不能跑正線時，會先開進這裡挑一格停著（調度入廠卡 PI），
        等有班次可接再開回首發站（調度出廠卡 PO）。
        停多久由排班決定，所以這一步只要指定可用的設施格。
      </p>
      <FacilityEquipmentRowsEditor<MaintenanceFacilityEquipmentRow>
        rows={draft.equipmentRows}
        equipment={equipment}
        loadingEquipment={loadingEquipment}
        equipmentError={equipmentError}
        equipmentHint={
          equipment.length > 0
            ? `場域共 ${equipment.length} 座設施格可掛載（${equipment
                .map((e) => e.mapCode)
                .join('、')}）；掛哪一座由整備任務決定，不受地圖用途限制`
            : undefined
        }
        newRow={() => ({
          id: newStationDurationEquipmentRowId(),
          mapCode: '',
          waypointCode: '',
        })}
        onChange={(equipmentRows) => onChange({ ...draft, equipmentRows })}
      />
    </StepSectionToggle>
  );
}
