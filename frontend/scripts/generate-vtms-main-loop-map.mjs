/**
 * 依 VTMS 主迴路設計稿產生 public/maps/vtms-main-loop.json
 * 執行：node frontend/scripts/generate-vtms-main-loop-map.mjs
 */
import { writeFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../public/maps/vtms-main-loop.json')

let idNum = 0
const nextId = () => String(++idNum).padStart(3, '0')

/** @param {Record<string, unknown>} entry */
function push(facilities, entry) {
  facilities.push({ id: nextId(), ...entry })
}

function track(customName, x, y, w, h, state = 'Idle', extra = {}) {
  push(facilities, {
    type: 'Track',
    name: 'Rail',
    customName,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w, h },
    currentState: state,
    parameters: { segmentId: customName, ...extra },
  })
}

function signal(customName, x, y, state = 'Normal') {
  push(facilities, {
    type: 'Signal',
    name: 'Light',
    customName,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w: 9, h: 9 },
    currentState: state,
    parameters: { signalId: customName },
  })
}

/** 區域設施（充電／洗車／維修／臨停／調度等，用途寫於 remarks） */
function zone(
  customName,
  x,
  y,
  w,
  h,
  remarks,
  state = 'Normal',
  extra = {},
) {
  const { colorRules, defaultFillColor, previewLiveValue, ...rest } = extra
  push(facilities, {
    type: 'Zone',
    name: 'ZoneArea',
    customName,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w, h },
    currentState: state,
    parameters: {
      remarks,
      defaultFillColor: defaultFillColor ?? '#1e293b',
      ...(colorRules ? { colorRules } : {}),
      ...(previewLiveValue ? { previewLiveValue } : {}),
      ...rest,
    },
  })
}

function pole(customName, x, y, w, h) {
  push(facilities, {
    type: 'Pole',
    name: 'SmartPole',
    customName,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w, h },
    currentState: 'Normal',
    parameters: { zoneId: customName },
  })
}

function geofence(customName, vertices, extra = {}) {
  const xs = vertices.map((v) => v[0])
  const ys = vertices.map((v) => v[1])
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  push(facilities, {
    type: 'Geofence',
    name: 'Geofence',
    customName,
    positionMeters: { x: x0, y: y0 },
    rotationDeg: 0,
    sizeMeters: {
      w: Math.max(...xs) - x0,
      h: Math.max(...ys) - y0,
    },
    currentState: 'Normal',
    parameters: {
      verticesMeters: vertices.map(([x, y]) => ({ x, y })),
      strokeStyle: 'dashed',
      strokeWidthPx: 3,
      strokeColor: '#a78bfa',
      fillEnabled: true,
      fillColor: 'rgba(139,92,246,0.12)',
      labels: [],
      ...extra,
    },
  })
}

function gate(customName, x, y, w, h) {
  push(facilities, {
    type: 'PSD',
    name: 'Gate',
    customName,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w, h },
    currentState: 'Closed',
    parameters: { terminalId: customName },
  })
}

const facilities = []

// ── 版面常數（公尺，對齊設計稿 S 型四層主軌） ──
const OX = 140
const Y1 = 150
const Y2 = 228
const Y3 = 306
const Y4 = 384
const W = 96
const H = 8
/** 橫向主軌段間距＝段寬，讓相鄰軌道橫邊相接無縫 */
const P = W
const LEFT = OX
const ROW_W = (n) => LEFT + (n - 1) * P
const H_SEG_W = 44

// ── 第 1 列 D16→D01（左→右） ──
for (let i = 0; i < 16; i++) {
  const n = 16 - i
  const label = `D${String(n).padStart(2, '0')}`
  const st = label === 'D06' ? 'Occupied' : 'Idle'
  track(label, ROW_W(1 + i), Y1, W, H, st, label === 'D06' ? { vehicleLabel: 'D0651 PM-01' } : {})
}

// ── 第 2 列 U18→U32 ──
for (let i = 0; i < 15; i++) {
  const label = `U${18 + i}`
  const st = label === 'U18' ? 'Occupied' : 'Idle'
  track(label, ROW_W(1 + i), Y2, W, H, st, label === 'U18' ? { vehicleLabel: 'U1854 PM-02' } : {})
}

// ── 第 3 列 U17→U01 ──
for (let i = 0; i < 17; i++) {
  const label = `U${String(17 - i).padStart(2, '0')}`
  const st = label === 'U02' ? 'Occupied' : 'Idle'
  track(label, ROW_W(1 + i), Y3, W, H, st, label === 'U02' ? { vehicleLabel: 'U0210 PM-01' } : {})
}

// ── 第 4 列 D21→D36 ──
for (let i = 0; i < 16; i++) {
  const label = `D${21 + i}`
  const st = label === 'D31' ? 'Occupied' : 'Idle'
  track(label, ROW_W(1 + i), Y4, W, H, st, label === 'D31' ? { vehicleLabel: 'D3151 PM-01' } : {})
}

// ── 左側迴路豎向／轉角 ──
const LX = LEFT - 52
track('D17', LX, Y1, W, H)
track('D18', LX, Y1 + 46, 8, 52)
track('D19', LX, Y3 - 8, 8, 52)
track('D20', LX, Y4, W, H)
track('T3', LX - 8, Y2 + 20, 8, 72)

// ── 右側匯流與終端 ──
const RX = ROW_W(17) + 24
track('T04', RX, Y1 + 4, 8, 56)
track('T03', RX + 12, Y2 + 4, 8, 56)
track('T02', RX, Y3 + 4, 8, 56)
track('T01', RX + 12, Y4 + 4, 8, 56)
gate('P2 DX101', RX + 28, Y1 - 2, 48, 4)
gate('P1 DX105', RX + 28, Y3 + 2, 48, 4)

// ── 上方支線（T05 → L4 → L1）與區域設施 ──
const BY = Y1 - 72
const BX = ROW_W(12)
track('T05', BX + 180, Y1 - 16, 8, 40)
track('L4', BX, BY + 28, H_SEG_W, 8)
track('L3', BX + H_SEG_W, BY + 28, H_SEG_W, 8)
track('L2', BX + H_SEG_W * 2, BY + 28, H_SEG_W, 8)
track('L1', BX + H_SEG_W * 3, BY + 28, H_SEG_W, 8)

zone(
  'A1',
  BX - 8,
  BY,
  48,
  36,
  '調度格 H01 — Holding Bay（PM-02）',
  'Occupied',
  {
    previewLiveValue: 'occupied',
    colorRules: [
      { matchValue: 'occupied', color: '#0e7490' },
      { matchValue: 'idle', color: '#334155' },
    ],
    mqttValuePath: 'status',
  },
)
zone(
  'A2',
  BX + 52,
  BY - 36,
  48,
  36,
  '保養格 M01 — Maintenance Space（PM-01）',
  'Normal',
  {
    defaultFillColor: '#422006',
    colorRules: [{ matchValue: 'working', color: '#ea580c' }],
  },
)

// ── 右上：洗車／充電區（區域設施） ──
const ZY = BY - 4
zone('W1', RX - 56, ZY, 36, 34, '洗車格 W01 — Wash Bay', 'Normal', {
  defaultFillColor: '#1e3a8a',
  colorRules: [{ matchValue: 'washing', color: '#38bdf8' }],
})
zone('E1', RX - 16, ZY, 28, 34, '充電格 E01 — EV Space', 'Occupied', {
  previewLiveValue: 'charging',
  colorRules: [{ matchValue: 'charging', color: '#059669' }],
  mqttValuePath: 'zoneValue',
})
zone('E2', RX + 16, ZY, 28, 34, '充電格 E02 — EV Space')
zone('E3', RX + 48, ZY, 28, 34, '充電格 E03 — EV Space')
zone('E4', RX + 80, ZY, 28, 34, '充電格 E04 — EV Space')
zone(
  'P01',
  RX + 28,
  Y1 - 28,
  48,
  20,
  '臨停格 P01 — Parking Space（P2 側）',
  'Normal',
  { defaultFillColor: '#312e81' },
)

// ── 下方支線（T06 → H1…H7）與維修區 ──
const HY = Y4 + 48
track('T06', LEFT + 8, Y4 + 16, 8, 40)
for (let i = 0; i < 7; i++) {
  track(`H${i + 1}`, LEFT + 40 + i * H_SEG_W, HY, H_SEG_W, 8)
}
zone(
  'M2',
  LEFT + 320,
  HY - 8,
  48,
  36,
  '充電格 E01 — EV Space（M2 維修／充電工位 PM-01）',
  'Occupied',
  {
    previewLiveValue: 'charging',
    colorRules: [
      { matchValue: 'charging', color: '#10b981' },
      { matchValue: 'repair', color: '#f97316' },
    ],
  },
)

// ── R 系列感測（設計稿黃／灰燈號） ──
const rTop = [
  ['R08', 0, 'Warning'],
  ['R09', 1, 'Normal'],
  ['R10', 2, 'Normal'],
  ['R11', 3, 'Warning'],
  ['R12', 4, 'Normal'],
]
rTop.forEach(([name, idx, st]) => signal(name, ROW_W(2 + idx * 3), Y1 - 22, st))
;[
  ['R07', Y2],
  ['R06', Y3],
].forEach(([name, y]) => signal(name, LX - 22, y + 8, 'Normal'))
;[
  ['R05', 0],
  ['R04', 1],
  ['R03', 2],
  ['R02', 3],
  ['R01', 4],
].forEach(([name, idx]) => signal(name, ROW_W(2 + idx * 3), Y3 - 22, 'Normal'))

// ── S 系列號誌 ──
;[
  ['S01', ROW_W(5), Y4 + 14],
  ['S02', ROW_W(15), Y3 - 18],
  ['S03', ROW_W(8), Y2 - 18],
  ['S04', LX - 18, Y4 - 12],
  ['S05', LX - 18, Y2 + 36],
  ['S06', ROW_W(11), Y4 + 14],
  ['S07', ROW_W(3), Y2 - 18],
  ['S08', ROW_W(12), Y3 - 18],
  ['S09', ROW_W(14), Y1 - 18, 'Offline'],
  ['S10', ROW_W(9), Y1 - 18, 'Offline'],
  ['S11', RX - 4, Y2 - 10, 'Warning'],
].forEach((row) => {
  const [name, x, y, st = 'Normal'] = row
  signal(name, x, y, st)
})

// ── 虛線區域（智慧桿標示 T3 / N2W / S2W） ──
pole('T3', LX - 4, Y2 + 12, 72, 88)
pole('N2W', ROW_W(14) - 8, Y2 - 6, 112, 72)
pole('S2W', ROW_W(15) - 8, Y3 - 6, 112, 72)

// ── mapCenter ──
let minX = Infinity
let minY = Infinity
let maxX = -Infinity
let maxY = -Infinity
for (const f of facilities) {
  const { x, y } = f.positionMeters
  const { w, h } = f.sizeMeters ?? { w: 10, h: 10 }
  minX = Math.min(minX, x)
  minY = Math.min(minY, y)
  maxX = Math.max(maxX, x + w)
  maxY = Math.max(maxY, y + h)
}

const doc = {
  schemaVersion: 1,
  mapId: 'vtms-main-loop',
  displayName: 'VTMS 主迴路圖台',
  description:
    '依設計稿：D/U 主軌、T 匯流、S/R 號誌、區域設施（E/W/M/P/H）與 P1/P2 終端。',
  coordinateSystem: {
    extentMeters: { width: 2000, height: 1000 },
    description: '原點在場域左上角；x 向右、y 向下。',
  },
  mapCenterMeters: {
    x: Math.round((minX + maxX) / 2),
    y: Math.round((minY + maxY) / 2),
  },
  facilities,
}

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`Wrote ${facilities.length} facilities → ${OUT}`)
console.log(`mapCenter: ${doc.mapCenterMeters.x}, ${doc.mapCenterMeters.y}`)
