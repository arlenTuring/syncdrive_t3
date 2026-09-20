import type { FacilityObject } from '../types/facility'
import {
  DEFAULT_ORDINARY_TRACK_FILL_COLOR,
  getTrackFillOpacity,
  parseTrackColorRules,
  TRACK_FILL_OPACITY_KEY,
} from '../utils/trackFacility'
import { FillColorRulesSection } from './FillColorRulesSection'
import { FrameInspectorSection } from './FrameInspectorSection'
import { TrackCornerRadiusSection } from './TrackCornerRadiusSection'

type Props = {
  facility: FacilityObject
  sizeMeters: { w: number; h: number }
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function TrackInspectorSection({
  facility,
  sizeMeters,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Track') return null
  const params = facility.parameters ?? {}
  const rules = parseTrackColorRules(params.colorRules)
  const defaultFill =
    typeof params.defaultFillColor === 'string'
      ? params.defaultFillColor
      : DEFAULT_ORDINARY_TRACK_FILL_COLOR

  return (
    <>
      <TrackCornerRadiusSection
        facility={facility}
        sizeMeters={sizeMeters}
        readOnly={readOnly}
        onPatchParameters={onPatchParameters}
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />

      <FillColorRulesSection
        title="軌道填色規則"
        entityId={facility.id}
        readOnly={readOnly}
        defaultFill={defaultFill}
        rules={rules}
        onDefaultFillChange={(color) => onPatchParameters({ defaultFillColor: color })}
        onRulesChange={(next) =>
          onPatchParameters({
            colorRules: next.length > 0 ? next : undefined,
          })
        }
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />

      <section className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-900/60 p-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
          軌道透明度
        </h3>
        <label className="flex items-center gap-2 text-[11px] text-zinc-300">
          <span className="w-16 shrink-0">填色</span>
          <input
            type="range"
            min={0}
            max={100}
            step={5}
            disabled={readOnly}
            value={Math.round(getTrackFillOpacity(facility) * 100)}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            onChange={(e) => {
              const pct = Number(e.target.value)
              // 100（不透明）就把設定拿掉，不在每塊軌道上留一個預設值
              onPatchParameters({ [TRACK_FILL_OPACITY_KEY]: pct >= 100 ? undefined : pct / 100 })
            }}
            className="min-w-0 flex-1 accent-sky-500 disabled:opacity-50"
            aria-label="軌道填色不透明度"
          />
          <span className="w-10 shrink-0 text-right font-mono text-zinc-400">
            {Math.round(getTrackFillOpacity(facility) * 100)}%
          </span>
        </label>
        <p className="text-[10px] leading-relaxed text-zinc-500">
          0% 為完全透明，只留框線與名稱；用來讓兩塊軌道重疊時底下那塊仍看得到（例如疊在一起的
          斜接軌道），不影響車輛定位與現場座標。
        </p>
      </section>

      <FrameInspectorSection
        facility={facility}
        readOnly={readOnly}
        onPatchParameters={onPatchParameters}
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />
    </>
  )
}
