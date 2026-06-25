import { useEffect, useState } from 'react'
import type { MapAreaObject } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  DOCKING_POINT_ICON_MODE_KEY,
  DOCKING_POINT_CUSTOM_ICON_KEY,
  DOCKING_POINT_STATION_NAME_KEY,
  getDockingPointNodeId,
  parseDockingPointIconMode,
} from '../utils/dockingPointFacility'
import {
  isDockingStationNameTaken,
  normalizeStationNameInput,
  patchDockingPointStationName,
} from '../utils/dockingPointNodeId'

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
  const committedName =
    typeof params[DOCKING_POINT_STATION_NAME_KEY] === 'string'
      ? params[DOCKING_POINT_STATION_NAME_KEY]
      : ''
  const nodeId = getDockingPointNodeId(facility)
  const iconMode = parseDockingPointIconMode(params[DOCKING_POINT_ICON_MODE_KEY])
  const customIconUrl =
    typeof params[DOCKING_POINT_CUSTOM_ICON_KEY] === 'string'
      ? params[DOCKING_POINT_CUSTOM_ICON_KEY]
      : ''

  const [draftName, setDraftName] = useState(committedName)
  const [nameError, setNameError] = useState<string | null>(null)

  useEffect(() => {
    setDraftName(committedName)
    setNameError(null)
  }, [facility.id, committedName])

  const commitStationName = () => {
    const normalized = normalizeStationNameInput(draftName)
    if (!normalized) {
      setNameError('請輸入站點名稱')
      return
    }
    if (isDockingStationNameTaken(areas, normalized, facility.id)) {
      setNameError('站點名稱不可與其他停靠點重複')
      return
    }
    const result = patchDockingPointStationName(facility, areas, normalized)
    if (result.error) {
      setNameError(result.error)
      return
    }
    setNameError(null)
    onApplyDockingPoint(result.facility)
  }

  return (
    <section className="space-y-2.5 rounded-lg border border-sky-900/40 bg-sky-950/12 p-3">
      <h3 className="text-[10px] font-semibold uppercase tracking-wider text-sky-400/90">
        停靠點
      </h3>
      <div>
        <label
          htmlFor="docking-station-name"
          className="mb-1 block text-[10px] text-zinc-500"
        >
          站點名稱
        </label>
        <input
          id="docking-station-name"
          readOnly={readOnly}
          value={draftName}
          onChange={(e) => {
            setDraftName(e.target.value)
            if (nameError) setNameError(null)
          }}
          onFocus={onFieldFocus}
          onBlur={() => {
            onFieldBlur()
            if (!readOnly) commitStationName()
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.currentTarget.blur()
            }
          }}
          placeholder="例：T3、S2W、D02"
          className={`w-full rounded border bg-zinc-950 px-2 py-1.5 text-[11px] text-zinc-100 outline-none focus:border-sky-500 disabled:opacity-60 ${
            nameError ? 'border-red-600' : 'border-zinc-600'
          }`}
        />
        {nameError ? (
          <p className="mt-1 text-[10px] text-red-400">{nameError}</p>
        ) : (
          <p className="mt-1 text-[10px] text-zinc-600">
            名稱不可重複；系統會依名稱自動產生節點 ID（對應營運協議 node_id）。
          </p>
        )}
      </div>
      <div>
        <label className="mb-1 block text-[10px] text-zinc-500">
          營運節點 ID（系統）
        </label>
        <div className="rounded border border-zinc-700/80 bg-zinc-950/80 px-2 py-1.5 font-mono text-[11px] text-cyan-200/90">
          {nodeId || '— 請先設定站點名稱 —'}
        </div>
        <p className="mt-1 text-[10px] text-zinc-600">
          用於 MQTT task_params.node_id；建立後不隨顯示名稱變更。
        </p>
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
            className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-100 outline-none focus:border-sky-500 read-only:opacity-80"
          />
        </div>
      )}
    </section>
  )
}
