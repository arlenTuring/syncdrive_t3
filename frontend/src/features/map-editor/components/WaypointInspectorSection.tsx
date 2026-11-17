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
    <section className="space-y-2.5 rounded-lg border border-status-success-light bg-status-success-light p-3">
      <h3 className="text-caption-2 uppercase text-status-success">
        途經點
      </h3>
      <p className="text-caption-2 text-text-quaternary">
        自駕車前往目標時必須經過的點位；顯示名稱請填上方「自訂顯示名稱」。
      </p>

      <div>
        <label
          htmlFor="waypoint-code"
          className="mb-1 block text-caption-2 text-text-quaternary"
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
          className={`w-full rounded border bg-surface-sub-background px-2 py-1.5 font-mono text-body-xs text-text-primary outline-none focus:border-status-success disabled:opacity-60 ${
            codeError ? 'border-status-error' : 'border-border-tertiary'
          }`}
        />
        {codeError ? (
          <p className="mt-1 text-caption-2 text-status-error-emphasis">{codeError}</p>
        ) : (
          <p className="mt-1 text-caption-2 text-text-disabled">
            全圖唯一；新建預設 waypoint_1、waypoint_2…，可自行修改。
          </p>
        )}
      </div>
    </section>
  )
}
