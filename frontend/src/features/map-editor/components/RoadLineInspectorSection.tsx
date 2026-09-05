import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import {
  DEFAULT_ROAD_LINE_COLOR,
  DEFAULT_ROAD_LINE_STYLE,
  DEFAULT_ROAD_LINE_WIDTH_PX,
  parseRoadLineColor,
  parseRoadLineStyle,
  parseRoadLineWidthPx,
  ROAD_LINE_COLOR_KEY,
  ROAD_LINE_STYLES,
  ROAD_LINE_STYLE_KEY,
  ROAD_LINE_WIDTH_PX_KEY,
} from '../utils/roadLineFacility'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function RoadLineInspectorSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  if (facility.type !== 'RoadLine') return null

  const params = facility.parameters ?? {}
  const style = parseRoadLineStyle(params[ROAD_LINE_STYLE_KEY])
  const widthPx = parseRoadLineWidthPx(params[ROAD_LINE_WIDTH_PX_KEY])
  const color = parseRoadLineColor(params[ROAD_LINE_COLOR_KEY])

  const pixelW =
    facility.areaSizePx && Number.isFinite(facility.areaSizePx.w)
      ? facility.areaSizePx.w
      : null

  return (
    <section className="space-y-2.5 rounded-lg border border-sky-900/40 bg-sky-950/12 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
        {t('mapEditor.inspector.roadLine.title')}
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        {t('mapEditor.inspector.roadLine.hint')}
      </p>
      <div>
        <label
          htmlFor="road-line-style"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.inspector.roadLine.style')}
        </label>
        <select
          id="road-line-style"
          disabled={readOnly}
          value={style}
          onChange={(e) =>
            onPatchParameters({
              [ROAD_LINE_STYLE_KEY]:
                e.target.value === DEFAULT_ROAD_LINE_STYLE
                  ? undefined
                  : e.target.value,
            })
          }
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
        >
          {ROAD_LINE_STYLES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(`mapEditor.inspector.roadLine.styles.${opt.value}`)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label
          htmlFor="road-line-width"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.inspector.roadLine.width')}
        </label>
        <NumberInput
          id="road-line-width"
          min={1}
          max={48}
          step={0.5}
          readOnly={readOnly}
          value={widthPx}
          onChange={(v) =>
            onPatchParameters({
              [ROAD_LINE_WIDTH_PX_KEY]:
                v === DEFAULT_ROAD_LINE_WIDTH_PX ? undefined : v,
            })
          }
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 read-only:opacity-80"
        />
      </div>
      <div>
        <label
          htmlFor="road-line-color"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          {t('mapEditor.inspector.roadLine.color')}
        </label>
        <div className="flex items-center gap-2">
          <input
            id="road-line-color"
            type="color"
            disabled={readOnly}
            value={color.startsWith('#') ? color : DEFAULT_ROAD_LINE_COLOR}
            onChange={(e) =>
              onPatchParameters({
                [ROAD_LINE_COLOR_KEY]:
                  e.target.value === DEFAULT_ROAD_LINE_COLOR
                    ? undefined
                    : e.target.value,
              })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:opacity-60"
          />
          <input
            readOnly={readOnly}
            value={color}
            onChange={(e) =>
              onPatchParameters({
                [ROAD_LINE_COLOR_KEY]:
                  e.target.value.trim() || DEFAULT_ROAD_LINE_COLOR,
              })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 read-only:opacity-80"
          />
        </div>
      </div>
      {pixelW !== null && (
        <p className="text-[10px] text-zinc-600">
          {t('mapEditor.inspector.roadLine.lengthHint', {
            px: pixelW.toFixed(1),
          })}
        </p>
      )}
    </section>
  )
}
