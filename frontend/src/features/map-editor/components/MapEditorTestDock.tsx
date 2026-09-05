import { useState } from 'react'
import { ChevronDown, ChevronUp, Radio, ScanLine } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import type { FacilityObject } from '../types/facility'
import type { MqttLiveEntry, MqttLogLine } from '../live/mqttLiveTypes'
import type { ConnectivityScanState } from '../hooks/useTrackConnectivityScan'
import { MqttSimulatorPanel } from './MqttSimulatorPanel'
import { TrackConnectivityScanPanel } from './TrackConnectivityScanPanel'

export type MapEditorTestDockTab = 'connectivity' | 'mqtt'

type MapEditorTestDockProps = {
  facilities: FacilityObject[]
  liveById: Record<string, MqttLiveEntry>
  mqttLog: MqttLogLine[]
  onClearLog: () => void
  onAddDemoNodes: () => void
  viewportCenterMeters: { x: number; y: number }
  hasDemoNodes: boolean
  scanState: ConnectivityScanState
  onStartScan: () => void
  onContinueScan: () => void
  onStopScan: () => void
  onResetScan: () => void
  onSelectIssue: (trackId: string, areaId: string) => void
  /** 底部資產列展開時略上移 */
  paletteOpen?: boolean
}

export function MapEditorTestDock({
  facilities,
  liveById,
  mqttLog,
  onClearLog,
  onAddDemoNodes,
  viewportCenterMeters,
  hasDemoNodes,
  scanState,
  onStartScan,
  onContinueScan,
  onStopScan,
  onResetScan,
  onSelectIssue,
}: MapEditorTestDockProps) {
  const { t } = useTranslation()
  const [expanded, setExpanded] = useState(false)
  const [tab, setTab] = useState<MapEditorTestDockTab>('mqtt')

  const bottomClass = 'bottom-3'

  return (
    <div
      className={`pointer-events-none absolute left-3 right-3 z-[48] sm:left-4 sm:right-4 ${bottomClass}`}
      role="region"
      aria-label={t('mapEditor.testDock.aria')}
    >
      <div className="pointer-events-auto mx-auto flex max-w-5xl flex-col overflow-hidden rounded-xl border border-zinc-600/40 bg-zinc-950/45 shadow-lg backdrop-blur-md">
        <div className="flex shrink-0 items-center gap-2 border-b border-zinc-700/40 px-2 py-1.5 sm:px-3">
          <div
            className="flex rounded-lg border border-zinc-700/50 bg-zinc-900/40 p-0.5"
            role="tablist"
            aria-label={t('mapEditor.testDock.modeAria')}
          >
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'connectivity'}
              onClick={() => {
                setTab('connectivity')
                setExpanded(true)
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition sm:px-2.5 sm:text-xs ${
                tab === 'connectivity'
                  ? 'bg-cyan-950/70 text-cyan-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <ScanLine className="size-3.5 shrink-0" aria-hidden />
              {t('mapEditor.testDock.connectivity')}
            </button>
            <button
              type="button"
              role="tab"
              aria-selected={tab === 'mqtt'}
              onClick={() => {
                setTab('mqtt')
                setExpanded(true)
              }}
              className={`inline-flex items-center gap-1 rounded-md px-2 py-1 text-[11px] font-medium transition sm:px-2.5 sm:text-xs ${
                tab === 'mqtt'
                  ? 'bg-amber-950/60 text-amber-200'
                  : 'text-zinc-400 hover:text-zinc-200'
              }`}
            >
              <Radio className="size-3.5 shrink-0" aria-hidden />
              MQTT
            </button>
          </div>

          <div className="min-w-0 flex-1 truncate text-[10px] text-zinc-500 sm:text-[11px]">
            {tab === 'connectivity' ? (
              <>
                {scanState.phase === 'scanning' &&
                  t('mapEditor.testDock.scanningProbes', {
                    percent: scanState.progressPercent.toFixed(0),
                    active: scanState.activeProbeCount,
                    max: scanState.maxConcurrentProbes,
                  })}
                {scanState.phase === 'flashing' && t('mapEditor.testDock.flashing')}
                {scanState.phase === 'complete' &&
                  (scanState.totalIssues === 0
                    ? t('mapEditor.testDock.completeOk', { probes: scanState.totalProbeCount })
                    : t('mapEditor.testDock.completeIssues', {
                        probes: scanState.totalProbeCount,
                        issues: scanState.totalIssues,
                      }))}
                {scanState.phase === 'idle' && t('mapEditor.testDock.idle')}
              </>
            ) : (
              t('mapEditor.testDock.mqttHint')
            )}
          </div>

          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="rounded-md p-1 text-zinc-400 hover:bg-zinc-800/60 hover:text-zinc-200"
            title={expanded ? t('mapEditor.testDock.collapse') : t('mapEditor.testDock.expand')}
            aria-expanded={expanded}
          >
            {expanded ? (
              <ChevronDown className="size-4" aria-hidden />
            ) : (
              <ChevronUp className="size-4" aria-hidden />
            )}
          </button>
        </div>

        {expanded ? (
          <div className="max-h-[min(38vh,220px)] overflow-y-auto">
            {tab === 'connectivity' ? (
              <TrackConnectivityScanPanel
                embedded
                scanState={scanState}
                onStart={onStartScan}
                onContinue={onContinueScan}
                onStop={onStopScan}
                onReset={onResetScan}
                onSelectIssue={onSelectIssue}
              />
            ) : (
              <MqttSimulatorPanel
                embedded
                facilities={facilities}
                liveById={liveById}
                mqttLog={mqttLog}
                onClearLog={onClearLog}
                onAddDemoNodes={onAddDemoNodes}
                viewportCenterMeters={viewportCenterMeters}
                hasDemoNodes={hasDemoNodes}
              />
            )}
          </div>
        ) : null}
      </div>
    </div>
  )
}
