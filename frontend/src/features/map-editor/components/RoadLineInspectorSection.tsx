import { SiteColorInput } from '../../../components/SiteColorInput';
import { SiteSelect } from '../../../components/SiteSelect';
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
    <section className="space-y-2.5 rounded-lg border border-border-theme-light bg-surface-theme p-3">
      <h3 className="text-caption-2 uppercase text-text-theme">
        {t('mapEditor.inspector.roadLine.title')}
      </h3>
      <p className="text-caption-2 text-text-quaternary">
        {t('mapEditor.inspector.roadLine.hint')}
      </p>
      <div>
        <label
          htmlFor="road-line-style"
          className="mb-1 block text-caption-2 text-text-quaternary"
        >
          {t('mapEditor.inspector.roadLine.style')}
        </label>
        <SiteSelect
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
          size="sm" className="w-full"
        >
          {ROAD_LINE_STYLES.map((opt) => (
            <option key={opt.value} value={opt.value}>
              {t(`mapEditor.inspector.roadLine.styles.${opt.value}`)}
            </option>
          ))}
        </SiteSelect>
      </div>
      <div>
        <label
          htmlFor="road-line-width"
          className="mb-1 block text-caption-2 text-text-quaternary"
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
          className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
        />
      </div>
      <div>
        <label
          htmlFor="road-line-color"
          className="mb-1 block text-caption-2 text-text-quaternary"
        >
          {t('mapEditor.inspector.roadLine.color')}
        </label>
        <div className="flex items-center gap-2">
          <SiteColorInput
            id="road-line-color"
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
            className="h-8 w-10 shrink-0 cursor-pointer rounded border border-border-tertiary bg-surface-sub-background disabled:opacity-60"
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
            className="min-w-0 flex-1 rounded border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-body-xs text-text-primary outline-none focus:border-border-theme read-only:opacity-80"
          />
        </div>
      </div>
      {pixelW !== null && (
        <p className="text-caption-2 text-text-disabled">
          {t('mapEditor.inspector.roadLine.lengthHint', {
            px: pixelW.toFixed(1),
          })}
        </p>
      )}
    </section>
  )
}
