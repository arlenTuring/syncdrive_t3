import { readFileSync, writeFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { dirname, join } from 'node:path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const mapPath = join(__dirname, '../public/maps/vtms-current.json')

const TRACK_DEFAULT = '#1e2a3a'
const TRACK_BLUE = '#3498db'
const TRACK_ORANGE = '#f39c12'
const TRACK_HIGHLIGHT = '#5dade2'

const ZONE_DEFAULT = '#1e2a3a'
const ZONE_BLUE = '#3498db'
const ZONE_RED = '#c0392b'
const ZONE_STATION_BLUE = '#2980b9'

/** 設計稿靜態填色（載入時無 MQTT 即顯示） */
const TRACK_FILL_BY_NAME = {
  D06: TRACK_ORANGE,
  D08: TRACK_ORANGE,
  D29: TRACK_BLUE,
  U04: TRACK_BLUE,
  U18: TRACK_HIGHLIGHT,
  D01: TRACK_BLUE,
  U03: TRACK_BLUE,
  U25: TRACK_BLUE,
}

const ZONE_FILL_BY_NAME = {
  'PR-NW': ZONE_RED,
  'PR-SW': ZONE_STATION_BLUE,
  'PR-S': ZONE_STATION_BLUE,
  E2: ZONE_BLUE,
  M3: ZONE_BLUE,
  P1: ZONE_STATION_BLUE,
  P2: ZONE_STATION_BLUE,
}

const ZONE_RENAME = {
  A1: 'PR-NW',
  A2: 'PR-SW',
  M4: 'PR-S',
}

const TRACK_MQTT_RULES = [
  { fieldPath: 'status', operator: 'eq', compareValue: 'occupied', color: TRACK_BLUE },
  { fieldPath: 'status', operator: 'eq', compareValue: 'warning', color: TRACK_ORANGE },
  { fieldPath: 'status', operator: 'eq', compareValue: 'error', color: '#e74c3c' },
]

const ZONE_MQTT_RULES = [
  { fieldPath: 'status', operator: 'eq', compareValue: 'occupied', color: ZONE_BLUE },
  { fieldPath: 'status', operator: 'eq', compareValue: 'warning', color: TRACK_ORANGE },
  { fieldPath: 'status', operator: 'eq', compareValue: 'error', color: ZONE_RED },
]

const TRACK_LABEL = {
  labelStyle: { visible: true, fontSizePx: 10, color: '#94a3b8' },
}

const ZONE_LABEL = {
  labelStyle: { visible: true, fontSizePx: 11, color: '#e2e8f0', fontWeight: 'bold' },
}

const map = JSON.parse(readFileSync(mapPath, 'utf8'))

let trackCount = 0
let zoneCount = 0
const names = new Set()

for (const f of map.facilities) {
  names.add(f.customName)
  if (f.type === 'Track') {
    trackCount++
    const seg = f.customName
    const fill = TRACK_FILL_BY_NAME[seg] ?? TRACK_DEFAULT
    f.parameters = {
      ...(f.parameters ?? {}),
      segmentId: f.parameters?.segmentId ?? seg,
      defaultFillColor: fill,
      colorRules: TRACK_MQTT_RULES,
      ...TRACK_LABEL,
    }
    delete f.currentState
  }

  if (f.type === 'Zone') {
    zoneCount++
    if (ZONE_RENAME[f.customName]) {
      f.customName = ZONE_RENAME[f.customName]
    }
    const zn = f.customName
    const fill = ZONE_FILL_BY_NAME[zn] ?? ZONE_DEFAULT
    f.parameters = {
      defaultFillColor: fill,
      colorRules: ZONE_MQTT_RULES,
      ...ZONE_LABEL,
      ...(f.parameters?.iconDisplay ? { iconDisplay: f.parameters.iconDisplay } : {}),
      ...(f.parameters?.customIconUrl
        ? { customIconUrl: f.parameters.customIconUrl }
        : {}),
    }
    delete f.parameters.remarks
    delete f.parameters.previewLiveValue
    delete f.parameters.mqttValuePath
    delete f.currentState
  }

  if (f.type === 'Geofence') {
    if (f.customName === 'GF-N2W') f.customName = 'N2W'
    if (f.customName === 'GF-S2W') f.customName = 'S2W'
    f.parameters = {
      ...(f.parameters ?? {}),
      strokeStyle: 'dashed',
      strokeColor: '#94a3b8',
      strokeWidthPx: 2,
      fillEnabled: false,
    }
  }
}

// 新增 P1 / P2 區域（設計稿右側月台）
if (!names.has('P1')) {
  map.facilities.push({
    id: '127',
    type: 'Zone',
    name: 'ZoneArea',
    customName: 'P1',
    positionMeters: { x: 838, y: 88 },
    rotationDeg: 0,
    sizeMeters: { w: 22, h: 16 },
    parameters: {
      defaultFillColor: ZONE_STATION_BLUE,
      colorRules: ZONE_MQTT_RULES,
      iconDisplay: 'builtin',
      ...ZONE_LABEL,
    },
  })
  zoneCount++
}
if (!names.has('P2')) {
  map.facilities.push({
    id: '128',
    type: 'Zone',
    name: 'ZoneArea',
    customName: 'P2',
    positionMeters: { x: 838, y: 152 },
    rotationDeg: 0,
    sizeMeters: { w: 22, h: 16 },
    parameters: {
      defaultFillColor: ZONE_STATION_BLUE,
      colorRules: ZONE_MQTT_RULES,
      iconDisplay: 'builtin',
      ...ZONE_LABEL,
    },
  })
  zoneCount++
}

map.description =
  '設計稿對齊版：軌道/區域支援 MQTT 填色規則；靜態預設色貼近設計稿。'
map.displayName = 'VTMS 設計稿對齊版'

writeFileSync(mapPath, `${JSON.stringify(map, null, 2)}\n`, 'utf8')
console.log('Updated', mapPath)
console.log({ tracks: trackCount, zones: zoneCount, facilities: map.facilities.length })
