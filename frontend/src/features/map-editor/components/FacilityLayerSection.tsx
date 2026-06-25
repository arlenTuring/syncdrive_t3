import type { FacilityObject } from '../types/facility'
import {
  FACILITY_PIN_TO_TOP_KEY,
  isFacilityPinToTop,
} from '../utils/facilityLayerOrder'

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
    <section className="space-y-2 rounded-lg border border-zinc-700/80 bg-zinc-950/40 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-400">
        圖層順序
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        預設依資產列表順序疊放。道路線預設繪製在設施區塊之上；若仍被遮住可啟用置頂。
      </p>
      <button
        type="button"
        disabled={readOnly}
        onClick={() =>
          onPatchParameters({
            [FACILITY_PIN_TO_TOP_KEY]: pinned ? undefined : true,
          })
        }
        className="w-full rounded-md border border-zinc-600 bg-zinc-900 px-2 py-1.5 text-[11px] text-zinc-100 transition hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {pinned ? '取消置頂' : '置頂顯示（重疊時在最上層）'}
      </button>
    </section>
  )
}
