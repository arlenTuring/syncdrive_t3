import { useEffect, useState } from 'react'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  WAYPOINT_CODE_KEY,
  getWaypointCode,
} from '../utils/waypointFacility'
import {
  normalizeWaypointCodeInput,
  patchWaypointCode,
} from '../utils/waypointCode'

type Props = {
  facility: FacilityObject
  areas: MapAreaObject[]
  readOnly: boolean
  onApplyWaypoint: (facility: FacilityObject) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function WaypointInspectorSection({
  facility,
  areas,
  readOnly,
  onApplyWaypoint,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'Waypoint') return null

  const params = facility.parameters ?? {}
  const committedCode =
    typeof params[WAYPOINT_CODE_KEY] === 'string'
      ? params[WAYPOINT_CODE_KEY]
      : getWaypointCode(facility)

  const [draftCode, setDraftCode] = useState(committedCode)
  const [codeError, setCodeError] = useState<string | null>(null)

  useEffect(() => {
    setDraftCode(committedCode)
    setCodeError(null)
  }, [facility.id, committedCode])

  const commitWaypointCode = () => {
    const normalized = normalizeWaypointCodeInput(draftCode)
    const result = patchWaypointCode(facility, areas, normalized)
    if (result.error) {
      setCodeError(result.error)
      return
    }
    setCodeError(null)
    onApplyWaypoint(result.facility)
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-emerald-900/40 bg-emerald-950/12 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-emerald-400/90">
        途經點
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        自駕車前往目標時必須經過的點位；圖台以綠色標記顯示，不顯示名稱。
      </p>

      <div>
        <label
          htmlFor="waypoint-code"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          途經點代號
        </label>
        <input
          id="waypoint-code"
          readOnly={readOnly}
          value={draftCode}
          onChange={(e) => {
            setDraftCode(e.target.value)
            if (codeError) setCodeError(null)
          }}
          onFocus={onFieldFocus}
          onBlur={() => {
            onFieldBlur()
            if (!readOnly) commitWaypointCode()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          placeholder="例：waypoint_1"
          className={`w-full rounded border bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-emerald-500 disabled:opacity-60 ${
            codeError ? 'border-red-600' : 'border-zinc-600'
          }`}
        />
        {codeError ? (
          <p className="mt-1 text-[10px] text-red-400">{codeError}</p>
        ) : (
          <p className="mt-1 text-[10px] text-zinc-600">
            全圖唯一；新建預設 waypoint_1、waypoint_2…，可自行修改。
          </p>
        )}
      </div>
    </section>
  )
}
