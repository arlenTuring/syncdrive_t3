import type { MapAreaObject } from '../types/area'
import type { MapBasemapObject } from '../types/basemap'
import type { FacilityObject } from '../types/facility'
import {
  areaSupportsAutoFieldCoords,
  shouldAutoSeedRefFieldPoint,
} from '../utils/facilityRefFieldAuto'
import {
  getRefFieldPosition,
  hasValidRefFieldPosition,
  patchRefFieldPosition,
  type RefFieldPositionMeters,
} from '../utils/facilityRefFieldPosition'

type Props = {
  facility: FacilityObject
  /** 所屬 Area；用於判定是否為高精容器（自動場域座標） */
  area?: MapAreaObject | null
  basemaps?: readonly MapBasemapObject[]
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

function commit(
  key: keyof RefFieldPositionMeters,
  value: number | null,
  parameters: Record<string, unknown> | undefined,
  onPatchParameters: Props['onPatchParameters'],
) {
  onPatchParameters(patchRefFieldPosition(parameters, { [key]: value }))
}

function formatInputValue(v: number | null): string {
  return v === null ? '' : String(v)
}

export function FacilityRefFieldPositionSection({
  facility,
  area = null,
  basemaps,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const position = getRefFieldPosition(facility.parameters)
  const params = facility.parameters
  const hasPosition = hasValidRefFieldPosition(facility.parameters)
  const autoMapped =
    shouldAutoSeedRefFieldPoint(facility.type) &&
    !!area &&
    areaSupportsAutoFieldCoords(area, basemaps)

  const fields: {
    key: keyof RefFieldPositionMeters
    label: string
    id: string
  }[] = [
    { key: 'xM', label: '場域橫向座標 (m)', id: 'facility-ref-pos-x' },
    { key: 'yM', label: '場域縱向座標 (m)', id: 'facility-ref-pos-y' },
  ]

  return (
    <section className="space-y-2.5 rounded-lg border border-sky-900/40 bg-sky-950/15 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
        場域座標（公尺）
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        {readOnly
          ? '此元件在實際場域中的代表點（唯讀）。座標為場域公尺（原點左下，橫向／縱向）。'
          : autoMapped
            ? '此元件在實際場域中的代表點。放置、載入與圖台拖曳／微調時會依高精軌道映射自動更新；亦可在此手動修改。調整像素尺寸不會改變此位置。座標為場域公尺（原點左下，橫向／縱向）。'
            : '此元件在實際場域中的代表點；僅能在此手動設定。圖台拖曳或調整像素尺寸不會改變此位置。座標為場域公尺（原點左下，橫向／縱向）。'}
      </p>
      {hasPosition ? (
        <p className="rounded-md border border-sky-900/30 bg-sky-950/25 px-2 py-1.5 font-mono text-[11px] text-sky-100/90">
          代表點：({position.xM!.toFixed(2)}, {position.yM!.toFixed(2)}) m
        </p>
      ) : (
        <p className="text-[10px] text-amber-500/90">
          {autoMapped
            ? '尚未設定場域座標（目前無法由圖台映射帶入）。'
            : '尚未設定場域座標。'}
        </p>
      )}
      <div className="grid grid-cols-1 gap-2">
        {fields.map(({ key, label, id }) => (
          <label key={key} htmlFor={id} className="block text-[10px] text-zinc-500">
            {label}
            <input
              id={id}
              type="number"
              step={0.1}
              readOnly={readOnly}
              value={formatInputValue(position[key])}
              onChange={(e) => {
                const raw = e.target.value.trim()
                if (raw === '') {
                  commit(key, null, params, onPatchParameters)
                  return
                }
                const n = Number.parseFloat(raw)
                if (!Number.isFinite(n)) return
                commit(key, n, params, onPatchParameters)
              }}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              placeholder="—"
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 read-only:opacity-90"
            />
          </label>
        ))}
      </div>
    </section>
  )
}
