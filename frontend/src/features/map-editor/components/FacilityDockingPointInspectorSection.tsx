import { getValidRefFieldBounds } from '../utils/facilityRefFieldBounds'
import {
  clampPointToRefFieldBounds,
  defaultFacilityDockingPoint,
  describeFacilityDockingPointBounds,
  getFacilityDockingPoint,
  resolveFacilityDockingPointDefaultAlias,
  serializeFacilityDockingPoint,
  type FacilityDockingPoint,
} from '../utils/facilityDockingPoint'
import type { FacilityObject } from '../types/facility'

type Props = {
  facility: FacilityObject
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

function formatInput(n: number): string {
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

export function FacilityDockingPointInspectorSection({
  facility,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Facility') return null

  const bounds = getValidRefFieldBounds(facility.parameters)
  const point = getFacilityDockingPoint(facility)
  const defaultAlias = resolveFacilityDockingPointDefaultAlias(facility)

  const commitPoint = (next: FacilityDockingPoint | null) => {
    if (next === null) {
      onPatchParameters({ facilityDockingPoint: undefined })
      return
    }
    onPatchParameters({
      facilityDockingPoint: serializeFacilityDockingPoint(next),
    })
  }

  const commitAxis = (axis: 'xM' | 'yM', raw: string) => {
    if (!bounds || !point) return
    const n = Number(raw)
    if (!Number.isFinite(n)) return
    const next = clampPointToRefFieldBounds({ ...point, [axis]: n }, bounds)
    commitPoint(next)
  }

  const commitAlias = (raw: string) => {
    if (!point) return
    const trimmed = raw.trim()
    commitPoint({
      xM: point.xM,
      yM: point.yM,
      ...(trimmed ? { alias: trimmed } : {}),
    })
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
            設施停靠點
          </h3>
          <p className="mt-1 text-[10px] leading-relaxed text-zinc-500">
            設於本設施場域範圍內；圖上為綠色圓點，可拖曳但不可離開設施外框。設定後會出現在點位清單「設施停靠點」。
          </p>
        </div>
        {point ? (
          <span
            className="mt-0.5 size-2.5 shrink-0 rounded-full bg-emerald-500 ring-2 ring-emerald-300/60"
            aria-hidden
          />
        ) : null}
      </div>

      {!bounds ? (
        <p className="rounded-md border border-dashed border-zinc-700/70 px-2 py-2 text-[10px] text-zinc-500">
          請先填寫有效的「場域範圍」，才能設定設施停靠點。
        </p>
      ) : !point ? (
        <button
          type="button"
          disabled={readOnly}
          onClick={() => commitPoint(defaultFacilityDockingPoint(bounds))}
          className="w-full rounded-md border border-emerald-700/60 bg-emerald-950/50 px-2 py-1.5 text-[11px] text-emerald-100 transition hover:bg-emerald-900/50 disabled:opacity-50"
        >
          新增設施停靠點（左側 1/3、上下置中）
        </button>
      ) : (
        <>
          <div>
            <label
              htmlFor={`facility-dock-alias-${facility.id}`}
              className="mb-1 block text-[10px] text-zinc-500"
            >
              別名
            </label>
            <input
              id={`facility-dock-alias-${facility.id}`}
              type="text"
              disabled={readOnly}
              defaultValue={point.alias ?? ''}
              key={`alias-${point.alias ?? ''}-${defaultAlias}`}
              placeholder={defaultAlias}
              onFocus={onFieldFocus}
              onBlur={(e) => {
                commitAlias(e.target.value)
                onFieldBlur()
              }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.currentTarget.blur()
                }
              }}
              className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none placeholder:text-zinc-600 focus:border-emerald-500 disabled:opacity-60"
              aria-label="設施停靠點別名"
            />
            <p className="mt-1 text-[10px] text-zinc-600">
              預設為「{defaultAlias}」；留空則使用預設。
            </p>
          </div>

          <p className="font-mono text-[10px] text-zinc-500">
            允許範圍：{describeFacilityDockingPointBounds(bounds)} m
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor={`facility-dock-xm-${facility.id}`}
                className="mb-1 block text-[10px] text-zinc-500"
              >
                橫向 X（公尺）
              </label>
              <input
                id={`facility-dock-xm-${facility.id}`}
                type="number"
                step="any"
                disabled={readOnly}
                defaultValue={formatInput(point.xM)}
                key={`x-${point.xM}`}
                min={bounds.xMinM}
                max={bounds.xMaxM}
                onFocus={onFieldFocus}
                onBlur={(e) => {
                  commitAxis('xM', e.target.value)
                  onFieldBlur()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  }
                }}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-60"
              />
            </div>
            <div>
              <label
                htmlFor={`facility-dock-ym-${facility.id}`}
                className="mb-1 block text-[10px] text-zinc-500"
              >
                縱向 Y（公尺）
              </label>
              <input
                id={`facility-dock-ym-${facility.id}`}
                type="number"
                step="any"
                disabled={readOnly}
                defaultValue={formatInput(point.yM)}
                key={`y-${point.yM}`}
                min={bounds.yMinM}
                max={bounds.yMaxM}
                onFocus={onFieldFocus}
                onBlur={(e) => {
                  commitAxis('yM', e.target.value)
                  onFieldBlur()
                }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.currentTarget.blur()
                  }
                }}
                className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-60"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={readOnly}
              onClick={() =>
                commitPoint({
                  ...defaultFacilityDockingPoint(bounds),
                  ...(point.alias ? { alias: point.alias } : {}),
                })
              }
              className="rounded border border-zinc-600 bg-zinc-900/80 px-2 py-1 text-[10px] text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
            >
              重設為左側 1/3
            </button>
            <button
              type="button"
              disabled={readOnly}
              onClick={() => commitPoint(null)}
              className="rounded border border-rose-800/50 bg-rose-950/40 px-2 py-1 text-[10px] text-rose-200/90 hover:bg-rose-900/40 disabled:opacity-50"
            >
              移除停靠點
            </button>
          </div>
        </>
      )}
    </section>
  )
}
