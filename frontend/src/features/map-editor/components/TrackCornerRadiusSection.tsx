import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import {
  getTrackCornerRadiiForFacility,
  patchTrackCornerRadii,
  roundedRectTrackCornerRadii,
  uniformTrackCornerRadii,
  type TrackCornerKey,
} from '../utils/trackCornerRadius'

type Props = {
  facility: FacilityObject
  sizeMeters: { w: number; h: number }
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

const CORNER_LABELS: { key: TrackCornerKey; label: string }[] = [
  { key: 'tl', label: '左上 (m)' },
  { key: 'tr', label: '右上 (m)' },
  { key: 'br', label: '右下 (m)' },
  { key: 'bl', label: '左下 (m)' },
]

export function TrackCornerRadiusSection({
  facility,
  sizeMeters,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Track') return null

  const corners = getTrackCornerRadiiForFacility(facility, sizeMeters)
  const maxR = Math.max(0, Math.min(sizeMeters.w, sizeMeters.h))
  const uniform =
    corners.tl === corners.tr &&
    corners.tr === corners.br &&
    corners.br === corners.bl
      ? corners.tl
      : null

  const applyCorners = (next: ReturnType<typeof getTrackCornerRadiiForFacility>) => {
    onPatchParameters(
      patchTrackCornerRadii(facility.parameters, next, sizeMeters),
    )
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-violet-900/40 bg-violet-950/15 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-violet-400/90">
        圓角（公尺）
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        編輯模式下選取軌道後，可拖曳上／下邊的紫色圓點調整各角圓角；亦可在此輸入數值或一鍵設為圓角矩形。
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => applyCorners(roundedRectTrackCornerRadii(sizeMeters))}
          className="rounded-md border border-violet-600/60 bg-violet-950/50 px-2.5 py-1 text-[10px] text-violet-100 hover:bg-violet-900/40 disabled:opacity-50"
        >
          設為圓角矩形
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() =>
            applyCorners({ tl: 0, tr: 0, br: 0, bl: 0 })
          }
          className="rounded-md border border-zinc-600 bg-zinc-900/80 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          清除圓角
        </button>
      </div>

      <label className="block text-[10px] text-zinc-500">
        四角統一圓角 (m)
        <input
          type="number"
          min={0}
          max={maxR}
          step={0.1}
          disabled={readOnly}
          value={uniform ?? ''}
          placeholder={uniform === null ? '四角不同' : '0'}
          onChange={(e) => {
            const v = e.target.value.trim()
            if (v === '') return
            const n = Number.parseFloat(v)
            if (!Number.isFinite(n)) return
            applyCorners(uniformTrackCornerRadii(n, sizeMeters))
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-violet-500 read-only:opacity-90"
        />
      </label>
      <p className="text-[9px] text-zinc-600">
        單角上限：{maxR.toFixed(2)} m（min(寬, 高)）
      </p>

      <div className="grid grid-cols-2 gap-2">
        {CORNER_LABELS.map(({ key, label }) => (
          <label key={key} className="block text-[10px] text-zinc-500">
            {label}
            <NumberInput
              min={0}
              max={maxR}
              step={0.1}
              disabled={readOnly}
              value={corners[key]}
              onChange={(n) => applyCorners({ ...corners, [key]: n })}
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-violet-500 read-only:opacity-90"
            />
          </label>
        ))}
      </div>
    </section>
  )
}
