import type { MapAreaObject } from '../types/area'
import type { MapBasemapObject } from '../types/basemap'
import type { FacilityObject } from '../types/facility'
import {
  areaSupportsAutoFieldCoords,
} from '../utils/facilityRefFieldAuto'
import {
  shouldAutoSeedRefFieldBounds,
  syncAutoRefFieldBoundsFromPlacement,
  patchRefFieldCornersAndBounds,
} from '../utils/facilityRefFieldBoundsAuto'
import {
  describeRefFieldBoundsIssue,
  getRefFieldBounds,
  hasValidRefFieldBounds,
  isZeroRefFieldBoundsSpan,
  normalizeRefFieldBoundsParameters,
  patchRefFieldBounds,
  refFieldBoundsSpanMeters,
  type RefFieldBoundsMeters,
} from '../utils/facilityRefFieldBounds'
import {
  getRefFieldCorners,
  hasValidRefFieldCorners,
  REF_FIELD_CORNER_LABELS,
  REF_FIELD_CORNERS_M,
  type RefFieldCornerMeters,
} from '../utils/facilityRefFieldCorners'

type Props = {
  facility: FacilityObject
  area?: MapAreaObject | null
  basemaps?: readonly MapBasemapObject[]
  readOnly: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

function commitBounds(
  key: keyof RefFieldBoundsMeters,
  value: number | null,
  parameters: Record<string, unknown> | undefined,
  onPatchParameters: Props['onPatchParameters'],
) {
  onPatchParameters(patchRefFieldBounds(parameters, { [key]: value }))
}

export function FacilityRefFieldBoundsSection({
  facility,
  area = null,
  basemaps,
  readOnly,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const bounds = getRefFieldBounds(facility.parameters)
  const params = facility.parameters
  const span = refFieldBoundsSpanMeters(bounds)
  const hasBounds = hasValidRefFieldBounds(facility.parameters)
  const isZero = isZeroRefFieldBoundsSpan(facility.parameters)
  const boundsIssue = describeRefFieldBoundsIssue(facility.parameters)
  const autoMapped =
    shouldAutoSeedRefFieldBounds(facility.type) &&
    !!area &&
    areaSupportsAutoFieldCoords(area, basemaps)
  const isTaper = facility.name === 'RailTaper'
  const corners = getRefFieldCorners(facility.parameters)
  const hasCorners = hasValidRefFieldCorners(facility.parameters)

  const handleBlur = () => {
    if (!isTaper) {
      const normalized = normalizeRefFieldBoundsParameters(params)
      if (normalized) onPatchParameters(normalized)
    }
    onFieldBlur()
  }

  const handleResyncFromCanvas = () => {
    if (!area || readOnly) return
    const next = syncAutoRefFieldBoundsFromPlacement(facility, area, basemaps)
    if (next === facility) return
    if (isTaper) {
      onPatchParameters({
        [REF_FIELD_CORNERS_M]: next.parameters?.[REF_FIELD_CORNERS_M],
        ...patchRefFieldBounds({}, getRefFieldBounds(next.parameters)),
      })
      return
    }
    onPatchParameters(patchRefFieldBounds({}, getRefFieldBounds(next.parameters)))
  }

  const commitCorner = (
    index: number,
    axis: 'xM' | 'yM',
    value: number | null,
  ) => {
    const next: RefFieldCornerMeters[] = corners.map((c, i) =>
      i === index ? { ...c, [axis]: value } : { ...c },
    )
    onPatchParameters(patchRefFieldCornersAndBounds(params, next))
  }

  const boundFields: {
    key: keyof RefFieldBoundsMeters
    label: string
    id: string
  }[] = [
    { key: 'xMinM', label: '場域橫向範圍最小值 (m)', id: 'facility-ref-x-min' },
    { key: 'xMaxM', label: '場域橫向範圍最大值 (m)', id: 'facility-ref-x-max' },
    { key: 'yMinM', label: '場域縱向範圍最小值 (m)', id: 'facility-ref-y-min' },
    { key: 'yMaxM', label: '場域縱向範圍最大值 (m)', id: 'facility-ref-y-max' },
  ]

  return (
    <section className="space-y-2.5 rounded-lg border border-emerald-900/40 bg-emerald-950/15 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
        場域範圍（公尺）
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        {isTaper
          ? readOnly
            ? '斜接用 A／B／C／D 四個角點表示（每個點橫向、縱向各一個數）。圖上選取時會標出對應角。座標為場域公尺（原點左下）。'
            : autoMapped
              ? '斜接用 A／B／C／D 四個角點：每個點填橫向、縱向。選取時圖上四角會標 A–D。接上鄰軌或載入時會依圖上形狀自動填；也可手動改，或按下方按鈕重算。'
              : '斜接用 A／B／C／D 四個角點：每個點填橫向、縱向。選取時圖上四角會標 A–D。目前這個 Area 不是高精軌道區，需手動填寫。座標為場域公尺（原點左下）。'
          : readOnly
            ? '此元件在實際場域中的代表範圍（唯讀）。座標為場域公尺（原點左下，橫向／縱向）。'
            : autoMapped
              ? '此元件在實際場域中的代表範圍（左右上下四個數字）。高精 Area 內載入與軌道接合後會依圖上形狀自動填；亦可手動修改。座標為場域公尺（原點左下）。'
              : '此元件在實際場域中的代表範圍；僅能在此手動設定，數值即為對外語意。圖台拖曳、調整像素尺寸或拉伸 Area 外框均不會改變此範圍。座標為場域公尺（原點左下，橫向／縱向）。'}
      </p>

      {isTaper ? (
        <>
          {!hasCorners && !isZero ? (
            <p className="text-[10px] text-amber-500/90">
              請填齊 A／B／C／D 的橫向與縱向（共八個數字）。
            </p>
          ) : null}
          {autoMapped && !readOnly ? (
            <button
              type="button"
              onClick={handleResyncFromCanvas}
              className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-200/90 hover:border-emerald-600 hover:bg-emerald-900/40"
            >
              {hasCorners ? '依圖上形狀重算 A–D' : '依圖上形狀推算 A–D'}
            </button>
          ) : null}
          <div className="space-y-2">
            {REF_FIELD_CORNER_LABELS.map((label, index) => {
              const corner = corners[index]!
              return (
                <div
                  key={label}
                  className="rounded-md border border-emerald-900/30 bg-emerald-950/20 p-2"
                >
                  <p className="mb-1.5 text-[10px] font-medium text-emerald-300/80">
                    角 {label}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {(
                      [
                        { axis: 'xM' as const, axisLabel: '橫向 (m)', id: `taper-c${index}-x` },
                        { axis: 'yM' as const, axisLabel: '縱向 (m)', id: `taper-c${index}-y` },
                      ] as const
                    ).map(({ axis, axisLabel, id }) => (
                      <label key={axis} htmlFor={id} className="block text-[10px] text-zinc-500">
                        {axisLabel}
                        <input
                          id={id}
                          type="number"
                          step={0.1}
                          readOnly={readOnly}
                          value={corner[axis] === null ? '' : String(corner[axis])}
                          onChange={(e) => {
                            const raw = e.target.value.trim()
                            if (raw === '') {
                              commitCorner(index, axis, null)
                              return
                            }
                            const n = Number.parseFloat(raw)
                            if (!Number.isFinite(n)) return
                            commitCorner(index, axis, n)
                          }}
                          onFocus={onFieldFocus}
                          onBlur={handleBlur}
                          placeholder="—"
                          className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500 read-only:opacity-90"
                        />
                      </label>
                    ))}
                  </div>
                </div>
              )
            })}
          </div>
        </>
      ) : (
        <>
          {span ? (
            <p className="rounded-md border border-emerald-900/30 bg-emerald-950/25 px-2 py-1.5 font-mono text-[11px] text-emerald-100/90">
              涵蓋範圍：橫向 {span.w.toFixed(2)} m × 縱向 {span.h.toFixed(2)} m
            </p>
          ) : null}
          {isZero ? (
            <p className="text-[10px] text-zinc-400">
              已設為 0（不參與斷路掃描與車輛定位）。
            </p>
          ) : null}
          {!hasBounds && !isZero && boundsIssue ? (
            <p className="text-[10px] text-amber-500/90">{boundsIssue}</p>
          ) : null}
          {autoMapped && !readOnly ? (
            <button
              type="button"
              onClick={handleResyncFromCanvas}
              className="rounded-md border border-emerald-800/60 bg-emerald-950/40 px-2 py-1 text-[10px] text-emerald-200/90 hover:border-emerald-600 hover:bg-emerald-900/40"
            >
              {hasBounds ? '依圖上形狀重算範圍' : '依圖上形狀推算範圍'}
            </button>
          ) : null}
          <div className="grid grid-cols-2 gap-2">
            {boundFields.map(({ key, label, id }) => (
              <label key={key} htmlFor={id} className="block text-[10px] text-zinc-500">
                {label}
                <input
                  id={id}
                  type="number"
                  step={0.1}
                  readOnly={readOnly}
                  value={bounds[key] === null ? '' : String(bounds[key])}
                  onChange={(e) => {
                    const raw = e.target.value.trim()
                    if (raw === '') {
                      commitBounds(key, null, params, onPatchParameters)
                      return
                    }
                    const n = Number.parseFloat(raw)
                    if (!Number.isFinite(n)) return
                    commitBounds(key, n, params, onPatchParameters)
                  }}
                  onFocus={onFieldFocus}
                  onBlur={handleBlur}
                  placeholder="—"
                  className="mt-1 w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500 read-only:opacity-90"
                />
              </label>
            ))}
          </div>
        </>
      )}
    </section>
  )
}
