import type { FacilityObject } from '../types/facility'
import { parseFacilityColorRules } from '../utils/facilityArea'
import { FillColorRulesSection } from './FillColorRulesSection'
import { FrameInspectorSection } from './FrameInspectorSection'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function FacilityInspectorSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Facility' || facility.name !== 'FacilityArea') return null

  const params = facility.parameters ?? {}
  const rules = parseFacilityColorRules(params.colorRules)
  const defaultFill =
    typeof params.defaultFillColor === 'string' ? params.defaultFillColor : '#334155'
  const remarks = typeof params.remarks === 'string' ? params.remarks : ''
  const iconDisplay =
    params.iconDisplay === 'builtin' || params.iconDisplay === 'custom'
      ? params.iconDisplay
      : 'none'
  const customIconUrl =
    typeof params.customIconUrl === 'string' ? params.customIconUrl : ''

  return (
    <>
      <FillColorRulesSection
        title="設施填色規則"
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

      <FrameInspectorSection
        facility={facility}
        readOnly={readOnly}
        onPatchParameters={onPatchParameters}
        onFieldFocus={onFieldFocus}
        onFieldBlur={onFieldBlur}
      />

      <section className="space-y-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/45 p-3">
        <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
          設施圖示
        </h3>
        <div>
          <label
            htmlFor="facility-icon-display"
            className="mb-1 block text-[10px] text-zinc-500"
          >
            圖示顯示
          </label>
          <select
            id="facility-icon-display"
            disabled={readOnly}
            value={iconDisplay}
            onChange={(e) => {
              const v = e.target.value
              onPatchParameters({
                iconDisplay: v === 'none' ? undefined : v,
                ...(v !== 'custom' ? { customIconUrl: undefined } : {}),
              })
            }}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-60"
          >
            <option value="none">不顯示</option>
            <option value="builtin">內建圖示</option>
            <option value="custom">自訂圖片 URL</option>
          </select>
        </div>
        {iconDisplay === 'custom' && (
          <div>
            <label
              htmlFor="facility-custom-icon-url"
              className="mb-1 block text-[10px] text-zinc-500"
            >
              圖片 URL
            </label>
            <input
              id="facility-custom-icon-url"
              readOnly={readOnly}
              value={customIconUrl}
              onChange={(e) =>
                onPatchParameters({
                  customIconUrl: e.target.value.trim() || undefined,
                })
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              placeholder="https://… 或 /assets/…"
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
            />
          </div>
        )}
        <div>
          <label
            htmlFor="facility-remarks"
            className="mb-1 block text-[10px] text-zinc-500"
          >
            備註（滑鼠懸停顯示，選填）
          </label>
          <textarea
            id="facility-remarks"
            rows={2}
            readOnly={readOnly}
            value={remarks}
            onChange={(e) =>
              onPatchParameters({ remarks: e.target.value || undefined })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="w-full resize-y rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] leading-relaxed text-zinc-100 outline-none focus:border-cyan-500 read-only:opacity-80"
          />
        </div>
      </section>
    </>
  )
}
