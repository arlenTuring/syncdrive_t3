import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import { DEFAULT_ORDINARY_TRACK_FILL_COLOR } from '../utils/trackFacility'
import {
  DEFAULT_PART_FONT_PX,
  MAX_PART_FONT_PX,
  MIN_PART_FONT_PX,
  facilityParts,
  getTrackGenPartColors,
  getTrackGenPartFontPx,
  getTrackGenPartNames,
  getTrackGenPartStyle,
  patchTrackGenPartColor,
  patchTrackGenPartFont,
  patchTrackGenPartName,
  patchTrackGenPartStyle,
  type TrackGenPartStyle,
} from '../utils/trackGenParts'

type Props = {
  facility: FacilityObject
  readOnly?: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus?: () => void
  onFieldBlur?: () => void
}

/**
 * 交叉與分岔的<strong>兩條軌道</strong>各自命名。
 *
 * 圖上是一個元件，現場卻是兩條：交叉是上行與下行，分岔是主線繼續走的那條與岔出去
 * 的那條。生成時可以在預覽上分開選、分開命名；這裡是事後要改的地方，兩個名字放在
 * 同一個框裡，一眼看得出它們是同一個路口的兩條。
 *
 * 分岔另可把主線或岔線改成「虛線軌道」：外形與色塊相同，以虛線描邊、不填色。
 */
export function TrackPartInspectorSection({
  facility,
  readOnly = false,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const parts = facilityParts(facility)
  if (!parts) return null
  const names = getTrackGenPartNames(facility)
  const colors = getTrackGenPartColors(facility)
  const fonts = getTrackGenPartFontPx(facility)
  const isSwitch = facility.name === 'RailSwitch'
  /* 沒設過色的那一半，色票先顯示元件本身的底色，不要顯示成透明的空格 */
  const fallbackFill =
    typeof facility.parameters?.defaultFillColor === 'string'
      ? (facility.parameters.defaultFillColor as string)
      : DEFAULT_ORDINARY_TRACK_FILL_COLOR

  return (
    <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
      <div className="text-[10px] font-medium text-zinc-200">
        {t('mapEditor.inspector.trackParts.title')}
      </div>
      {parts.map((part) => {
        const style = getTrackGenPartStyle(facility, part)
        const dashed = style === 'dashed'
        return (
          <div key={part} className="space-y-1">
            <div className="text-[10px] text-zinc-400">
              {t(`mapEditor.inspector.trackParts.${part}`)}
            </div>
            {isSwitch ? (
              <label className="flex items-center gap-1.5 text-[10px] text-zinc-500">
                <span className="shrink-0">{t('mapEditor.inspector.trackParts.style')}</span>
                <select
                  disabled={readOnly}
                  value={style}
                  onFocus={onFieldFocus}
                  onBlur={onFieldBlur}
                  onChange={(e) => {
                    const next = e.target.value as TrackGenPartStyle
                    if (next !== style) {
                      onPatchParameters(patchTrackGenPartStyle(facility, part, next))
                    }
                  }}
                  className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  <option value="fill">
                    {t('mapEditor.inspector.trackParts.styleFill')}
                  </option>
                  <option value="dashed">
                    {t('mapEditor.inspector.trackParts.styleDashed')}
                  </option>
                </select>
              </label>
            ) : null}
            <div className="flex items-center gap-1.5">
              <input
                id={`tp-${facility.id}-${part}`}
                key={`tp-${facility.id}-${part}-${names[part] ?? ''}`}
                readOnly={readOnly}
                defaultValue={names[part] ?? ''}
                onFocus={onFieldFocus}
                onBlur={(e) => {
                  onFieldBlur?.()
                  if (!readOnly && e.target.value.trim() !== (names[part] ?? '')) {
                    onPatchParameters(patchTrackGenPartName(facility, part, e.target.value))
                  }
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') e.currentTarget.blur()
                }}
                placeholder={t('mapEditor.inspector.trackParts.placeholder')}
                className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-sky-500"
              />
              <input
                type="color"
                aria-label={
                  dashed
                    ? t('mapEditor.inspector.trackParts.dashColor')
                    : t('mapEditor.inspector.trackParts.color')
                }
                title={
                  dashed
                    ? t('mapEditor.inspector.trackParts.dashColor')
                    : t('mapEditor.inspector.trackParts.color')
                }
                disabled={readOnly}
                value={colors[part] ?? fallbackFill}
                onChange={(e) =>
                  onPatchParameters(patchTrackGenPartColor(facility, part, e.target.value))
                }
                className="h-[26px] w-9 shrink-0 cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
              />
              <NumberInput
                aria-label={t('mapEditor.inspector.trackParts.fontSize')}
                title={t('mapEditor.inspector.trackParts.fontSize')}
                min={MIN_PART_FONT_PX}
                max={MAX_PART_FONT_PX}
                step={1}
                disabled={readOnly}
                value={fonts[part] ?? DEFAULT_PART_FONT_PX}
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                onChange={(n) =>
                  onPatchParameters(patchTrackGenPartFont(facility, part, n))
                }
                className="w-12 shrink-0 rounded border border-zinc-600 bg-zinc-950 px-1.5 py-1 text-center font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
              />
            </div>
          </div>
        )
      })}
      <p className="text-[9px] leading-relaxed text-zinc-500">
        {isSwitch
          ? t('mapEditor.inspector.trackParts.hintSwitch')
          : t('mapEditor.inspector.trackParts.hint')}
      </p>
    </div>
  )
}
