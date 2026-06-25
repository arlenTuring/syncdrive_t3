import type { FacilityObject } from '../types/facility'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

const STROKE_STYLES = ['solid', 'dashed', 'dotted'] as const
type StrokeStyle = (typeof STROKE_STYLES)[number]

function resolveStrokeStyle(raw: unknown): StrokeStyle {
  if (raw === 'dashed' || raw === 'dotted' || raw === 'solid') return raw
  return 'solid'
}

export function FrameInspectorSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const params = facility.parameters ?? {}
  const strokeWidthPx =
    typeof params.strokeWidthPx === 'number' ? Math.max(0, params.strokeWidthPx) : 0
  const strokeColor =
    typeof params.strokeColor === 'string' ? params.strokeColor.trim() : 'transparent'
  const strokeStyle = resolveStrokeStyle(params.strokeStyle)

  const enabled = strokeWidthPx > 0 && strokeColor !== 'transparent'

  return (
    <section className="space-y-2.5 rounded-lg border border-zinc-800/70 bg-zinc-950/45 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-zinc-500">
        框線樣式
      </h3>

      <label className="flex cursor-pointer items-center gap-2 text-[11px] text-zinc-300">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={enabled}
          onChange={(e) => {
            if (readOnly) return
            const v = e.target.checked
            if (!v) {
              onPatchParameters({
                strokeWidthPx: undefined,
                strokeColor: undefined,
                strokeStyle: undefined,
              })
              return
            }

            onPatchParameters({
              strokeWidthPx: strokeWidthPx > 0 ? strokeWidthPx : 2,
              strokeColor: strokeColor !== 'transparent' ? strokeColor : '#22d3ee',
              strokeStyle: strokeStyle,
            })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="rounded border-zinc-600 accent-cyan-500"
        />
        顯示框線（預設透明不顯示）
      </label>

      {enabled && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <label className="block text-[10px] text-zinc-500">
              線條粗細（px）
              <input
                type="number"
                min={0}
                max={20}
                step={1}
                readOnly={readOnly}
                value={strokeWidthPx}
                onChange={(e) => {
                  const n = Number.parseFloat(e.target.value)
                  if (!Number.isFinite(n)) return
                  onPatchParameters({ strokeWidthPx: Math.max(0, Math.round(n)) })
                }}
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-cyan-500"
              />
            </label>

            <label className="block text-[10px] text-zinc-500">
              線條顏色
              <input
                type="color"
                disabled={readOnly}
                value={
                  strokeColor && strokeColor !== 'transparent' ? strokeColor : '#22d3ee'
                }
                onChange={(e) => onPatchParameters({ strokeColor: e.target.value })}
                onFocus={onFieldFocus}
                onBlur={onFieldBlur}
                className="mt-1 h-9 w-full cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:opacity-60"
              />
            </label>
          </div>

          <label className="block text-[10px] text-zinc-500">
            虛線/點線樣式
            <select
              disabled={readOnly}
              value={strokeStyle}
              onChange={(e) =>
                onPatchParameters({
                  strokeStyle: e.target.value as StrokeStyle,
                })
              }
              onFocus={onFieldFocus}
              onBlur={onFieldBlur}
              className="mt-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-cyan-500 disabled:opacity-60"
            >
              {STROKE_STYLES.map((s) => (
                <option key={s} value={s}>
                  {s === 'solid' ? '實線' : s === 'dashed' ? '虛線' : '點線'}
                </option>
              ))}
            </select>
          </label>
        </>
      )}
    </section>
  )
}

