import { Crosshair } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FacilityObject } from '../types/facility'
import type { MapAreaObject } from '../types/area'
import {
  CROSS_DIAG_STROKE_DOWN_KEY,
  CROSS_DIAG_STROKE_UP_KEY,
  CROSS_PORTAL_UI_ORDER,
  CROSS_ROUTE_DIRECTIONS,
  CROSS_ROUTE_ENDS,
  CROSS_ROUTE_KEYS,
  CROSS_SHOW_PORTAL_LABELS_KEY,
  getCrossDiagStrokeColors,
  getCrossPortals,
  getCrossRoutes,
  getCrossShowPortalLabels,
  patchCrossPortal,
  patchCrossRoute,
  pingCrossPortal,
  resolveCrossPortalFields,
  type CrossPortalKey,
  type CrossRouteDirection,
  type CrossRouteKey,
} from '../utils/crossTrackPortals'
import { normalizeWaypointCodeInput, normalizeWaypointNameInput } from '../utils/waypointCode'

type Props = {
  facility: FacilityObject
  readOnly?: boolean
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus?: () => void
  onFieldBlur?: () => void
  /** 反推現場座標要用到這個元件所在的容器 */
  mapAreas?: MapAreaObject[]
}

function fmt(n: number | null): string {
  if (n === null) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

/**
 * 交叉軌道的途經點與方向設定。
 *
 * 四個口各一組途經點欄位（代號、別名、現場座標），四條路徑各一個方向。交叉軌道的口是
 * 接合出來的，沒有先後，所以方向要填。
 */
export function CrossTrackInspectorSection({
  facility,
  readOnly = false,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
  mapAreas = [],
}: Props) {
  const { t } = useTranslation()
  const portals = getCrossPortals(facility)
  const routes = getCrossRoutes(facility)
  const diagColors = getCrossDiagStrokeColors(facility)
  const showPortalLabels = getCrossShowPortalLabels(facility)
  const area = mapAreas.find((a) => a.facilities?.some((f) => f.id === facility.id)) ?? null
  const resolved = resolveCrossPortalFields(facility, area)

  const commitCode = (key: CrossPortalKey, raw: string) => {
    const code = normalizeWaypointCodeInput(raw)
    if (code === portals[key].waypointCode) return
    onPatchParameters(patchCrossPortal(facility, key, { waypointCode: code }))
  }
  const commitAlias = (key: CrossPortalKey, raw: string) => {
    const alias = normalizeWaypointNameInput(raw)
    if (alias === (portals[key].alias ?? '')) return
    onPatchParameters(patchCrossPortal(facility, key, { alias }))
  }
  /*
   * 空白 = 回到自動。兩軸只填一個沒有意義（座標是一對），所以另一軸也一起清掉時
   * 才算回到自動——這裡只管自己那一軸，兩軸都空就自動。
   */
  const commitCoord = (key: CrossPortalKey, axis: 'xM' | 'yM', raw: string) => {
    const trimmed = raw.trim()
    const next = trimmed === '' ? null : Number(trimmed)
    if (next !== null && !Number.isFinite(next)) return
    if (next === portals[key][axis]) return
    onPatchParameters(patchCrossPortal(facility, key, { [axis]: next }))
  }

  const portalLabel = (key: CrossPortalKey) =>
    t(`mapEditor.inspector.crossTrack.portal.${key}`)

  return (
    <div className="space-y-2 rounded border border-zinc-800 bg-zinc-900/60 p-2">
      <div className="text-[10px] font-medium text-zinc-200">
        {t('mapEditor.inspector.crossTrack.title')}
      </div>

      <label className="flex cursor-pointer items-center gap-2 rounded border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5 text-[10px] text-zinc-300">
        <input
          type="checkbox"
          disabled={readOnly}
          checked={showPortalLabels}
          onChange={(e) =>
            onPatchParameters({ [CROSS_SHOW_PORTAL_LABELS_KEY]: e.target.checked })
          }
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="rounded border-zinc-600 bg-zinc-950 text-sky-500 focus:ring-sky-500 disabled:opacity-50"
        />
        {t('mapEditor.inspector.crossTrack.showPortalLabels')}
      </label>

      <div className="grid grid-cols-2 gap-2 rounded border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5">
        <label className="block text-[9px] text-zinc-400">
          {t('mapEditor.inspector.crossTrack.diagStrokeDown')}
          <input
            type="color"
            disabled={readOnly}
            value={diagColors.down}
            onChange={(e) =>
              onPatchParameters({ [CROSS_DIAG_STROKE_DOWN_KEY]: e.target.value })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="mt-1 h-8 w-full cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
        <label className="block text-[9px] text-zinc-400">
          {t('mapEditor.inspector.crossTrack.diagStrokeUp')}
          <input
            type="color"
            disabled={readOnly}
            value={diagColors.up}
            onChange={(e) =>
              onPatchParameters({ [CROSS_DIAG_STROKE_UP_KEY]: e.target.value })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            className="mt-1 h-8 w-full cursor-pointer rounded border border-zinc-600 bg-zinc-950 disabled:cursor-not-allowed disabled:opacity-50"
          />
        </label>
      </div>

      <div className="space-y-1.5">
        {CROSS_PORTAL_UI_ORDER.map((key) => {
          const p = portals[key]
          return (
            <div
              key={key}
              className="space-y-1.5 rounded border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5"
            >
              <div className="flex items-center justify-between gap-2">
                <div className="text-[9px] uppercase tracking-wide text-zinc-300">
                  {portalLabel(key)}
                </div>
                <button
                  type="button"
                  title={t('mapEditor.inspector.crossTrack.pingPortal')}
                  aria-label={t('mapEditor.inspector.crossTrack.pingPortal')}
                  onClick={() => pingCrossPortal(facility.id, key)}
                  className="inline-flex size-6 shrink-0 items-center justify-center rounded border border-cyan-500/40 bg-cyan-950/50 text-cyan-200 hover:border-cyan-400/70 hover:bg-cyan-900/50"
                >
                  <Crosshair className="size-3.5" aria-hidden />
                </button>
              </div>

              <div>
                <label
                  htmlFor={`xc-code-${facility.id}-${key}`}
                  className="mb-0.5 block text-[9px] text-zinc-400"
                >
                  {t('mapEditor.inspector.crossTrack.waypointCode')}
                </label>
                <input
                  id={`xc-code-${facility.id}-${key}`}
                  key={`xc-code-${facility.id}-${key}-${p.waypointCode}`}
                  readOnly={readOnly}
                  defaultValue={p.waypointCode}
                  onFocus={onFieldFocus}
                  onBlur={(e) => {
                    onFieldBlur?.()
                    if (!readOnly) commitCode(key, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </div>

              <div>
                <label
                  htmlFor={`xc-alias-${facility.id}-${key}`}
                  className="mb-0.5 block text-[9px] text-zinc-400"
                >
                  {t('mapEditor.inspector.crossTrack.alias')}
                </label>
                <input
                  id={`xc-alias-${facility.id}-${key}`}
                  key={`xc-alias-${facility.id}-${key}-${p.alias ?? ''}`}
                  readOnly={readOnly}
                  defaultValue={p.alias ?? ''}
                  onFocus={onFieldFocus}
                  onBlur={(e) => {
                    onFieldBlur?.()
                    if (!readOnly) commitAlias(key, e.target.value)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                  }}
                  className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
                />
              </div>

              <div className="grid grid-cols-2 gap-1.5">
                {(['xM', 'yM'] as const).map((axis) => (
                  <div key={axis}>
                    <label
                      htmlFor={`xc-${axis}-${facility.id}-${key}`}
                      className="mb-0.5 block text-[9px] text-zinc-400"
                    >
                      {axis === 'xM'
                        ? t('mapEditor.inspector.crossTrack.fieldX')
                        : t('mapEditor.inspector.crossTrack.fieldY')}
                    </label>
                    <input
                      id={`xc-${axis}-${facility.id}-${key}`}
                      key={`xc-${axis}-${facility.id}-${key}-${fmt(resolved[key][axis])}`}
                      type="number"
                      step="any"
                      readOnly={readOnly}
                      defaultValue={fmt(resolved[key][axis])}
                      title={
                        resolved[key].auto
                          ? t('mapEditor.inspector.crossTrack.autoValue')
                          : undefined
                      }
                      onFocus={onFieldFocus}
                      onBlur={(e) => {
                        onFieldBlur?.()
                        if (!readOnly) commitCoord(key, axis, e.target.value)
                      }}
                      onKeyDown={(e) => {
                        if (e.key === 'Enter') e.currentTarget.blur()
                      }}
                      className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
                    />
                  </div>
                ))}
              </div>
              {resolved[key].auto ? (
                <p className="text-[9px] text-emerald-400/80">
                  {t('mapEditor.inspector.crossTrack.autoValue')}
                </p>
              ) : (
                <p className="text-[9px] text-amber-400/80">
                  {t('mapEditor.inspector.crossTrack.manualValue')}
                </p>
              )}
            </div>
          )
        })}
        <p className="text-[9px] leading-relaxed text-zinc-500">
          {t('mapEditor.inspector.crossTrack.fieldHint')}
        </p>
      </div>

      <div className="space-y-1.5">
        <div className="text-[10px] font-medium text-zinc-200">
          {t('mapEditor.inspector.crossTrack.routes')}
        </div>
        {CROSS_ROUTE_KEYS.map((key: CrossRouteKey) => {
          const [from, to] = CROSS_ROUTE_ENDS[key]
          return (
            <div key={key} className="flex items-center gap-2">
              <label
                htmlFor={`xc-route-${facility.id}-${key}`}
                className="min-w-0 flex-1 truncate text-[10px] text-zinc-300"
              >
                {t(`mapEditor.inspector.crossTrack.route.${key}`)}
                <span className="ml-1 font-mono text-[9px] text-zinc-500">
                  {portalLabel(from)}→{portalLabel(to)}
                </span>
              </label>
              <select
                id={`xc-route-${facility.id}-${key}`}
                disabled={readOnly}
                value={routes[key]}
                onChange={(e) =>
                  onPatchParameters(
                    patchCrossRoute(facility, key, e.target.value as CrossRouteDirection),
                  )
                }
                className="shrink-0 rounded border border-zinc-600 bg-zinc-950 px-1.5 py-1 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
              >
                {CROSS_ROUTE_DIRECTIONS.map((d) => (
                  <option key={d} value={d}>
                    {t(`mapEditor.inspector.crossTrack.direction.${d}`)}
                  </option>
                ))}
              </select>
            </div>
          )
        })}
      </div>
    </div>
  )
}
