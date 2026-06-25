/**
 * 產生 T3 軌道場域 schema v2 範例（3840×1080，七 Area 依設計稿 domain 排版）
 * 執行：node frontend/scripts/generate-t3-rail-yard-map.mjs
 */
import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'

const __dirname = dirname(fileURLToPath(import.meta.url))
const OUT = join(__dirname, '../public/maps/t3-rail-yard.json')

const MAP_W = 3840
const MAP_H = 1080

/** 軌道窄邊寬度（公尺） */
const TRACK_RAIL_WIDTH = 3.5

/** 設計稿全圖 domain 範圍（公尺） */
const DOMAIN_X_MAX = 960
const DOMAIN_Y_MIN = 20
const DOMAIN_Y_MAX = 400

function layoutFromDomain(domain) {
  const xScale = MAP_W / DOMAIN_X_MAX
  const yScale = MAP_H / (DOMAIN_Y_MAX - DOMAIN_Y_MIN)
  return {
    xPx: Math.round(domain.xMinM * xScale),
    yPx: Math.round((DOMAIN_Y_MAX - domain.yMaxM) * yScale),
    wPx: Math.round((domain.xMaxM - domain.xMinM) * xScale),
    hPx: Math.round((domain.yMaxM - domain.yMinM) * yScale),
    borderPx: 0,
    borderColor: 'transparent',
  }
}

function domainSpan(domain) {
  return {
    w: Math.max(0.001, domain.xMaxM - domain.xMinM),
    h: Math.max(0.001, domain.yMaxM - domain.yMinM),
  }
}

function meterToAreaLocalPx(xM, yM, domain, layout) {
  const span = domainSpan(domain)
  return {
    x: (xM - domain.xMinM) * (layout.wPx / span.w),
    y: (yM - domain.yMinM) * (layout.hPx / span.h),
  }
}

function meterSizeToAreaLocalPx(wM, hM, domain, layout) {
  const span = domainSpan(domain)
  return {
    w: wM * (layout.wPx / span.w),
    h: hM * (layout.hPx / span.h),
  }
}

function roundN(n, dp = 4) {
  const f = 10 ** dp
  return Math.round(n * f) / f
}

/** 補齊 Area 內雙座標（與 mapFileJson 設計一致） */
function finalizeAreaFacilities(areaKey) {
  const area = AREAS[areaKey]
  byArea[areaKey] = byArea[areaKey].map((f) => {
    const ap = meterToAreaLocalPx(
      f.positionMeters.x,
      f.positionMeters.y,
      area.domain,
      area.layout,
    )
    const areaPosition = { x: roundN(ap.x), y: roundN(ap.y) }
    const areaLayoutAnchor = { wPx: area.layout.wPx, hPx: area.layout.hPx }
    const areaSizePx = f.sizeMeters
      ? {
          w: roundN(
            meterSizeToAreaLocalPx(
              f.sizeMeters.w,
              f.sizeMeters.h,
              area.domain,
              area.layout,
            ).w,
          ),
          h: roundN(
            meterSizeToAreaLocalPx(
              f.sizeMeters.w,
              f.sizeMeters.h,
              area.domain,
              area.layout,
            ).h,
          ),
        }
      : undefined
    return {
      ...f,
      areaPosition,
      areaLayoutAnchor,
      ...(areaSizePx ? { areaSizePx } : {}),
    }
  })
}

/** 七 Area 依設計稿 A–G 分區（domain 公尺） */
const AREA_DEFS = {
  A: {
    id: 'area-a',
    customName: 'Area A · N2W 站台',
    domain: { xMinM: 640, xMaxM: 960, yMinM: 340, yMaxM: 415 },
  },
  B: {
    id: 'area-b',
    customName: 'Area B · 下行正線過渡軌道',
    domain: { xMinM: 0, xMaxM: 640, yMinM: 380, yMaxM: 405 },
  },
  C: {
    id: 'area-c',
    customName: 'Area C · 上行正線過渡軌道',
    domain: { xMinM: 80, xMaxM: 640, yMinM: 360, yMaxM: 380 },
  },
  D: {
    id: 'area-d',
    customName: 'Area D · T3 站台',
    domain: { xMinM: 50, xMaxM: 100, yMinM: 20, yMaxM: 355 },
  },
  E: {
    id: 'area-e',
    customName: 'Area E · 下行正線過渡區',
    domain: { xMinM: 0, xMaxM: 640, yMinM: 40, yMaxM: 80 },
  },
  F: {
    id: 'area-f',
    customName: 'Area F · 上行正線過渡區',
    domain: { xMinM: 100, xMaxM: 640, yMinM: 80, yMaxM: 100 },
  },
  G: {
    id: 'area-g',
    customName: 'Area G · S2W 站台',
    domain: { xMinM: 640, xMaxM: 960, yMinM: 40, yMaxM: 112 },
  },
}

const AREAS = Object.fromEntries(
  Object.entries(AREA_DEFS).map(([key, def]) => [
    key,
    { ...def, layout: layoutFromDomain(def.domain) },
  ]),
)

let idNum = 0
const nextId = () => String(++idNum).padStart(3, '0')

/** @type {Record<string, unknown[]>} */
const byArea = Object.fromEntries(Object.keys(AREAS).map((k) => [k, []]))

function areaKeyForPoint(x, y) {
  /** 較窄／較高優先，避免相鄰帶誤判 */
  const order = ['B', 'C', 'F', 'E', 'A', 'G', 'D']
  for (const key of order) {
    const d = AREAS[key].domain
    if (x >= d.xMinM && x < d.xMaxM && y >= d.yMinM && y < d.yMaxM) return key
  }
  return 'B'
}

function pushArea(areaKey, entry) {
  byArea[areaKey].push({ id: nextId(), ...entry })
}

function pushAt(areaKey, entry) {
  byArea[areaKey].push({ id: nextId(), ...entry })
}

function trackAt(areaKey, label, x, y, w, h, rot = 0, extra = {}) {
  pushAt(areaKey, {
    type: 'Track',
    name: 'Rail',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: rot,
    sizeMeters: { w, h },
    currentState: 'Idle',
    parameters: {
      segmentId: label,
      defaultFillColor: '#1a2233',
      labelStyle: { fontSizePx: 16, color: '#cbd5e1' },
      ...extra,
    },
  })
}

function facilityAt(areaKey, label, x, y, w, h, remarks, extra = {}) {
  const { defaultFillColor, ...rest } = extra
  pushAt(areaKey, {
    type: 'Facility',
    name: 'FacilityArea',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w, h },
    currentState: 'Normal',
    parameters: {
      remarks,
      defaultFillColor: defaultFillColor ?? '#1a2233',
      ...rest,
    },
  })
}

/** 智慧桿：獨立圖示設施（非軌道內嵌） */
function smartPoleAt(areaKey, label, x, y) {
  pushAt(areaKey, {
    type: 'Facility',
    name: 'FacilityArea',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w: 8, h: 14 },
    currentState: 'Normal',
    parameters: {
      remarks: `智慧桿 ${label}`,
      iconDisplay: 'custom',
      customIconUrl: 'facility/smart_pole_enable.png',
      defaultFillColor: 'transparent',
      labelStyle: { fontSizePx: 16, color: '#e2e8f0' },
    },
  })
}

function signalAt(areaKey, label, x, y, mountDirection = 'down', defaultLamp = 'offline') {
  pushAt(areaKey, {
    type: 'Signal',
    name: 'Light',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w: 12, h: 12 },
    currentState: 'Normal',
    parameters: { mountDirection, defaultLamp, signalId: label },
  })
}

function geofenceAt(areaKey, label, vertices, fillColor, labelX, labelY) {
  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  pushAt(areaKey, {
    type: 'Geofence',
    name: 'Geofence',
    customName: label,
    positionMeters: { x: x0, y: y0 },
    rotationDeg: 0,
    sizeMeters: { w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
    currentState: 'Normal',
    parameters: {
      verticesMeters: vertices,
      strokeStyle: 'dashed',
      strokeWidthPx: 2,
      strokeColor: '#e2e8f0',
      fillEnabled: true,
      fillColor,
      labels: [
        {
          id: `lbl-${label}`,
          text: label,
          x: labelX,
          y: labelY,
          fontSizePx: 16,
          fontWeight: 'bold',
        },
      ],
    },
  })
}

/**
 * Area A · N2W 站台（設計稿 A）
 * domain 640–960 × 340–400 m
 */
function buildAreaA() {
  const AK = 'A'
  const X0 = 640
  const Y0 = 340
  const COL_W = 44
  const col = (i) => X0 + 14 + i * COL_W
  const segW = COL_W
  const segH = TRACK_RAIL_WIDTH
  const thinH = TRACK_RAIL_WIDTH

  const yT = Y0 + 5
  const yFac = Y0 + 16
  const yD = Y0 + 38
  const yU = Y0 + 54

  const trackHighlight = { defaultFillColor: '#0e7490' }

  // 上方匯流 T10→T06（相連）
  for (let i = 0; i < 5; i++) {
    trackAt(AK, `T${String(10 - i).padStart(2, '0')}`, col(i), yT, segW, thinH)
  }
  // T05 自 T 線垂直接至 D 線（D03/D02 交界）
  const t05X = col(3) + segW - 2
  trackAt(AK, 'T05', t05X, yT, thinH, yD - yT + segH)

  // 洗車／充電（W1 較寬、紅底；E 格等寬藍底）
  facilityAt(AK, 'W1', col(0), yFac, segW, 16, '洗車格 W1', {
    defaultFillColor: '#4a1a1a',
  })
  ;[
    ['E4', 1],
    ['E3', 2],
    ['E2', 3],
    ['E1', 4],
  ].forEach(([label, ci]) => {
    facilityAt(AK, label, col(ci), yFac, segW, 16, `${label} 充電格`, {
      defaultFillColor: '#1e3a8a',
    })
  })

  // 外迴路 R06 + D05→D01（相連厚軌）
  trackAt(AK, 'R06', col(0), yD, segW, segH)
  for (let i = 0; i < 5; i++) {
    const label = `D${String(5 - i).padStart(2, '0')}`
    const highlight = label === 'D02' ? trackHighlight : {}
    trackAt(AK, label, col(i + 1), yD, segW, segH, 0, highlight)
  }

  // 內迴路 U27–U32（相連）
  for (let i = 0; i < 6; i++) {
    const label = `U${27 + i}`
    const highlight = label === 'U31' ? trackHighlight : {}
    trackAt(AK, label, col(i), yU, segW, segH, 0, highlight)
  }

  // 智慧桿 R11（D05/D04 上）、R12（D01 上）
  smartPoleAt(AK, 'R11', col(1) + segW / 2 - 4, yD - 10)
  smartPoleAt(AK, 'R12', col(5) + segW / 2 - 4, yD - 10)

  // 右側匯流 T04／T03 → P2（斜軌相接 D01 / U32 右端）
  const rx = col(5) + segW + 10
  trackAt(AK, 'T04', rx, yD, TRACK_RAIL_WIDTH, 18, 38)
  trackAt(AK, 'T03', rx, yU + segH - 2, TRACK_RAIL_WIDTH, 18, -38)
  facilityAt(AK, 'P2', rx + 8, Y0 + 28, 24, 34, '月台 P2', {
    defaultFillColor: '#312e81',
  })

  // N2W 電子圍籬（D02 與 U31）
  const gfX = col(3) - 6
  const gfW = COL_W + 10
  geofenceAt(
    AK,
    'N2W',
    [
      { x: gfX, y: yD - 5 },
      { x: gfX + gfW, y: yD - 5 },
      { x: gfX + gfW, y: yU + segH + 6 },
      { x: gfX, y: yU + segH + 6 },
    ],
    'rgba(56,189,248,0.08)',
    gfX + gfW / 2,
    yU + segH + 14,
  )

  signalAt(AK, 'S11', rx + 6, yD + 10, 'left')
}

/**
 * Area B · 下行正線過渡軌道（設計稿 B）
 * domain 0–640 × 380–400 m；U18→U26
 */
function buildAreaB() {
  const AK = 'B'
  const X0 = 100
  const Y0 = 380
  const N = 9
  const COL_W = 58
  const col = (i) => X0 + 14 + i * COL_W
  const segW = COL_W
  const segH = TRACK_RAIL_WIDTH
  const yU = Y0 + 10

  for (let i = 0; i < N; i++) {
    trackAt(AK, `U${18 + i}`, col(i), yU, segW, segH)
  }

  signalAt(AK, 'S07', col(1) - 6, yU + segH - 2, 'up', 'green')
  signalAt(AK, 'S09', col(7) - 6, yU + segH - 2, 'up', 'green')
}

/**
 * Area C · 上行正線過渡軌道（設計稿 C）
 * domain 80–640 × 360–380 m；D15→D07
 */
function buildAreaC() {
  const AK = 'C'
  const X0 = 100
  const Y0 = 360
  const N = 9
  const COL_W = 58
  const col = (i) => X0 + 14 + i * COL_W
  const segW = COL_W
  const segH = TRACK_RAIL_WIDTH
  const yD = Y0 + 10

  for (let i = 0; i < N; i++) {
    trackAt(AK, `D${String(15 - i).padStart(2, '0')}`, col(i), yD, segW, segH)
  }

  smartPoleAt(AK, 'R08', col(0) + segW / 2 - 4, yD - 10)
  smartPoleAt(AK, 'R09', col(3) + segW / 2 - 4, yD - 10)
  smartPoleAt(AK, 'R10', col(7) + segW / 2 - 4, yD - 10)

  signalAt(AK, 'S08', col(1) - 6, yD - 10, 'down', 'red')
  signalAt(AK, 'S10', col(6) - 6, yD - 10, 'down', 'red')
}

/**
 * Area D · T3 站台（設計稿 D）
 * domain 50–100 × 20–340 m
 */
function buildAreaD() {
  const AK = 'D'
  const X0 = 50
  const X_MAX = 100
  const xOuter = X0 + 24
  const xInner = xOuter + 18
  const thick = TRACK_RAIL_WIDTH
  const horizW = X_MAX - xOuter
  const vertH = 66
  const trackHighlight = { defaultFillColor: '#0e7490' }

  const yD16 = 336
  const yD21 = 84
  const yD20 = yD21 + thick
  const yD19 = yD20 + vertH
  const yD18 = yD19 + vertH
  const yD17 = yD18 + vertH

  trackAt(AK, 'D16', xOuter, yD16, horizW, thick)
  trackAt(AK, 'D17', xOuter, yD17, thick, vertH)
  trackAt(AK, 'D18', xOuter, yD18, thick, vertH)
  trackAt(AK, 'D19', xOuter, yD19, thick, vertH, 0, trackHighlight)
  trackAt(AK, 'D20', xOuter, yD20, thick, vertH)
  trackAt(AK, 'D21', xOuter, yD21, horizW, thick)

  trackAt(AK, 'U17', xInner, yD18, thick, yD16 + thick - yD18)
  trackAt(AK, 'U16', xInner, yD19, thick, vertH, 0, trackHighlight)

  smartPoleAt(AK, 'R07', xOuter - 10, yD17 + vertH / 2 - 7)
  smartPoleAt(AK, 'R06', xOuter - 10, yD20 + vertH / 2 - 7)

  signalAt(AK, 'S05', xInner - 14, yD18 + 8, 'left', 'green')
  signalAt(AK, 'S06', xOuter - 14, yD19 - 6, 'left', 'green')

  const gfY0 = yD19 - 5
  const gfY1 = yD19 + vertH + 5
  const xFenceRight = X_MAX - 1
  geofenceAt(
    AK,
    'T3',
    [
      { x: xOuter - 10, y: gfY0 },
      { x: xFenceRight, y: gfY0 },
      { x: xFenceRight, y: gfY1 },
      { x: xOuter - 10, y: gfY1 },
    ],
    'rgba(56,189,248,0.08)',
    xInner + thick + 4,
    yD19 + vertH / 2,
  )
}

/**
 * Area E · 下行正線過渡區（設計稿 E）
 * domain 0–640 × 40–80 m；D22→D30 / T11–T18 / H·M 整備格
 */
function buildAreaE() {
  const AK = 'E'
  const X0 = 100
  const Y0 = 40
  const N = 9
  const COL_W = 58
  const col = (i) => X0 + 14 + i * COL_W
  const segW = COL_W
  const segH = TRACK_RAIL_WIDTH
  const thinH = TRACK_RAIL_WIDTH

  const yD = Y0 + 22
  const yFac = Y0 + 30
  const yT = Y0 + 36

  for (let i = 0; i < N; i++) {
    trackAt(AK, `D${22 + i}`, col(i), yD, segW, segH)
  }

  for (let i = 0; i < 7; i++) {
    trackAt(AK, `T${12 + i}`, col(i), yT, segW, thinH)
  }

  const t11X = col(0) - 6
  trackAt(AK, 'T11', t11X, yD, thinH, yT - yD + thinH)
  trackAt(AK, '·', t11X, yT, col(0) - t11X, thinH, 0, {
    segmentId: 'T11_h',
    labelStyle: { visible: false },
  })

  ;[
    ['H1', 0, '#1e3a8a', '整備格 H1'],
    ['H2', 1, '#1e3a8a', '整備格 H2'],
    ['H3', 2, '#1e3a8a', '整備格 H3'],
    ['M1', 3, '#312e81', '保養格 M1'],
    ['M2', 4, '#312e81', '保養格 M2'],
    ['M3', 5, '#312e81', '保養格 M3'],
    ['M4', 6, '#312e81', '保養格 M4'],
  ].forEach(([label, ci, color, remarks]) => {
    facilityAt(AK, label, col(ci), yFac, segW, 8, remarks, {
      defaultFillColor: color,
    })
  })

  smartPoleAt(AK, 'R05', col(1) - 6, yD - 8)
  smartPoleAt(AK, 'R04', col(3) - 6, yD - 8)
  smartPoleAt(AK, 'R03', col(7) - 6, yD - 8)

  signalAt(AK, 'S04', col(5) - 6, yD - 8, 'down', 'red')
}

/**
 * Area F · 上行正線過渡區（設計稿 F）
 * domain 100–640 × 80–100 m；U15→U07
 */
function buildAreaF() {
  const AK = 'F'
  const X0 = 100
  const Y0 = 80
  const N = 9
  const COL_W = 58
  const col = (i) => X0 + 14 + i * COL_W
  const segW = COL_W
  const segH = TRACK_RAIL_WIDTH
  const yU = Y0 + 10

  for (let i = 0; i < N; i++) {
    trackAt(AK, `U${15 - i}`, col(i), yU, segW, segH)
  }

  signalAt(AK, 'S03', col(5) + segW / 2 - 6, yU - 8, 'up', 'green')
}

/**
 * Area G · S2W 站台（設計稿 G）
 * domain 640–960 × 40–100 m
 */
function buildAreaG() {
  const AK = 'G'
  const X0 = 640
  const Y0 = 40
  const N = 6
  const COL_W = 44
  const col = (i) => X0 + 14 + i * COL_W
  const segW = COL_W
  const segH = TRACK_RAIL_WIDTH

  const yU = Y0 + 26
  const yD = Y0 + 42
  const trackHighlight = { defaultFillColor: '#0e7490' }

  for (let i = 0; i < N; i++) {
    const label = `U${String(6 - i).padStart(2, '0')}`
    const highlight = label === 'U02' ? trackHighlight : {}
    trackAt(AK, label, col(i), yU, segW, segH, 0, highlight)
  }

  for (let i = 0; i < N; i++) {
    const label = `D${31 + i}`
    const highlight = label === 'D35' ? trackHighlight : {}
    trackAt(AK, label, col(i), yD, segW, segH, 0, highlight)
  }

  const rx = col(N - 1) + segW + 10
  trackAt(AK, 'T02', rx, yU, TRACK_RAIL_WIDTH, 18, -38)
  trackAt(AK, 'T01', rx, yD + segH - 2, TRACK_RAIL_WIDTH, 18, 38)
  facilityAt(AK, 'P2', rx + 8, Y0 + 36, 24, 34, '月台 P2', {
    defaultFillColor: '#312e81',
  })

  smartPoleAt(AK, 'R02', col(2) + segW / 2 - 4, yU - 10)
  smartPoleAt(AK, 'R01', col(5) + segW / 2 - 4, yU - 10)

  signalAt(AK, 'S01', col(1) - 6, yU - 18, 'up', 'green')
  signalAt(AK, 'S02', col(0) + segW - 6, yD - 10, 'down', 'red')

  const gfX = col(4) - 6
  const gfW = COL_W + 10
  geofenceAt(
    AK,
    'S2W',
    [
      { x: gfX, y: yU - 5 },
      { x: gfX + gfW, y: yU - 5 },
      { x: gfX + gfW, y: yD + segH + 6 },
      { x: gfX, y: yD + segH + 6 },
    ],
    'rgba(56,189,248,0.08)',
    gfX + gfW / 2,
    yD + segH + 14,
  )
}

function track(label, x, y, w, h, rot = 0, extra = {}) {
  const cx = x + w / 2
  const cy = y + h / 2
  pushArea(areaKeyForPoint(cx, cy), {
    type: 'Track',
    name: 'Rail',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: rot,
    sizeMeters: { w, h },
    currentState: 'Idle',
    parameters: { segmentId: label, labelStyle: { fontSizePx: 16 }, ...extra },
  })
}

function facility(label, x, y, w, h, remarks, extra = {}) {
  pushArea(areaKeyForPoint(x + w / 2, y + h / 2), {
    type: 'Facility',
    name: 'FacilityArea',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w, h },
    currentState: 'Normal',
    parameters: {
      remarks,
      defaultFillColor: extra.defaultFillColor ?? '#1e293b',
      ...extra,
    },
  })
}

function pole(label, x, y) {
  pushArea(areaKeyForPoint(x, y), {
    type: 'Pole',
    name: 'SmartPole',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w: 4, h: 4 },
    currentState: 'Normal',
    parameters: { poleId: label },
  })
}

function signal(label, x, y, mountDirection = 'down', defaultLamp = 'offline') {
  pushArea(areaKeyForPoint(x, y), {
    type: 'Signal',
    name: 'Light',
    customName: label,
    positionMeters: { x, y },
    rotationDeg: 0,
    sizeMeters: { w: 12, h: 12 },
    currentState: 'Normal',
    parameters: { mountDirection, defaultLamp, signalId: label },
  })
}

function geofence(label, vertices, fillColor, labelY) {
  const xs = vertices.map((v) => v.x)
  const ys = vertices.map((v) => v.y)
  const x0 = Math.min(...xs)
  const y0 = Math.min(...ys)
  const cx = (Math.min(...xs) + Math.max(...xs)) / 2
  const cy = (Math.min(...ys) + Math.max(...ys)) / 2
  pushArea(areaKeyForPoint(cx, cy), {
    type: 'Geofence',
    name: 'Geofence',
    customName: label,
    positionMeters: { x: x0, y: y0 },
    rotationDeg: 0,
    sizeMeters: { w: Math.max(...xs) - x0, h: Math.max(...ys) - y0 },
    currentState: 'Normal',
    parameters: {
      verticesMeters: vertices,
      strokeStyle: 'dashed',
      strokeWidthPx: 2,
      strokeColor: '#38bdf8',
      fillEnabled: true,
      fillColor,
      labels: [
        {
          id: `lbl-${label}`,
          text: label,
          x: cx,
          y: labelY ?? cy,
          fontSizePx: 16,
          fontWeight: 'bold',
        },
      ],
    },
  })
}

// ── 軌道常數（公尺） ──
const LX = 72
const RX = 928
const TOP_DY = 362
const TOP_UY = 332
const BOT_DY = 58
const BOT_UY = 78
const SEG_W = 48
const SEG_H = 6
const VSEG_W = 6
const VSEG_H = 38
const ROW_START = 118
const ROW_STEP = 52

// ── 七 Area 均依設計稿 A–G 施作 ──
buildAreaA()
buildAreaB()
buildAreaC()
buildAreaD()
buildAreaE()
buildAreaF()
buildAreaG()

for (const key of Object.keys(AREAS)) {
  finalizeAreaFacilities(key)
}

const areas = Object.entries(AREAS).map(([key, area]) => ({
  id: area.id,
  customName: area.customName,
  layout: area.layout,
  domain: area.domain,
  showRuler: true,
  mqtt: {
    topic: 'v1/vtms/+/telemetry/update',
    vehicleIdField: 'vehicle_code',
    xField: 'x',
    yField: 'y',
  },
  view: { panXM: 0, panYM: 0, zoom: 1 },
  facilities: byArea[key],
}))

const totalFacilities = areas.reduce((n, a) => n + a.facilities.length, 0)

const doc = {
  schemaVersion: 2,
  mapId: 't3-rail-yard',
  displayName: 'T3 軌道場域（七 Area）',
  description:
    '3840×1080 範例：七 Area 依設計稿 domain 排版（A N2W、B/C 正線過渡軌道、D T3、E/F 正線過渡區、G S2W）。',
  pixelSize: { width: MAP_W, height: MAP_H },
  areas,
}

writeFileSync(OUT, `${JSON.stringify(doc, null, 2)}\n`, 'utf8')
console.log(`Wrote ${totalFacilities} facilities in ${areas.length} areas → ${OUT}`)
