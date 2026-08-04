import { useEffect, useState } from 'react'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  DOCKING_POINT_CUSTOM_ICON_KEY,
  DOCKING_POINT_ICON_MODE_KEY,
  DOCKING_POINT_STATION_ID_KEY,
  getDockingPointStationId,
  parseDockingPointIconMode,
} from '../utils/dockingPointFacility'
import {
  normalizeStationIdInput,
  patchDockingPointStationId,
} from '../utils/dockingPointStationId'

type Props = {
  facility: FacilityObject
  areas: MapAreaObject[]
  readOnly: boolean
  onApplyDockingPoint: (facility: FacilityObject) => void
  onPatchParameters: (patch: Record<string, unknown>) => void
  onFieldFocus: () => void
  onFieldBlur: () => void
}

export function DockingPointInspectorSection({
  facility,
  areas,
  readOnly,
  onApplyDockingPoint,
  onPatchParameters,
  onFieldFocus,
  onFieldBlur,
}: Props) {
  if (facility.type !== 'DockingPoint') return null

  const params = facility.parameters ?? {}
  const committedId =
    typeof params[DOCKING_POINT_STATION_ID_KEY] === 'string'
      ? params[DOCKING_POINT_STATION_ID_KEY]
      : getDockingPointStationId(facility)
  const iconMode = parseDockingPointIconMode(params[DOCKING_POINT_ICON_MODE_KEY])
  const customIconUrl =
    typeof params[DOCKING_POINT_CUSTOM_ICON_KEY] === 'string'
      ? params[DOCKING_POINT_CUSTOM_ICON_KEY]
      : ''

  const [draftId, setDraftId] = useState(committedId)
  const [idError, setIdError] = useState<string | null>(null)

  useEffect(() => {
    setDraftId(committedId)
    setIdError(null)
  }, [facility.id, committedId])

  const commitStationId = () => {
    const normalized = normalizeStationIdInput(draftId)
    if (!normalized) {
      setIdError('請輸入站點 ID')
      return
    }
    const result = patchDockingPointStationId(facility, areas, normalized)
    if (result.error) {
      setIdError(result.error)
      return
    }
    setIdError(null)
    onApplyDockingPoint(result.facility)
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-sky-900/40 bg-sky-950/12 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
        停靠點
      </h3>
      <p className="text-[10px] leading-relaxed text-zinc-500">
        顯示名稱請填上方「自訂顯示名稱」。
      </p>

      <div>
        <label
          htmlFor="docking-station-id"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          站點 ID
        </label>
        <input
          id="docking-station-id"
          readOnly={readOnly}
          value={draftId}
          onChange={(e) => {
            setDraftId(e.target.value)
            if (idError) setIdError(null)
          }}
          onFocus={onFieldFocus}
          onBlur={() => {
            onFieldBlur()
            if (!readOnly) commitStationId()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          placeholder="例：station_1"
          className={`w-full rounded border bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60 ${
            idError ? 'border-red-600' : 'border-zinc-600'
          }`}
        />
        {idError ? (
          <p className="mt-1 text-[10px] text-red-400">{idError}</p>
        ) : (
          <p className="mt-1 text-[10px] text-zinc-600">
            全圖唯一；新建預設 station_1、station_2…，可自行修改。
          </p>
        )}
      </div>

      <div>
        <label
          htmlFor="docking-icon-mode"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          圖示樣式
        </label>
        <select
          id="docking-icon-mode"
          disabled={readOnly}
          value={iconMode}
          onChange={(e) => {
            const next = e.target.value
            onPatchParameters({
              [DOCKING_POINT_ICON_MODE_KEY]:
                next === 'dot' ? undefined : next,
              ...(next !== 'custom'
                ? { [DOCKING_POINT_CUSTOM_ICON_KEY]: undefined }
                : {}),
            })
          }}
          onFocus={onFieldFocus}
          onBlur={onFieldBlur}
          className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60"
        >
          <option value="dot">預設藍點</option>
          <option value="builtin">內建站點圖示</option>
          <option value="custom">自訂圖片 URL</option>
        </select>
      </div>

      {iconMode === 'custom' && (
        <div>
          <label
            htmlFor="docking-custom-icon"
            className="mb-1 block text-[10px] text-zinc-500"
          >
            圖片 URL
          </label>
          <input
            id="docking-custom-icon"
            readOnly={readOnly}
            value={customIconUrl}
            onChange={(e) =>
              onPatchParameters({
                [DOCKING_POINT_CUSTOM_ICON_KEY]:
                  e.target.value.trim() || undefined,
              })
            }
            onFocus={onFieldFocus}
            onBlur={onFieldBlur}
            placeholder="https://… 或 /map-editor-icons/…"
            className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1.5 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 read-only:opacity-80"
          />
        </div>
      )}
    </section>
  )
}
