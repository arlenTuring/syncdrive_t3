import type { FacilityObject } from '../types/facility'
import {
  FACILITY_PIN_TO_TOP_KEY,
  isFacilityPinToTop,
} from '../utils/facilityLayerOrder'
import { Button } from '../../../components/ui';

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
}

export function FacilityLayerSection({
  facility,
  readOnly,
  onPatchParameters,
}: Props) {
  if (facility.type === 'Slot') return null

  const pinned = isFacilityPinToTop(facility)

  return (
    <section className="space-y-2 rounded-lg border border-border-quaternary bg-black-30 p-3">
      <h3 className="text-caption-2 uppercase text-text-tertiary">
        圖層順序
      </h3>
      <p className="text-caption-2 text-text-quaternary">
        預設依資產列表順序疊放。道路線預設繪製在設施區塊之上；若仍被遮住可啟用置頂。
      </p>
      <Button hierarchy="subordinate" variant="outlined" className="w-full" disabled={readOnly} onPress={() =>
          onPatchParameters({
            [FACILITY_PIN_TO_TOP_KEY]: pinned ? undefined : true,
          })
        }>{pinned ? '取消置頂' : '置頂顯示（重疊時在最上層）'}</Button>
    </section>
  )
}
