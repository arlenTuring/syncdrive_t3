import { useTranslation } from 'react-i18next'
import { NumberInput } from '../../../components/NumberInput'
import type { FacilityObject } from '../types/facility'
import { DEFAULT_ORDINARY_TRACK_FILL_COLOR } from '../utils/trackFacility'
import {
  CROSS_DIAG_STROKE_DOWN_KEY,
  CROSS_DIAG_STROKE_UP_KEY,
  getCrossDiagStrokeColors,
} from '../utils/crossTrackPortals'
import {
  DEFAULT_PART_FONT_PX,
  MAX_PART_FONT_PX,
  MIN_PART_FONT_PX,
  facilityParts,
  getTrackGenPartColors,
  getTrackGenPartFontPx,
  getTrackGenPartLabelHidden,
  getTrackGenPartNames,
  getTrackGenPartStyle,
  patchTrackGenPartColor,
  patchTrackGenPartFont,
  patchTrackGenPartLabelHidden,
  patchTrackGenPartName,
  partLabelCanHide,
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
 * 圖上是一個元件，現場卻是好幾條：交叉是上、下兩條直行加兩條斜行，分岔是主線繼續走的
 * 那條與岔出去的那條。名字只是標籤，「上／下」是圖面位置，不代表現場有上行下行之分。
 * 生成時可以在預覽上分開選、分開命名（交叉先分上、下兩條）；這裡是事後要改的地方，
 * 名字放在同一個框裡，一眼看得出它們是同一個路口的幾條。斜行的名稱可以關閉不標。
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
  const hidden = getTrackGenPartLabelHidden(facility)
  const diagColors = getCrossDiagStrokeColors(facility)
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
        /* 斜行兩條沒有色塊：色票就是斜線的虛線顏色，跟「途經點與方向」裡那兩個是同一個設定 */
        const isDiag = part === 'diagUp' || part === 'diagDown'
        const dashed = style === 'dashed' || isDiag
        const swatchValue = isDiag
          ? part === 'diagUp'
            ? diagColors.up
            : diagColors.down
          : (colors[part] ?? fallbackFill)
        const swatchPatch = (value: string): Record<string, unknown> =>
          isDiag
            ? {
                [part === 'diagUp' ? CROSS_DIAG_STROKE_UP_KEY : CROSS_DIAG_STROKE_DOWN_KEY]:
                  value,
              }
            : patchTrackGenPartColor(facility, part, value)
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
                value={swatchValue}
                onChange={(e) => onPatchParameters(swatchPatch(e.target.value))}
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
            {partLabelCanHide(part) ? (
              <label className="flex items-center gap-1.5 text-[10px] text-zinc-400">
                <input
                  type="checkbox"
                  disabled={readOnly}
                  checked={!hidden[part]}
                  onChange={(e) =>
                    onPatchParameters(patchTrackGenPartLabelHidden(facility, part, !e.target.checked))
                  }
                  className="size-3 accent-sky-500 disabled:cursor-not-allowed disabled:opacity-50"
                />
                {t('mapEditor.inspector.trackParts.showName')}
              </label>
            ) : null}
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
