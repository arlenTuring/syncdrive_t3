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
import { Button } from '../../../components/ui';

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
          <h3 className="text-caption-2 uppercase text-emerald-400/90">
            設施停靠點
          </h3>
          <p className="mt-1 text-caption-2 text-text-quaternary">
            設於本設施場域範圍內；圖上為綠色圓點，可拖曳但不可離開設施外框。設定後會出現在點位清單「設施停靠點」。
          </p>
        </div>
        {point ? (
          <span
            className="mt-0.5 size-2.5 shrink-0 rounded-full bg-status-success ring-2 ring-emerald-300/60"
            aria-hidden
          />
        ) : null}
      </div>

      {!bounds ? (
        <p className="rounded-md border border-dashed border-border-quaternary px-2 py-2 text-caption-2 text-text-quaternary">
          請先填寫有效的「場域範圍」，才能設定設施停靠點。
        </p>
      ) : !point ? (
        <Button hierarchy="subordinate" variant="outlined" className="w-full" disabled={readOnly} onPress={() => commitPoint(defaultFacilityDockingPoint(bounds))}>新增設施停靠點（左側 1/3、上下置中）</Button>
      ) : (
        <>
          <div>
            <label
              htmlFor={`facility-dock-alias-${facility.id}`}
              className="mb-1 block text-caption-2 text-text-quaternary"
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
              className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1.5 text-body-xs text-text-primary outline-none placeholder:text-text-quaternary focus:border-status-success disabled:opacity-60"
              aria-label="設施停靠點別名"
            />
            <p className="mt-1 text-caption-2 text-text-disabled">
              預設為「{defaultAlias}」；留空則使用預設。
            </p>
          </div>

          <p className="font-mono text-caption-2 text-text-quaternary">
            允許範圍：{describeFacilityDockingPointBounds(bounds)} m
          </p>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label
                htmlFor={`facility-dock-xm-${facility.id}`}
                className="mb-1 block text-caption-2 text-text-quaternary"
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
                className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-body-xs text-text-primary outline-none focus:border-status-success disabled:opacity-60"
              />
            </div>
            <div>
              <label
                htmlFor={`facility-dock-ym-${facility.id}`}
                className="mb-1 block text-caption-2 text-text-quaternary"
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
                className="w-full rounded border border-border-tertiary bg-surface-sub-background px-2 py-1.5 font-mono text-body-xs text-text-primary outline-none focus:border-status-success disabled:opacity-60"
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button hierarchy="subordinate" variant="outlined" disabled={readOnly} onPress={() =>
                commitPoint({
                  ...defaultFacilityDockingPoint(bounds),
                  ...(point.alias ? { alias: point.alias } : {}),
                })
              }>重設為左側 1/3</Button>
            <Button hierarchy="subordinate" variant="outlined" disabled={readOnly} onPress={() => commitPoint(null)}>移除停靠點</Button>
          </div>
        </>
      )}
    </section>
  )
}
