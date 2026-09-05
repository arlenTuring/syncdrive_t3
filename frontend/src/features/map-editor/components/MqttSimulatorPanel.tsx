import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Palette, Radio, Trash2, X, Zap } from 'lucide-react'
import type { FacilityObject } from '../types/facility'
import type { MqttLiveEntry, MqttLogLine } from '../live/mqttLiveTypes'
import { buildMqttTopic } from '../live/mqttCategories'
import {
  MQTT_DEMO_BLINK_ENTITY,
  MQTT_DEMO_VEHICLE_ENTITY,
} from '../live/mqttDemoIds'
import { getMqttEntityId, getMqttTopicForFacility } from '../live/mqttEntityId'
import { mockMqttSingleton } from '../sim/mockMqtt'
import {
  buildMqttColorSimPayload,
  MQTT_COLOR_SIM_PALETTE,
  pickMqttColorSimTargets,
} from '../utils/mqttColorSimulation'

type MqttSimulatorPanelProps = {
  facilities: FacilityObject[]
  liveById: Record<string, MqttLiveEntry>
  mqttLog: MqttLogLine[]
  onClearLog: () => void
  onAddDemoNodes: () => void
  viewportCenterMeters: { x: number; y: number }
  hasDemoNodes: boolean
  /** 底部控制面板內嵌：無標題列 */
  embedded?: boolean
  onClose?: () => void
}

export function MqttSimulatorPanel({
  facilities,
  liveById,
  mqttLog,
  onClearLog,
  onAddDemoNodes,
  viewportCenterMeters,
  hasDemoNodes,
  embedded = false,
  onClose,
}: MqttSimulatorPanelProps) {
  const { t } = useTranslation()
  const [customTopic, setCustomTopic] = useState(() =>
    buildMqttTopic('Light/custom-1'),
  )
  const [customJson, setCustomJson] = useState(
    () => `{"entityId":"Light/custom-1","action":"blink"}`,
  )
  const vehicleTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const centerRef = useRef(viewportCenterMeters)
  centerRef.current = viewportCenterMeters
  const [vehicleLoop, setVehicleLoop] = useState(false)
  const colorSimTimerRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const colorSimStepRef = useRef(0)
  const [colorSimLoop, setColorSimLoop] = useState(false)

  const colorSimTargets = useMemo(
    () => pickMqttColorSimTargets(facilities, 6),
    [facilities],
  )

  const publish = useCallback((topic: string, payload: object) => {
    mockMqttSingleton.publish(topic, payload)
  }, [])

  const stopColorSimLoop = useCallback(() => {
    if (colorSimTimerRef.current) {
      clearInterval(colorSimTimerRef.current)
      colorSimTimerRef.current = null
    }
    setColorSimLoop(false)
  }, [])

  const publishColorSimStep = useCallback(
    (step: number) => {
      for (let i = 0; i < colorSimTargets.length; i++) {
        const target = colorSimTargets[i]!
        publish(
          target.topic,
          buildMqttColorSimPayload(
            target.facility,
            target.entityId,
            step + i,
          ),
        )
      }
    },
    [colorSimTargets, publish],
  )

  const runColorSimOnce = useCallback(() => {
    if (colorSimTargets.length === 0) {
      alert(t('mapEditor.mqttSim.noColorTargetsAlert'))
      return
    }
    publishColorSimStep(colorSimStepRef.current)
    colorSimStepRef.current += 1
  }, [colorSimTargets, publishColorSimStep, t])

  const toggleColorSimLoop = useCallback(() => {
    if (colorSimTimerRef.current) {
      stopColorSimLoop()
      return
    }
    if (colorSimTargets.length === 0) {
      alert(t('mapEditor.mqttSim.noColorTargetsAlert'))
      return
    }
    setColorSimLoop(true)
    publishColorSimStep(colorSimStepRef.current)
    colorSimStepRef.current += 1
    colorSimTimerRef.current = setInterval(() => {
      publishColorSimStep(colorSimStepRef.current)
      colorSimStepRef.current += 1
    }, 1200)
  }, [colorSimTargets, publishColorSimStep, stopColorSimLoop, t])

  const stopVehicleLoop = useCallback(() => {
    if (vehicleTimerRef.current) {
      clearInterval(vehicleTimerRef.current)
      vehicleTimerRef.current = null
    }
    setVehicleLoop(false)
  }, [])

  useEffect(() => () => {
    stopVehicleLoop()
    stopColorSimLoop()
  }, [stopVehicleLoop, stopColorSimLoop])

  const toggleVehicleLoop = useCallback(() => {
    if (vehicleTimerRef.current) {
      stopVehicleLoop()
      return
    }
    let step = 0
    setVehicleLoop(true)
    vehicleTimerRef.current = setInterval(() => {
      const { x: cx, y: cy } = centerRef.current
      const r = 22
      const x = cx + Math.cos(step) * r
      const y = cy + Math.sin(step) * r
      step += 0.32
      publish(buildMqttTopic(MQTT_DEMO_VEHICLE_ENTITY), {
        entityId: MQTT_DEMO_VEHICLE_ENTITY,
        positionMeters: {
          x: Math.round(x * 10) / 10,
          y: Math.round(y * 10) / 10,
        },
        rotationDeg: ((Math.round((step * 180) / Math.PI) % 360) + 360) % 360,
      })
    }, 450)
  }, [publish, stopVehicleLoop])

  const mqttRows = facilities

  return (
    <div
      className={
        embedded
          ? 'flex flex-col gap-2 p-3 text-xs text-zinc-300'
          : 'flex max-h-[min(78vh,calc(100vh-6rem))] w-full max-w-md flex-col rounded-lg border border-zinc-600 bg-zinc-900/98 shadow-xl backdrop-blur-sm'
      }
    >
      {!embedded ? (
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-zinc-600 px-3 py-2">
        <span className="flex min-w-0 items-center gap-2 text-sm font-medium text-zinc-100">
          <Radio className="size-4 shrink-0 text-amber-400" aria-hidden />
          <span className="truncate">{t('mapEditor.mqttSim.title')}</span>
        </span>
        {onClose ? (
        <button
          type="button"
          onClick={onClose}
          className="rounded p-1 text-zinc-400 transition hover:bg-zinc-800 hover:text-zinc-100 focus:outline-none focus:ring-2 focus:ring-cyan-500/50"
          title={t('mapEditor.mqttSim.closeTitle')}
          aria-label={t('mapEditor.mqttSim.closeAria')}
        >
          <X className="size-5" aria-hidden />
        </button>
        ) : null}
      </div>
      ) : null}

      <div
        className={
          embedded
            ? 'flex flex-wrap items-center gap-2 px-3 pb-3'
            : 'flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs text-zinc-300'
        }
      >
        {embedded ? (
          <>
            <button
              type="button"
              onClick={onAddDemoNodes}
              disabled={hasDemoNodes}
              className="rounded border border-amber-700/60 bg-amber-950/40 px-2 py-1 text-[11px] text-amber-100 enabled:hover:bg-amber-900/50 disabled:opacity-40"
            >
              {hasDemoNodes ? t('mapEditor.mqttSim.demoNodesReady') : t('mapEditor.mqttSim.demoNodesShort')}
            </button>
            <button
              type="button"
              onClick={() =>
                publish(buildMqttTopic(MQTT_DEMO_BLINK_ENTITY), {
                  entityId: MQTT_DEMO_BLINK_ENTITY,
                  action: 'blink',
                })
              }
              className="rounded border border-zinc-600/60 bg-zinc-900/50 px-2 py-1 text-[11px] hover:bg-zinc-800/60"
            >
              {t('mapEditor.mqttSim.blink')}
            </button>
            <button
              type="button"
              onClick={runColorSimOnce}
              disabled={colorSimTargets.length === 0}
              className="rounded border border-cyan-700/60 bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-100 enabled:hover:bg-cyan-900/50 disabled:opacity-40"
            >
              {t('mapEditor.mqttSim.recolor')}
            </button>
            <button
              type="button"
              onClick={toggleColorSimLoop}
              disabled={colorSimTargets.length === 0}
              className={`rounded border px-2 py-1 text-[11px] disabled:opacity-40 ${
                colorSimLoop
                  ? 'border-red-700/60 bg-red-950/50 text-red-200'
                  : 'border-zinc-600/60 bg-zinc-900/50 hover:bg-zinc-800/60'
              }`}
            >
              {colorSimLoop ? t('mapEditor.mqttSim.stopRecolor') : t('mapEditor.mqttSim.recolorLoop')}
            </button>
            <button
              type="button"
              onClick={toggleVehicleLoop}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                vehicleLoop
                  ? 'border-red-700/60 bg-red-950/50 text-red-200'
                  : 'border-zinc-600/60 bg-zinc-900/50 hover:bg-zinc-800/60'
              }`}
            >
              <Zap className="size-3" aria-hidden />
              {vehicleLoop ? t('mapEditor.mqttSim.stopVehicleLoop') : t('mapEditor.mqttSim.vehicleLoop')}
            </button>
            <button
              type="button"
              onClick={onClearLog}
              className="inline-flex items-center gap-1 rounded border border-zinc-600/50 px-2 py-1 text-[10px] text-zinc-400 hover:bg-zinc-800/50"
            >
              <Trash2 className="size-3" aria-hidden />
              {t('mapEditor.mqttSim.clearLog')}
            </button>
            <span className="font-mono text-[10px] text-zinc-500">
              {t('mapEditor.mqttSim.logStats', { logs: mqttLog.length, objects: mqttRows.length })}
            </span>
          </>
        ) : (
          <>
        <p className="leading-relaxed text-zinc-500">
          {t('mapEditor.mqttSim.signalBroadcastBefore')}{' '}
          <code className="rounded bg-zinc-800 px-1 text-[10px] text-cyan-300">
            mockMqttSingleton
          </code>{' '}
          {t('mapEditor.mqttSim.signalBroadcastMid')}{' '}
          <code className="text-cyan-300">entityId</code>
          {t('mapEditor.mqttSim.signalBroadcastAfter')}{' '}
          <code className="text-cyan-300">#</code>{' '}
          {t('mapEditor.mqttSim.signalBroadcastEnd')}
        </p>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={onAddDemoNodes}
            disabled={hasDemoNodes}
            className="rounded-md border border-amber-700/80 bg-amber-950/50 px-2 py-1.5 text-amber-100 transition enabled:hover:bg-amber-900/60 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {hasDemoNodes ? t('mapEditor.mqttSim.demoNodesReady') : t('mapEditor.mqttSim.demoNodesCreate')}
          </button>
        </div>

        <div className="rounded-md border border-zinc-700 bg-zinc-950/80 p-2">
          <div className="mb-1.5 flex items-center gap-1.5 font-medium text-zinc-400">
            <Palette className="size-3.5 text-cyan-400" aria-hidden />
            {t('mapEditor.mqttSim.colorSection')}
          </div>
          <p className="mb-2 leading-relaxed text-[10px] text-zinc-500">
            {t('mapEditor.mqttSim.colorTargetsHintBefore')}{' '}
            <code className="text-cyan-300">fillColor</code>{' '}
            {t('mapEditor.mqttSim.colorTargetsHintMid')}{' '}
            <code className="text-cyan-300">colorRules</code>{' '}
            {t('mapEditor.mqttSim.colorTargetsHintAfter')}
          </p>
          {colorSimTargets.length > 0 ? (
            <ul className="mb-2 space-y-0.5 font-mono text-[10px] text-zinc-500">
              {colorSimTargets.map((t) => (
                <li key={t.entityId}>
                  {t.label} · {t.entityId}
                </li>
              ))}
            </ul>
          ) : (
            <p className="mb-2 text-[10px] text-amber-400/90">
              {t('mapEditor.mqttSim.noColorTargets')}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={runColorSimOnce}
              disabled={colorSimTargets.length === 0}
              className="rounded border border-cyan-700/70 bg-cyan-950/40 px-2 py-1 text-[11px] text-cyan-100 enabled:hover:bg-cyan-900/50 disabled:cursor-not-allowed disabled:opacity-40"
            >
              {t('mapEditor.mqttSim.nextColors')}
            </button>
            <button
              type="button"
              onClick={toggleColorSimLoop}
              disabled={colorSimTargets.length === 0}
              className={`rounded border px-2 py-1 text-[11px] disabled:cursor-not-allowed disabled:opacity-40 ${
                colorSimLoop
                  ? 'border-red-700 bg-red-950/60 text-red-200'
                  : 'border-zinc-600 bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              {colorSimLoop ? t('mapEditor.mqttSim.stopRecolorLoop') : t('mapEditor.mqttSim.startRecolorLoop')}
            </button>
          </div>
          <div className="mt-2 flex flex-wrap gap-1">
            {MQTT_COLOR_SIM_PALETTE.map((c) => (
              <span
                key={c}
                className="size-4 rounded border border-zinc-600"
                style={{ backgroundColor: c }}
                title={c}
              />
            ))}
          </div>
        </div>

        <div className="rounded-md border border-zinc-700 bg-zinc-950/80 p-2">
          <div className="mb-1.5 font-medium text-zinc-400">{t('mapEditor.mqttSim.demoSection')}</div>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() =>
                publish(buildMqttTopic(MQTT_DEMO_BLINK_ENTITY), {
                  entityId: MQTT_DEMO_BLINK_ENTITY,
                  action: 'blink',
                })
              }
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700"
            >
              {t('mapEditor.mqttSim.blinkAction')}
            </button>
            <button
              type="button"
              onClick={() =>
                publish(buildMqttTopic(MQTT_DEMO_BLINK_ENTITY), {
                  entityId: MQTT_DEMO_BLINK_ENTITY,
                  action: 'highlight',
                })
              }
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700"
            >
              {t('mapEditor.mqttSim.highlight')}
            </button>
            <button
              type="button"
              onClick={() =>
                publish(buildMqttTopic(MQTT_DEMO_VEHICLE_ENTITY), {
                  entityId: MQTT_DEMO_VEHICLE_ENTITY,
                  positionMeters: {
                    x: Math.round(viewportCenterMeters.x * 10) / 10,
                    y: Math.round(viewportCenterMeters.y * 10) / 10,
                  },
                })
              }
              className="rounded border border-zinc-600 bg-zinc-800 px-2 py-1 text-[11px] hover:bg-zinc-700"
            >
              {t('mapEditor.mqttSim.moveToCenter')}
            </button>
            <button
              type="button"
              onClick={toggleVehicleLoop}
              className={`inline-flex items-center gap-1 rounded border px-2 py-1 text-[11px] ${
                vehicleLoop
                  ? 'border-red-700 bg-red-950/60 text-red-200'
                  : 'border-zinc-600 bg-zinc-800 hover:bg-zinc-700'
              }`}
            >
              <Zap className="size-3" aria-hidden />
              {vehicleLoop ? t('mapEditor.mqttSim.stopVehicleLoopFull') : t('mapEditor.mqttSim.vehicleLoopFull')}
            </button>
          </div>
        </div>

        <div>
          <div className="mb-1 font-medium text-zinc-400">{t('mapEditor.mqttSim.customPublish')}</div>
          <label className="sr-only" htmlFor="mqtt-custom-topic">
            topic
          </label>
          <input
            id="mqtt-custom-topic"
            value={customTopic}
            onChange={(e) => setCustomTopic(e.target.value)}
            className="mb-1 w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-cyan-200"
            placeholder="topic"
          />
          <textarea
            value={customJson}
            onChange={(e) => setCustomJson(e.target.value)}
            rows={3}
            className="w-full rounded border border-zinc-600 bg-zinc-950 px-2 py-1 font-mono text-[11px] text-zinc-200"
          />
          <button
            type="button"
            onClick={() => {
              try {
                const o = JSON.parse(customJson) as object
                publish(customTopic, o)
              } catch {
                alert(t('mapEditor.mqttSim.jsonError'))
              }
            }}
            className="mt-1 rounded border border-cyan-700 bg-cyan-950/50 px-2 py-1 text-[11px] text-cyan-100 hover:bg-cyan-900/50"
          >
            {t('mapEditor.mqttSim.publishTo', { topic: customTopic || t('mapEditor.mqttSim.emptyTopic') })}
          </button>
        </div>

        <div>
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-zinc-400">
              {t('mapEditor.mqttSim.objectsAndTopics', { count: mqttRows.length })}
            </span>
          </div>
          <ul className="max-h-28 space-y-1 overflow-y-auto rounded border border-zinc-700/80 bg-zinc-950/50 p-1.5 font-mono text-[10px] text-zinc-400">
            {mqttRows.length === 0 ? (
              <li>{t('mapEditor.mqttSim.noObjects')}</li>
            ) : (
              mqttRows.map((f) => {
                const eid = getMqttEntityId(f)
                const topicHint = getMqttTopicForFacility(f)
                const lr = liveById[eid]?.lastReceived
                return (
                  <li
                    key={f.id}
                    className="break-all border-b border-zinc-800/80 pb-1 last:border-0"
                  >
                    <span className="text-zinc-300">{f.customName || f.id}</span>
                    <br />
                    topic: {topicHint} · entity: {eid}
                    {lr && (
                      <>
                        <br />
                        <span className="text-amber-400/90">
                          {t('mapEditor.mqttSim.lastReceived', { topic: lr.topic })}
                        </span>
                      </>
                    )}
                  </li>
                )
              })
            )}
          </ul>
        </div>

        <div className="min-h-0 flex-1">
          <div className="mb-1 flex items-center justify-between">
            <span className="font-medium text-zinc-400">{t('mapEditor.mqttSim.messageLog')}</span>
            <button
              type="button"
              onClick={onClearLog}
              className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-[10px] text-zinc-500 hover:bg-zinc-800 hover:text-zinc-300"
            >
              <Trash2 className="size-3" aria-hidden />
              {t('mapEditor.mqttSim.clear')}
            </button>
          </div>
          <ul className="max-h-36 space-y-1 overflow-y-auto rounded border border-zinc-700/80 bg-black/40 p-1.5 font-mono text-[10px] leading-snug text-zinc-500">
            {mqttLog.length === 0 ? (
              <li className="text-zinc-600">{t('mapEditor.mqttSim.noMessages')}</li>
            ) : (
              mqttLog.map((line, i) => (
                <li
                  key={`${line.ts}-${i}`}
                  className="break-all border-b border-zinc-800/50 pb-1"
                >
                  <span className="text-zinc-600">
                    {new Date(line.ts).toLocaleTimeString()}
                  </span>{' '}
                  <span className="text-cyan-600">{line.topic}</span>
                  <br />
                  {line.payload.length > 120
                    ? `${line.payload.slice(0, 120)}…`
                    : line.payload}
                </li>
              ))
            )}
          </ul>
        </div>
          </>
        )}
      </div>
    </div>
  )
}
