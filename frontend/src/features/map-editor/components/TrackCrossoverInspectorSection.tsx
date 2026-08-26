import type { FacilityObject } from '../types/facility'
import type { MapAreaObject } from '../types/area'
import { useEffect, useRef, useState } from 'react'
import {
  CROSSOVER_PORTAL_KEYS,
  DEFAULT_TRACK_CROSSOVER_BG_OPACITY,
  DEFAULT_TRACK_CROSSOVER_CENTER_GAP_PCT,
  DEFAULT_TRACK_CROSSOVER_COLOR,
  DEFAULT_TRACK_CROSSOVER_COLOR_OPACITY,
  DEFAULT_TRACK_CROSSOVER_STROKE_PX,
  MAX_TRACK_CROSSOVER_BG_OPACITY,
  MAX_TRACK_CROSSOVER_CENTER_GAP_PCT,
  MAX_TRACK_CROSSOVER_COLOR_OPACITY,
  MAX_TRACK_CROSSOVER_STROKE_PX,
  MIN_TRACK_CROSSOVER_BG_OPACITY,
  MIN_TRACK_CROSSOVER_CENTER_GAP_PCT,
  MIN_TRACK_CROSSOVER_COLOR_OPACITY,
  MIN_TRACK_CROSSOVER_STROKE_PX,
  TRACK_CROSSOVER_BG_COLOR_KEY,
  TRACK_CROSSOVER_BG_OPACITY_KEY,
  TRACK_CROSSOVER_CENTER_GAP_PCT_KEY,
  TRACK_CROSSOVER_COLOR_KEY,
  TRACK_CROSSOVER_COLOR_OPACITY_KEY,
  TRACK_CROSSOVER_PORTALS_KEY,
  crossoverPortalFieldMeters,
  TRACK_CROSSOVER_STROKE_PX_KEY,
  clampTrackCrossoverBgOpacity,
  clampTrackCrossoverCenterGapPct,
  clampTrackCrossoverColorOpacity,
  clampTrackCrossoverStrokePx,
  getCrossoverPortals,
  parseTrackCrossoverBgColor,
  parseTrackCrossoverBgOpacity,
  parseTrackCrossoverCenterGapPct,
  parseTrackCrossoverColor,
  parseTrackCrossoverColorOpacity,
  parseTrackCrossoverStrokePx,
  type CrossoverPortalKey,
} from '../utils/trackCrossoverFacility'
import {
  normalizeWaypointCodeInput,
  normalizeWaypointNameInput,
  patchCrossoverPortalAlias,
  patchCrossoverPortalFieldMeters,
  patchCrossoverPortalWaypointCode,
} from '../utils/waypointCode'

type Props = {
  facility: FacilityObject
  readOnly?: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus?: () => void
  onFieldBlur?: () => void
  /** 用於解析已接合軌道的顯示名稱 */
  mapAreas?: MapAreaObject[]
}

const FALLBACK_BG_PICKER = '#64748b'

const PORTAL_END_LABEL: Record<CrossoverPortalKey, string> = {
  a: '端點 A',
  b: '端點 B',
}

function findTrackById(
  mapAreas: MapAreaObject[] | undefined,
  trackId: string,
): FacilityObject | null {
  if (!mapAreas) return null
  for (const area of mapAreas) {
    const hit = area.facilities?.find(
      (f) => f.type === 'Track' && f.id === trackId,
    )
    if (hit) return hit
  }
  return null
}

function trackDisplayName(track: FacilityObject | null, trackId: string): string {
  if (!track) return trackId
  const name = track.customName.trim() || track.name.trim()
  return name || trackId
}

function formatFieldMeters(n: number | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

export function TrackCrossoverInspectorSection({
  facility,
  readOnly = false,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
  mapAreas = [],
}: Props) {
  const params = facility.parameters ?? {}
  const portals =
    facility.type === 'TrackCrossover' ? getCrossoverPortals(facility) : null

  const [draftCoords, setDraftCoords] = useState<
    Record<CrossoverPortalKey, { xM: string; yM: string }>
  >({
    // 欄位顯示的是<strong>現場</strong>座標，不是圖面座標
    a: {
      xM: formatFieldMeters(portals ? crossoverPortalFieldMeters(portals.a).xM : undefined),
      yM: formatFieldMeters(portals ? crossoverPortalFieldMeters(portals.a).yM : undefined),
    },
    b: {
      xM: formatFieldMeters(portals ? crossoverPortalFieldMeters(portals.b).xM : undefined),
      yM: formatFieldMeters(portals ? crossoverPortalFieldMeters(portals.b).yM : undefined),
    },
  })
  const [codeErrors, setCodeErrors] = useState<
    Partial<Record<CrossoverPortalKey, string | null>>
  >({})
  /** 座標欄位聚焦時略過外部同步，避免拖曳端點時覆寫輸入中的草稿 */
  const editingCoordRef = useRef<{
    key: CrossoverPortalKey
    axis: 'xM' | 'yM'
  } | null>(null)

  useEffect(() => {
    setDraftCoords((prev) => {
      const next = { ...prev }
      for (const key of CROSSOVER_PORTAL_KEYS) {
        const editing = editingCoordRef.current
        next[key] = {
          xM:
            editing?.key === key && editing.axis === 'xM'
              ? prev[key].xM
              : formatFieldMeters(
                portals ? crossoverPortalFieldMeters(portals[key]).xM : undefined,
              ),
          yM:
            editing?.key === key && editing.axis === 'yM'
              ? prev[key].yM
              : formatFieldMeters(
                portals ? crossoverPortalFieldMeters(portals[key]).yM : undefined,
              ),
        }
      }
      return next
    })
    setCodeErrors({})
  }, [
    facility.id,
    portals?.a.waypointCode,
    portals?.b.waypointCode,
    portals?.a.alias,
    portals?.b.alias,
    portals?.a.xM,
    portals?.a.yM,
    portals?.b.xM,
    portals?.b.yM,
  ])

  if (facility.type !== 'TrackCrossover') return null

  const color = parseTrackCrossoverColor(params[TRACK_CROSSOVER_COLOR_KEY])
  const colorOpacity = parseTrackCrossoverColorOpacity(
    params[TRACK_CROSSOVER_COLOR_OPACITY_KEY],
  )
  const strokePx = parseTrackCrossoverStrokePx(
    params[TRACK_CROSSOVER_STROKE_PX_KEY],
  )
  const centerGapPct = parseTrackCrossoverCenterGapPct(
    params[TRACK_CROSSOVER_CENTER_GAP_PCT_KEY],
  )
  const bgColor = parseTrackCrossoverBgColor(params[TRACK_CROSSOVER_BG_COLOR_KEY])
  const bgOpacity = parseTrackCrossoverBgOpacity(
    params[TRACK_CROSSOVER_BG_OPACITY_KEY],
  )
  const hasBg = bgColor != null

  const commitPortalCode = (key: CrossoverPortalKey, rawCode: string) => {
    const result = patchCrossoverPortalWaypointCode(
      facility,
      mapAreas,
      key,
      normalizeWaypointCodeInput(rawCode),
    )
    if (result.error) {
      setCodeErrors((prev) => ({ ...prev, [key]: result.error }))
      return
    }
    setCodeErrors((prev) => ({ ...prev, [key]: null }))
    const nextPortals = result.facility.parameters?.[TRACK_CROSSOVER_PORTALS_KEY]
    if (nextPortals != null) {
      onPatchParameters({ [TRACK_CROSSOVER_PORTALS_KEY]: nextPortals })
    }
  }

  const commitPortalAlias = (key: CrossoverPortalKey, rawAlias: string) => {
    const next = patchCrossoverPortalAlias(
      facility,
      key,
      normalizeWaypointNameInput(rawAlias),
    )
    const nextPortals = next.parameters?.[TRACK_CROSSOVER_PORTALS_KEY]
    if (nextPortals != null) {
      onPatchParameters({ [TRACK_CROSSOVER_PORTALS_KEY]: nextPortals })
    }
  }

  const commitPortalCoord = (key: CrossoverPortalKey, axis: 'xM' | 'yM') => {
    const raw = draftCoords[key][axis].trim()
    const n = Number.parseFloat(raw)
    if (!Number.isFinite(n)) {
      setDraftCoords((prev) => ({
        ...prev,
        [key]: {
          ...prev[key],
          [axis]: formatFieldMeters(
            portals ? crossoverPortalFieldMeters(portals[key])[axis] : undefined,
          ),
        },
      }))
      return
    }
    const next = patchCrossoverPortalFieldMeters(facility, key, { [axis]: n })
    const nextPortals = next.parameters?.[TRACK_CROSSOVER_PORTALS_KEY]
    if (nextPortals != null) {
      onPatchParameters({ [TRACK_CROSSOVER_PORTALS_KEY]: nextPortals })
    }
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-sky-900/40 bg-sky-950/12 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-300">
        虛擬渡線
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-300">
        雙邊緣實線。線徑寬度＝兩邊緣間距；中間消失＝從中心向兩端對稱張開缺口。
        端點 A／B 為內建途經點，可載入路網拓樸與加入路線。
      </p>

      <div className="space-y-1.5 rounded-md border border-zinc-700/80 bg-zinc-950/50 p-2">
        <div className="text-[10px] font-medium text-zinc-200">端點途經點</div>
        {CROSSOVER_PORTAL_KEYS.map((key) => {
          const trackId = portals?.[key]?.attachedTrackId ?? null
          const track = trackId ? findTrackById(mapAreas, trackId) : null
          const displayName = trackId
            ? trackDisplayName(track, trackId)
            : null
          const codeError = codeErrors[key]
          return (
            <div
              key={key}
              className="space-y-1.5 rounded border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[9px] uppercase tracking-wide text-zinc-300">
                    {PORTAL_END_LABEL[key]}
                  </div>
                  {trackId && displayName ? (
                    <>
                      <div className="truncate text-[12px] font-semibold text-cyan-100">
                        軌道：{displayName}
                      </div>
                      <div className="truncate font-mono text-[10px] text-zinc-400">
                        ID：{trackId}
                      </div>
                    </>
                  ) : (
                    <div className="text-[12px] text-zinc-400">軌道未接合</div>
                  )}
                </div>
                <span
                  className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[9px] ${
                    trackId
                      ? 'bg-cyan-500/15 text-cyan-300'
                      : 'bg-zinc-800 text-zinc-500'
                  }`}
                >
                  {trackId ? '已接合' : '空'}
                </span>
              </div>

              <div>
                <label
                  htmlFor={`xo-portal-code-${key}`}
                  className="mb-0.5 block text-[9px] text-zinc-400"
                >
                  途經點代號
                </label>
                <input
                  id={`xo-portal-code-${key}`}
                  key={`xo-portal-code-${facility.id}-${key}-${portals?.[key]?.waypointCode ?? ''}`}
                  readOnly={readOnly}
                  defaultValue={portals?.[key]?.waypointCode ?? ''}
                  onFocus={onFieldFocus}
                  onBlur={(e) => {
                    onFieldBlur?.()
                    if (!readOnly) commitPortalCode(key, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  placeholder={`例：xo_1_${key}`}
                  className={`w-full rounded border bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60 ${
                    codeError ? 'border-red-600' : 'border-zinc-600'
                  }`}
                />
                {codeError ? (
                  <p className="mt-0.5 text-[10px] text-red-400">{codeError}</p>
                ) : null}
              </div>

              <div>
                <label
                  htmlFor={`xo-portal-alias-${key}`}
                  className="mb-0.5 block text-[9px] text-zinc-400"
                >
                  別名（顯示名稱）
                </label>
                <input
                  id={`xo-portal-alias-${key}`}
                  key={`xo-portal-alias-${facility.id}-${key}-${portals?.[key]?.alias ?? ''}`}
                  readOnly={readOnly}
                  defaultValue={portals?.[key]?.alias ?? ''}
                  onFocus={onFieldFocus}
                  onBlur={(e) => {
                    onFieldBlur?.()
                    if (!readOnly) commitPortalAlias(key, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  placeholder="空則顯示代號"
                  className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                <div>
                  <label
                    htmlFor={`xo-portal-xm-${key}`}
                    className="mb-0.5 block text-[9px] text-zinc-400"
                  >
                    參照場域橫向位置 (m)
                  </label>
                  <input
                    id={`xo-portal-xm-${key}`}
                    type="number"
                    step="any"
                    readOnly={readOnly}
                    value={draftCoords[key].xM}
                    onChange={(e) =>
                      setDraftCoords((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], xM: e.target.value },
                      }))
                    }
                    onFocus={() => {
                      editingCoordRef.current = { key, axis: 'xM' }
                      onFieldFocus?.()
                    }}
                    onBlur={() => {
                      editingCoordRef.current = null
                      onFieldBlur?.()
                      if (!readOnly) commitPortalCoord(key, 'xM')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
                  />
                </div>
                <div>
                  <label
                    htmlFor={`xo-portal-ym-${key}`}
                    className="mb-0.5 block text-[9px] text-zinc-400"
                  >
                    參照場域縱向位置 (m)
                  </label>
                  <input
                    id={`xo-portal-ym-${key}`}
                    type="number"
                    step="any"
                    readOnly={readOnly}
                    value={draftCoords[key].yM}
                    onChange={(e) =>
                      setDraftCoords((prev) => ({
                        ...prev,
                        [key]: { ...prev[key], yM: e.target.value },
                      }))
                    }
                    onFocus={() => {
                      editingCoordRef.current = { key, axis: 'yM' }
                      onFieldFocus?.()
                    }}
                    onBlur={() => {
                      editingCoordRef.current = null
                      onFieldBlur?.()
                      if (!readOnly) commitPortalCoord(key, 'yM')
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') e.currentTarget.blur()
                    }}
                    className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
                  />
                </div>
              </div>
              <p className="text-[9px] leading-relaxed text-zinc-500">
                現場實際位置（場域公尺，原點左下）。拖動端點或磁吸接合時會一併
                更新；在這裡手打只修正量測值，<strong>不會移動圖上的端點</strong>。
              </p>
            </div>
          )
        })}
      </div>

      <div>
        <label
          htmlFor="track-crossover-width"
          className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-200"
        >
          <span>兩邊線徑寬度（間距）</span>
          <span className="font-mono text-zinc-200">{strokePx}px</span>
        </label>
        <input
          id="track-crossover-width"
          type="range"
          min={MIN_TRACK_CROSSOVER_STROKE_PX}
          max={MAX_TRACK_CROSSOVER_STROKE_PX}
          step={0.5}
          disabled={readOnly}
          value={strokePx}
          onChange={(e) => {
            const v = Number.parseFloat(e.target.value)
            if (!Number.isFinite(v)) return
            const clamped = clampTrackCrossoverStrokePx(v)
            onPatchParameters({
              [TRACK_CROSSOVER_STROKE_PX_KEY]:
                clamped === DEFAULT_TRACK_CROSSOVER_STROKE_PX
                  ? undefined
                  : clamped,
            })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full accent-sky-500 disabled:opacity-60"
        />
        <p className="mt-1 text-[9px] leading-relaxed text-zinc-400">
          選取後也可拖畫布上兩邊邊緣旁的方塊把手。
        </p>
      </div>
      <div>
        <label
          htmlFor="track-crossover-center-gap"
          className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-200"
        >
          <span>中間消失程度</span>
          <span className="font-mono text-zinc-200">{centerGapPct}%</span>
        </label>
        <input
          id="track-crossover-center-gap"
          type="range"
          min={MIN_TRACK_CROSSOVER_CENTER_GAP_PCT}
          max={MAX_TRACK_CROSSOVER_CENTER_GAP_PCT}
          step={1}
          disabled={readOnly}
          value={centerGapPct}
          onChange={(e) => {
            const v = Number.parseFloat(e.target.value)
            if (!Number.isFinite(v)) return
            const clamped = clampTrackCrossoverCenterGapPct(v)
            onPatchParameters({
              [TRACK_CROSSOVER_CENTER_GAP_PCT_KEY]:
                clamped === DEFAULT_TRACK_CROSSOVER_CENTER_GAP_PCT
                  ? undefined
                  : clamped,
            })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full accent-sky-500 disabled:opacity-60"
        />
        <p className="mt-1 text-[9px] leading-relaxed text-zinc-400">
          0%＝完整實線；愈大愈從中間向兩端對稱消失。
        </p>
      </div>
      <div>
        <label
          htmlFor="track-crossover-color"
          className="mb-1 block text-[10px] font-medium text-zinc-200"
        >
          線色
        </label>
        <div className="flex items-center gap-2">
          <input
            id="track-crossover-color"
            type="color"
            disabled={readOnly}
            value={
              /^#[0-9a-fA-F]{6}$/.test(color)
                ? color
                : DEFAULT_TRACK_CROSSOVER_COLOR
            }
            onChange={(e) =>
              onPatchParameters({
                [TRACK_CROSSOVER_COLOR_KEY]: e.target.value,
              })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-9 w-12 cursor-pointer rounded border border-zinc-600 bg-zinc-950 p-0.5 disabled:opacity-60"
          />
          <input
            type="text"
            readOnly={readOnly}
            value={color}
            onChange={(e) =>
              onPatchParameters({
                [TRACK_CROSSOVER_COLOR_KEY]: e.target.value.trim() || undefined,
              })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 read-only:opacity-80"
          />
        </div>
      </div>
      <div>
        <label
          htmlFor="track-crossover-color-opacity"
          className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-200"
        >
          <span>線色透明度</span>
          <span className="font-mono text-zinc-200">{colorOpacity}%</span>
        </label>
        <input
          id="track-crossover-color-opacity"
          type="range"
          min={MIN_TRACK_CROSSOVER_COLOR_OPACITY}
          max={MAX_TRACK_CROSSOVER_COLOR_OPACITY}
          step={1}
          disabled={readOnly}
          value={colorOpacity}
          onChange={(e) => {
            const v = Number.parseFloat(e.target.value)
            if (!Number.isFinite(v)) return
            const clamped = clampTrackCrossoverColorOpacity(v)
            onPatchParameters({
              [TRACK_CROSSOVER_COLOR_OPACITY_KEY]:
                clamped === DEFAULT_TRACK_CROSSOVER_COLOR_OPACITY
                  ? undefined
                  : clamped,
            })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full accent-sky-500 disabled:opacity-60"
        />
      </div>
      <div>
        <div className="mb-1 flex items-center justify-between gap-2">
          <label
            htmlFor="track-crossover-bg-color"
            className="text-[10px] font-medium text-zinc-200"
          >
            背景顏色
          </label>
          {hasBg && !readOnly ? (
            <button
              type="button"
              className="text-[10px] text-sky-400/90 hover:text-sky-300"
              onClick={() =>
                onPatchParameters({
                  [TRACK_CROSSOVER_BG_COLOR_KEY]: undefined,
                })
              }
            >
              清除（無背景）
            </button>
          ) : (
            <span className="text-[10px] text-zinc-400">
              {hasBg ? '' : '預設無背景'}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <input
            id="track-crossover-bg-color"
            type="color"
            disabled={readOnly}
            value={
              hasBg && /^#[0-9a-fA-F]{6}$/.test(bgColor)
                ? bgColor
                : FALLBACK_BG_PICKER
            }
            onChange={(e) =>
              onPatchParameters({
                [TRACK_CROSSOVER_BG_COLOR_KEY]: e.target.value,
                [TRACK_CROSSOVER_BG_OPACITY_KEY]:
                  params[TRACK_CROSSOVER_BG_OPACITY_KEY] == null
                    ? DEFAULT_TRACK_CROSSOVER_BG_OPACITY
                    : params[TRACK_CROSSOVER_BG_OPACITY_KEY],
              })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="h-9 w-12 cursor-pointer rounded border border-zinc-600 bg-zinc-950 p-0.5 disabled:opacity-60"
          />
          <input
            type="text"
            readOnly={readOnly}
            placeholder="無（留空）"
            value={bgColor ?? ''}
            onChange={(e) => {
              const t = e.target.value.trim()
              onPatchParameters({
                [TRACK_CROSSOVER_BG_COLOR_KEY]: t || undefined,
              })
            }}
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="min-w-0 flex-1 rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 placeholder:text-zinc-600 read-only:opacity-80"
          />
        </div>
      </div>
      <div>
        <label
          htmlFor="track-crossover-bg-opacity"
          className="mb-1 flex items-center justify-between text-[10px] font-medium text-zinc-200"
        >
          <span>背景透明度</span>
          <span className="font-mono text-zinc-200">
            {hasBg ? `${bgOpacity}%` : '—'}
          </span>
        </label>
        <input
          id="track-crossover-bg-opacity"
          type="range"
          min={MIN_TRACK_CROSSOVER_BG_OPACITY}
          max={MAX_TRACK_CROSSOVER_BG_OPACITY}
          step={1}
          disabled={readOnly || !hasBg}
          value={bgOpacity}
          onChange={(e) => {
            const v = Number.parseFloat(e.target.value)
            if (!Number.isFinite(v)) return
            const clamped = clampTrackCrossoverBgOpacity(v)
            onPatchParameters({
              [TRACK_CROSSOVER_BG_OPACITY_KEY]:
                clamped === DEFAULT_TRACK_CROSSOVER_BG_OPACITY
                  ? undefined
                  : clamped,
            })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full accent-sky-500 disabled:opacity-40"
        />
        <p className="mt-1 text-[9px] leading-relaxed text-zinc-400">
          需先設定背景色；0%＝全透明，100%＝不透明。
        </p>
      </div>
    </section>
  )
}
