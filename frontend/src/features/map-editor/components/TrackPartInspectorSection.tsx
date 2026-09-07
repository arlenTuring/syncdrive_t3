import { useTranslation } from 'react-i18next'
import type { FacilityObject } from '../types/facility'
import {
  facilityParts,
  getTrackGenPartColors,
  getTrackGenPartNames,
  patchTrackGenPartName,
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

  return (
    <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
      <div className="text-[10px] font-medium text-zinc-200">
        {t('mapEditor.inspector.trackParts.title')}
      </div>
      {parts.map((part) => (
        <div key={part} className="flex items-end gap-2">
          <span
            className="mb-1.5 inline-block size-3 shrink-0 rounded-[2px] border border-zinc-600"
            style={{ background: colors[part] ?? 'transparent' }}
            aria-hidden
          />
          <label
            htmlFor={`tp-${facility.id}-${part}`}
            className="min-w-0 flex-1 text-[10px] text-zinc-400"
          >
            {t(`mapEditor.inspector.trackParts.${part}`)}
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
              className="mt-0.5 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none placeholder:text-zinc-700 focus:border-sky-500"
            />
          </label>
        </div>
      ))}
      <p className="text-[9px] leading-relaxed text-zinc-500">
        {t('mapEditor.inspector.trackParts.hint')}
      </p>
    </div>
  )
}
