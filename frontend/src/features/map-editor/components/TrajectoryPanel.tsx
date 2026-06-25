import { FolderOpen, LocateFixed, Pause, Play, RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { VEHICLE_IDS } from '../constants/vehicles'
import type { VehicleTrajectoryEntry } from '../constants/vehicleTrajectoryCatalog'
import type { ParsedTrajectory } from '../types/trajectoryFile'
import { TrajectoryRawDataList } from './TrajectoryRawDataList'

type TrajectoryPanelProps = {
  selectedVehicleId: string | null
  onVehicleIdChange: (id: string) => void
  trajectoryEntries: VehicleTrajectoryEntry[]
  selectedEntryId: string | null
  onTrajectoryEntryChange: (entryId: string) => void
  hasTrajectory: boolean
  /** 開始回放後（含暫停）於右側顯示原始數據清單（新→舊） */
  loadedTrajectory: ParsedTrajectory | null
  replayHeadIndex: number | null
  replayPlaying: boolean
  mapMismatch: boolean
  onPlay: () => void
  onPause: () => void
  onRewind: () => void
  onImportTrajectory: (file: File) => void
  /** 捲動圖台對準目前車輛（或路徑起點） */
  onLocateVehicle: () => void
  /** 點選原始數據列時跳到該軌跡點並暫停 */
  onSeekToIndex: (index: number) => void
}

export function TrajectoryPanel({
  selectedVehicleId,
  onVehicleIdChange,
  trajectoryEntries,
  selectedEntryId,
  onTrajectoryEntryChange,
  hasTrajectory,
  loadedTrajectory,
  replayHeadIndex,
  replayPlaying,
  mapMismatch,
  onPlay,
  onPause,
  onRewind,
  onImportTrajectory,
  onLocateVehicle,
  onSeekToIndex,
}: TrajectoryPanelProps) {
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showRawList =
    loadedTrajectory !== null &&
    loadedTrajectory.points.length > 0 &&
    (replayPlaying || replayHeadIndex !== null)

  return (
    <aside
      data-trajectory-panel
      className="flex h-full min-h-0 w-[22rem] shrink-0 flex-col border-l border-zinc-700/80 bg-zinc-900"
    >
      <div className="shrink-0 border-b border-zinc-700/80 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
        軌跡回放
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 flex flex-col gap-4 p-4 text-sm">
          <div>
            <label
              htmlFor="vehicle-select"
              className="mb-1.5 block text-xs font-medium text-zinc-400"
            >
              車輛
            </label>
            <div className="flex gap-2">
              <select
                id="vehicle-select"
                value={selectedVehicleId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) onVehicleIdChange(v)
                }}
                className="min-w-0 flex-1 rounded-md border border-zinc-600 bg-zinc-950 px-2 py-2 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50"
              >
                <option value="">請選擇車輛</option>
                {VEHICLE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </select>
              <button
                type="button"
                disabled={!hasTrajectory}
                onClick={onLocateVehicle}
                className="inline-flex shrink-0 items-center justify-center rounded-md border border-zinc-600 bg-zinc-800 px-2.5 py-2 text-zinc-100 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
                title="捲動圖台對準目前車輛；未播放時對準路徑起點"
                aria-label="對準車輛位置"
              >
                <LocateFixed className="size-4 text-cyan-300" aria-hidden />
              </button>
            </div>
            <p className="mt-1.5 text-xs text-zinc-600">
              選取後會載入該車輛預設的<strong>最新</strong>軌跡檔；可改選下方清單更換。
            </p>
          </div>

          <div>
            <label
              htmlFor="traj-file-select"
              className="mb-1.5 block text-xs font-medium text-zinc-400"
            >
              軌跡清單檔
            </label>
            <select
              id="traj-file-select"
              value={selectedEntryId ?? ''}
              disabled={!selectedVehicleId || trajectoryEntries.length === 0}
              onChange={(e) => {
                const id = e.target.value
                if (id) onTrajectoryEntryChange(id)
              }}
              className="w-full rounded-md border border-zinc-600 bg-zinc-950 px-2 py-2 text-zinc-100 outline-none focus:border-cyan-500 focus:ring-1 focus:ring-cyan-500/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {trajectoryEntries.length === 0 ? (
                <option value="">—</option>
              ) : (
                trajectoryEntries.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.label} · {e.updatedAt.slice(0, 10)}
                  </option>
                ))
              )}
            </select>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!hasTrajectory}
              onClick={replayPlaying ? onPause : onPlay}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {replayPlaying ? (
                <Pause className="size-4 shrink-0" aria-hidden />
              ) : (
                <Play className="size-4 shrink-0" aria-hidden />
              )}
              {replayPlaying ? '暫停' : '播放'}
            </button>
            <button
              type="button"
              disabled={!hasTrajectory}
              onClick={onRewind}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 transition enabled:hover:bg-zinc-700 disabled:cursor-not-allowed disabled:opacity-40"
            >
              <RotateCcw className="size-4 shrink-0" aria-hidden />
              重播
            </button>
          </div>

          <div>
            <input
              ref={fileInputRef}
              type="file"
              accept="application/json,.json"
              className="sr-only"
              onChange={(e) => {
                const f = e.target.files?.[0]
                if (f) onImportTrajectory(f)
                e.target.value = ''
              }}
            />
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex w-full items-center justify-center gap-2 rounded-lg border border-zinc-600 bg-zinc-800 px-3 py-2 text-xs font-medium text-zinc-100 transition hover:bg-zinc-700"
            >
              <FolderOpen className="size-4 shrink-0" aria-hidden />
              匯入軌跡 JSON
            </button>
          </div>

          {mapMismatch && (
            <p className="text-xs text-amber-400/95">
              此軌跡建議搭配的地圖與目前載入的地圖不一致，畫面僅供示意。
            </p>
          )}
        </div>

        {showRawList && (
          <div className="flex min-h-0 flex-1 flex-col border-t border-zinc-700/80">
            <div className="shrink-0 px-3 py-2 text-xs font-medium uppercase tracking-wide text-zinc-500">
              原始數據（新→舊）
            </div>
            <TrajectoryRawDataList
              trajectoryId={loadedTrajectory.trajectoryId}
              points={loadedTrajectory.points}
              replayHeadIndex={replayHeadIndex}
              onSeekToIndex={onSeekToIndex}
            />
          </div>
        )}
      </div>
    </aside>
  )
}
