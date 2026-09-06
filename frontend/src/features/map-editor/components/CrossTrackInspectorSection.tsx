import { useTranslation } from 'react-i18next'
import type { FacilityObject } from '../types/facility'
import {
  CROSS_PORTAL_KEYS,
  CROSS_ROUTE_DIRECTIONS,
  CROSS_ROUTE_ENDS,
  CROSS_ROUTE_KEYS,
  getCrossPortals,
  getCrossRoutes,
  patchCrossPortal,
  patchCrossRoute,
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
}

function fmt(n: number | null): string {
  if (n === null) return ''
  return Number.isInteger(n) ? String(n) : String(Math.round(n * 1000) / 1000)
}

/**
 * 交叉軌道的途經點與方向設定。
 *
 * 四個口各一組途經點欄位（代號、別名、現場座標），四條路徑各一個方向。虛擬渡線只有
 * 兩個端點、方向靠畫的時候決定；交叉軌道的口是接合出來的，沒有先後，所以方向要填。
 */
export function CrossTrackInspectorSection({
  facility,
  readOnly = false,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  const { t } = useTranslation()
  const portals = getCrossPortals(facility)
  const routes = getCrossRoutes(facility)

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

      <div className="space-y-1.5">
        {CROSS_PORTAL_KEYS.map((key) => {
          const p = portals[key]
          return (
            <div
              key={key}
              className="space-y-1.5 rounded border border-zinc-800/80 bg-zinc-900/40 px-2 py-1.5"
            >
              <div className="text-[9px] uppercase tracking-wide text-zinc-300">
                {portalLabel(key)}
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
                      key={`xc-${axis}-${facility.id}-${key}-${fmt(p[axis])}`}
                      type="number"
                      step="any"
                      readOnly={readOnly}
                      defaultValue={fmt(p[axis])}
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
