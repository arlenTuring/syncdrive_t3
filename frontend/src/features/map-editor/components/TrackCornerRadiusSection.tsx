import { useTranslation } from 'react-i18next'
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

const CORNER_KEYS: TrackCornerKey[] = ['tl', 'tr', 'br', 'bl']

export function TrackCornerRadiusSection({
  facility,
  sizeMeters,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
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
        {t('mapEditor.inspector.cornerRadius.title')}
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        {t('mapEditor.inspector.cornerRadius.hint')}
      </p>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          disabled={readOnly}
          onClick={() => applyCorners(roundedRectTrackCornerRadii(sizeMeters))}
          className="rounded-md border border-violet-600/60 bg-violet-950/50 px-2.5 py-1 text-[10px] text-violet-100 hover:bg-violet-900/40 disabled:opacity-50"
        >
          {t('mapEditor.inspector.cornerRadius.setRoundedRect')}
        </button>
        <button
          type="button"
          disabled={readOnly}
          onClick={() =>
            applyCorners({ tl: 0, tr: 0, br: 0, bl: 0 })
          }
          className="rounded-md border border-zinc-600 bg-zinc-900/80 px-2.5 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
        >
          {t('mapEditor.inspector.cornerRadius.clear')}
        </button>
      </div>

      <label className="block text-[10px] text-zinc-500">
        {t('mapEditor.inspector.cornerRadius.uniform')}
        <input
          type="number"
          min={0}
          max={maxR}
          step={0.1}
          disabled={readOnly}
          value={uniform ?? ''}
          placeholder={
            uniform === null
              ? t('mapEditor.inspector.cornerRadius.cornersDiffer')
              : '0'
          }
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
        {t('mapEditor.inspector.cornerRadius.maxHint', {
          max: maxR.toFixed(2),
        })}
      </p>

      <div className="grid grid-cols-2 gap-2">
        {CORNER_KEYS.map((key) => (
          <label key={key} className="block text-[10px] text-zinc-500">
            {t(`mapEditor.inspector.cornerRadius.${key}`)}
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
