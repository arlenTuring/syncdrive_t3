import { isSlotEquipmentState, isSlotOccupancy } from '../constants/states'
import type { MqttLiveEntry } from './mqttLiveTypes'
import { parseOpenPercentFromPayload } from '../utils/psdOpenPercent'
import { parseSignalLamp } from '../utils/signalFacility'

function readFillColor(o: Record<string, unknown>): string | undefined {
  for (const key of ['fillColor', 'color', 'fill']) {
    const v = o[key]
    if (typeof v === 'string' && v.trim()) return v.trim()
  }
  return undefined
}

/** 解析 JSON payload，合併進既有 LiveEntry */
export function mergePayloadIntoLive(
  prev: MqttLiveEntry | undefined,
  topic: string,
  payloadStr: string,
): MqttLiveEntry {
  let o: Record<string, unknown>
  try {
    o = JSON.parse(payloadStr) as Record<string, unknown>
  } catch {
    return {
      ...prev,
      lastReceived: { topic, at: Date.now(), preview: payloadStr.slice(0, 160) },
    }
  }

  const next: MqttLiveEntry = {
    ...prev,
    lastReceived: { topic, at: Date.now(), preview: payloadStr.slice(0, 160) },
    payloadObject: o,
  }

  const pm = o.positionMeters
  if (pm && typeof pm === 'object' && pm !== null) {
    const x = (pm as { x?: unknown }).x
    const y = (pm as { y?: unknown }).y
    if (typeof x === 'number' && typeof y === 'number') {
      next.positionMeters = { x, y }
    }
  }

  if (typeof o.rotationDeg === 'number') {
    next.rotationDeg = o.rotationDeg
  }

  if (isSlotOccupancy(o.slotOccupancy)) {
    next.slotOccupancy = o.slotOccupancy
  }
  if (isSlotEquipmentState(o.slotEquipmentState)) {
    next.slotEquipmentState = o.slotEquipmentState
  }

  const openPct = parseOpenPercentFromPayload(o)
  if (openPct !== undefined) {
    next.psdOpenPercent = openPct
  }
  if (typeof o.alarm === 'boolean') {
    next.psdAlarm = o.alarm
  } else if (typeof o.isAlarm === 'boolean') {
    next.psdAlarm = o.isAlarm
  } else if (o.state === 'Alarm' || o.psdState === 'Alarm') {
    next.psdAlarm = true
  }

  const action = o.action
  const vs = o.visualState
  if (action === 'blink' || vs === 'alert' || vs === 'blink') {
    next.blinkSeq = (prev?.blinkSeq ?? 0) + 1
  }
  if (action === 'highlight' || vs === 'highlight') {
    next.highlightSeq = (prev?.highlightSeq ?? 0) + 1
    next.highlightUntil = Date.now() + 900
  }

  const fillColor = readFillColor(o)
  if (fillColor) {
    next.fillColor = fillColor
  }

  const lamp = parseSignalLamp(o.lamp)
  if (lamp) {
    next.signalLamp = lamp
  }

  return next
}
