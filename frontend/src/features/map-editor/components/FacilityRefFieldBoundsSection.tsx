import type { FacilityObject } from '../types/facility'
import {
  describeRefFieldBoundsIssue,
  getRefFieldBounds,
  hasValidRefFieldBounds,
  isZeroRefFieldBoundsSpan,
  normalizeRefFieldBoundsParameters,
  patchRefFieldBounds,
  refFieldBoundsSpanMeters,
  type RefFieldBoundsMeters,
} from '../utils/facilityRefFieldBounds'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

function commit(
  key: keyof RefFieldBoundsMeters,
  value: number | null,
  parameters: Record<string, unknown> | undefined,
  onPatchParameters: Props['onPatchParameters'],
) {
  onPatchParameters(patchRefFieldBounds(parameters, { [key]: value }))
}

export function FacilityRefFieldBoundsSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const bounds = getRefFieldBounds(facility.parameters)
  const params = facility.parameters
  const span = refFieldBoundsSpanMeters(bounds)
  const hasBounds = hasValidRefFieldBounds(facility.parameters)
  const isZero = isZeroRefFieldBoundsSpan(facility.parameters)
  const boundsIssue = describeRefFieldBoundsIssue(facility.parameters)

  const handleBlur = () => {
    const normalized = normalizeRefFieldBoundsParameters(params)
    if (normalized) onPatchParameters(normalized)
    onFieldBlur()
  }

  const fields: {
    key: keyof RefFieldBoundsMeters
    label: string
    id: string
  }[] = [
    { key: 'xMinM', label: '參照場域橫向範圍最小值 (m)', id: 'facility-ref-x-min' },
    { key: 'xMaxM', label: '參照場域橫向範圍最大值 (m)', id: 'facility-ref-x-max' },
    { key: 'yMinM', label: '參照場域縱向範圍最小值 (m)', id: 'facility-ref-y-min' },
    { key: 'yMaxM', label: '參照場域縱向範圍最大值 (m)', id: 'facility-ref-y-max' },
  ]

  return (
    <section className="space-y-2.5 rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
        參照場域範圍（公尺）
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        {readOnly
          ? '此元件在實際場域中的代表範圍（唯讀）。座標為場域公尺（原點左下，橫向／縱向）。'
          : '此元件在實際場域中的代表範圍；僅能在此手動設定，數值即為對外語意。圖台拖曳、調整像素尺寸或拉伸 Area 外框均不會改變此範圍。座標為場域公尺（原點左下，橫向／縱向）。'}
      </p>
      {span ? (
        <p className="rounded-md border border-emerald-900/30 bg-emerald-950/25 px-2 py-1.5 font-mono text-[11px] text-emerald-100/90">
          代表範圍：橫向 {span.w.toFixed(2)} m × 縱向 {span.h.toFixed(2)} m
        </p>
      ) : null}
      {isZero ? (
        <p className="text-[10px] text-zinc-400">
          已設為 0（不參與斷路掃描與車輛定位）。
        </p>
      ) : null}
      {!hasBounds && !isZero && boundsIssue ? (
        <p className="text-[10px] text-amber-500/90">{boundsIssue}</p>
      ) : null}
      <div className="grid grid-cols-2 gap-2">
        {fields.map(({ key, label, id }) => (
          <label key={key} htmlFor={id} className="block text-[10px] text-zinc-500">
            {label}
            <input
              id={id}
              type="number"
              step={0.1}
              readOnly={readOnly}
              value={bounds[key] === null ? '' : String(bounds[key])}
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
              onBlur={handleBlur}
              placeholder="—"
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500 read-only:opacity-90"
            />
          </label>
        ))}
      </div>
    </section>
  )
}
