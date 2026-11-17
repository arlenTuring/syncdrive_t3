import { SiteSelect } from '../../../components/SiteSelect';
import { FolderOpen, LocateFixed, Pause, Play, RotateCcw } from 'lucide-react'
import { useRef } from 'react'
import { useTranslation } from 'react-i18next'
import { VEHICLE_IDS } from '../constants/vehicles'
import type { VehicleTrajectoryEntry } from '../constants/vehicleTrajectoryCatalog'
import type { ParsedTrajectory } from '../types/trajectoryFile'
import { TrajectoryRawDataList } from './TrajectoryRawDataList'
import { Button, IconButton } from '../../../components/ui';

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
  const { t } = useTranslation()
  const fileInputRef = useRef<HTMLInputElement>(null)

  const showRawList =
    loadedTrajectory !== null &&
    loadedTrajectory.points.length > 0 &&
    (replayPlaying || replayHeadIndex !== null)

  return (
    <aside
      data-trajectory-panel
      className="flex h-full min-h-0 w-[22rem] shrink-0 flex-col border-l border-border-quaternary bg-surface-primary"
    >
      <div className="shrink-0 border-b border-border-quaternary px-3 py-2 text-body-xs-bold uppercase text-text-quaternary">
        {t('mapEditor.trajectory.title')}
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 flex flex-col gap-4 p-4 text-body-s">
          <div>
            <label
              htmlFor="vehicle-select"
              className="mb-1.5 block text-body-xs-bold text-text-tertiary"
            >
              {t('mapEditor.trajectory.vehicle')}
            </label>
            <div className="flex gap-2">
              <SiteSelect
                id="vehicle-select"
                value={selectedVehicleId ?? ''}
                onChange={(e) => {
                  const v = e.target.value
                  if (v) onVehicleIdChange(v)
                }}
                size="md" className="min-w-0 flex-1"
              >
                <option value="">{t('mapEditor.trajectory.selectVehicle')}</option>
                {VEHICLE_IDS.map((id) => (
                  <option key={id} value={id}>
                    {id}
                  </option>
                ))}
              </SiteSelect>
              <IconButton size="small" hierarchy="subordinate" variant="tonal" className="shrink-0" disabled={!hasTrajectory} onPress={onLocateVehicle} title={t('mapEditor.trajectory.locateTitle')} label={t('mapEditor.trajectory.locateAria')} icon={<LocateFixed />} />
            </div>
            <p className="mt-1.5 text-body-xs text-text-disabled">
              {t('mapEditor.trajectory.loadHint')}
            </p>
          </div>

          <div>
            <label
              htmlFor="traj-file-select"
              className="mb-1.5 block text-body-xs-bold text-text-tertiary"
            >
              {t('mapEditor.trajectory.fileList')}
            </label>
            <SiteSelect
              id="traj-file-select"
              value={selectedEntryId ?? ''}
              disabled={!selectedVehicleId || trajectoryEntries.length === 0}
              onChange={(e) => {
                const id = e.target.value
                if (id) onTrajectoryEntryChange(id)
              }}
              size="md" className="w-full"
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
            </SiteSelect>
          </div>

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              disabled={!hasTrajectory}
              onClick={replayPlaying ? onPause : onPlay}
              className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-lg border border-border-tertiary bg-surface-secondary px-3 py-2 text-body-xs-bold text-text-primary transition enabled:hover:bg-link-standard-hover disabled:cursor-not-allowed disabled:opacity-40"
            >
              {replayPlaying ? (
                <Pause className="size-4 shrink-0" aria-hidden />
              ) : (
                <Play className="size-4 shrink-0" aria-hidden />
              )}
              {replayPlaying ? t('mapEditor.trajectory.pause') : t('mapEditor.trajectory.play')}
            </button>
            <Button hierarchy="subordinate" variant="outlined" className="flex-1" leadingIcon={<RotateCcw />} disabled={!hasTrajectory} onPress={onRewind}>{t('mapEditor.trajectory.rewind')}</Button>
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
            <Button hierarchy="subordinate" variant="outlined" className="w-full" leadingIcon={<FolderOpen />} onPress={() => fileInputRef.current?.click()}>{t('mapEditor.trajectory.importJson')}</Button>
          </div>

          {mapMismatch && (
            <p className="text-body-xs text-amber-400/95">
              {t('mapEditor.trajectory.mapMismatch')}
            </p>
          )}
        </div>

        {showRawList && (
          <div className="flex min-h-0 flex-1 flex-col border-t border-border-quaternary">
            <div className="shrink-0 px-3 py-2 text-body-xs-bold uppercase text-text-quaternary">
              {t('mapEditor.trajectory.rawData')}
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
