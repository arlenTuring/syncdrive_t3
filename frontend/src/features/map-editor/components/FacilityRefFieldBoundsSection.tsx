import { useState } from 'react'
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
import { getTrackGenPaths } from '../utils/trackGenPaths'
import { findStaleTrackPathEnds, rederiveTrackPath } from '../utils/shapedTrackPaths'
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

  /*
   * 生成出來（或已推導出中心線）的軌道，場域座標由它自己身上的<strong>現場中心線</strong>決定，
   * 下面這四個數字只是從中心線反推的結果。所以在圖上移動它，範圍不會跟著變：現場的路沒有動。
   * 複製一塊軌道再拖到別處，連中心線一起複製過去，兩端就接不上隔壁——這時要重建中心線。
   */
  const hasCentreline = facility.type === 'Track' && !!getTrackGenPaths(facility.parameters)
  const staleEnds = area && hasCentreline ? findStaleTrackPathEnds(facility, area) : []
  const [rebuildNote, setRebuildNote] = useState<string | null>(null)

  const handleRebuildCentreline = () => {
    if (!area || readOnly) return
    const res = rederiveTrackPath(facility, area)
    if (!res.ok) {
      setRebuildNote(`無法重建：${res.reason}`)
      return
    }
    const patch: Record<string, unknown> = {}
    for (const [k, v] of Object.entries(res.facility.parameters ?? {})) {
      if (JSON.stringify(v) !== JSON.stringify(facility.parameters?.[k])) patch[k] = v
    }
    onPatchParameters(patch)
    setRebuildNote(`已重建：中心線兩端改接隔壁，起點移動 ${res.changedM.toFixed(1)} 公尺`)
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

      {hasCentreline ? (
        <p className="text-[10px] leading-relaxed text-sky-300/80">
          這一塊有自己的現場中心線，場域範圍由它決定；在圖上移動位置不會改變範圍（現場的路沒有動）。
        </p>
      ) : null}
      {staleEnds.length > 0 ? (
        <div className="space-y-1.5 rounded-md border border-amber-700/50 bg-amber-950/30 p-2">
          <p className="text-[10px] leading-relaxed text-amber-300">
            中心線與圖上貼著它的軌道對不上：
            {staleEnds
              .map((e) => `${e.end === 0 ? '起點' : '終點'}差 ${e.diffM.toFixed(1)} 公尺`)
              .join('、')}
            。多半是複製後移到別處、中心線還是原本那塊的。
          </p>
          {!readOnly ? (
            <button
              type="button"
              onClick={handleRebuildCentreline}
              className="rounded-md border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[10px] text-amber-200 hover:border-amber-500 hover:bg-amber-900/40"
            >
              依接合的鄰居重建中心線
            </button>
          ) : null}
        </div>
      ) : null}
      {rebuildNote ? <p className="text-[10px] text-emerald-300/90">{rebuildNote}</p> : null}

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
