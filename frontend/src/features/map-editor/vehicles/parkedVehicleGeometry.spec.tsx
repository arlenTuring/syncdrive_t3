// @vitest-environment jsdom
import { act, createElement } from 'react'
import { createRoot, type Root } from 'react-dom/client'
import { afterEach, describe, expect, it } from 'vitest'
import { vehicleDefinitionFromRow, type VehicleDefinitionRow } from '../../vehicle-editor/api/vehicleDefinitionsApi'
import type { VehicleDefinition } from '../../vehicle-editor/types'
import type { MapAreaObject } from '../types/area'
import { parseMapFileJson } from '../utils/mapFileJson'
import { applyRefFieldZeroPolicyToParsed } from '../utils/mergeBuiltinRefFields'
import modelRow from './__fixtures__/vehicle-model-sampleywe93qb-v23.json'
import yardMap from './__fixtures__/yard-slots-20261015.json'
import { MapAreaVehicleOverlay } from './MapAreaVehicleOverlay'
import type { AreaVehicleLive } from './types'

;(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true

/*
 * 停在格位的車：讀「最終畫出來的 DOM」驗證車身位置，不只驗公式。
 *
 * 資料是 2026-10-15 本機執行中的真實版本：
 * - 模型 sampleywe93qb v23（圖資管理設定 88×30 顯示框，車身 260×78，後軸由尾燈估在車身 0.887 處）
 * - 發布地圖 map-1789194688160-bu1e5q6 的調度區、整備區、充電區格位（使用者放大後的尺寸）
 * - 模擬器停車座標＝格位場域範圍中心
 *
 * 當時的錯誤：即時遙測沒有帶中心端的位置判定（location_kind），圖台把停車座標當成後軸，
 * 車身整台往車頭方向偏 34 px，凸出格位 33～48 px。
 */

const realModel = vehicleDefinitionFromRow(modelRow as unknown as VehicleDefinitionRow)
const areasOf = (doc: unknown): MapAreaObject[] =>
  applyRefFieldZeroPolicyToParsed(parseMapFileJson(doc)).areas

type Car = { code: string; x: number; y: number; heading: number; slot: string }
const CARS: Car[] = [
  { code: 'PMS03', x: -893.88, y: -338.775, heading: Math.PI / 2, slot: 'D1' },
  { code: 'PMS04', x: -893.88, y: -355.2, heading: Math.PI / 2, slot: 'D2' },
  { code: 'PMS05', x: -893.88, y: -370.39, heading: Math.PI / 2, slot: 'D3' },
  { code: 'PMS09', x: -891.56, y: -280.89, heading: Math.PI / 2, slot: 'M3' },
  { code: 'PMS10', x: -891.685, y: -314.7, heading: Math.PI / 2, slot: 'M4' },
  { code: 'PMS07', x: -239.77, y: -7.55, heading: 0, slot: 'E3' },
  { code: 'PMS08', x: -258.96, y: -3.53, heading: 0, slot: 'E2' },
]

function vehicle(car: Car, extra: Record<string, unknown> = {}): AreaVehicleLive {
  return {
    areaId: '077',
    vehicleId: car.code,
    xM: car.x,
    yM: car.y,
    payload: {
      vehicle_code: car.code,
      timestamp: 1,
      kinematics: { velocity: 0 },
      local_pose: { position: { x: car.x, y: car.y, z: 0 }, heading: car.heading },
      // 中心端對這一筆遙測的判定（後端廣播給瀏覽器的副本才有）
      location_kind: 'FACILITY',
      segment_label: car.slot,
      ...extra,
    },
    topic: `v1/vtms/${car.code}/telemetry/update`,
    updatedAt: 1,
  }
}

let root: Root | null = null
let box: HTMLDivElement | null = null
afterEach(() => {
  act(() => root?.unmount())
  box?.remove()
  root = null
})

function render(areas: MapAreaObject[], vehicles: AreaVehicleLive[], definition: VehicleDefinition | null = realModel) {
  box = document.createElement('div')
  document.body.appendChild(box)
  root = createRoot(box)
  const props = {
    areas,
    vehicles,
    vehicleDefinition: definition,
    vehicleDisplayWidthPx: 88,
    vehicleDisplayHeightPx: 30,
    livePositionTweenMs: 0,
    routes: [],
  }
  act(() => root!.render(createElement(MapAreaVehicleOverlay, props)))
  return (next: { areas?: MapAreaObject[]; vehicles?: AreaVehicleLive[] }) =>
    act(() => root!.render(createElement(MapAreaVehicleOverlay, { ...props, ...next })))
}

/** 從 DOM 讀出車身（body 元件）四角的畫面座標：外層 translate3d ＋ 車身 div 的 rotate／scale／origin */
function bodyRect(code: string) {
  const node = box!.querySelector(`[data-vehicle-id="${code}"]`) as HTMLElement
  const divs = [...node.querySelectorAll('div')] as HTMLElement[]
  const container = divs.find((d) => d.style.transform.startsWith('translate3d'))!
  const body = divs.find((d) => /rotate\(/.test(d.style.transform) && /scale\(/.test(d.style.transform))!
  const [tx, ty] = [...container.style.transform.matchAll(/(-?[\d.e-]+)px/g)].map((m) => Number(m[1]))
  const rot = (Number(/rotate\((-?[\d.e-]+)deg/.exec(body.style.transform)![1]) * Math.PI) / 180
  const scale = Number(/scale\(([\d.]+)\)/.exec(body.style.transform)![1])
  const [ox, oy] = [...body.style.transformOrigin.matchAll(/(-?[\d.e-]+)px/g)].map((m) => Number(m[1]))
  const left = parseFloat(body.style.left)
  const top = parseFloat(body.style.top)
  const w = parseFloat(body.style.width)
  const h = parseFloat(body.style.height)
  const corner = (px: number, py: number) => {
    const vx = (px - ox) * scale
    const vy = (py - oy) * scale
    return {
      x: tx + left + ox + vx * Math.cos(rot) - vy * Math.sin(rot),
      y: ty + top + oy + vx * Math.sin(rot) + vy * Math.cos(rot),
    }
  }
  const corners = [corner(0, 0), corner(w, 0), corner(w, h), corner(0, h)]
  const xs = corners.map((c) => c.x)
  const ys = corners.map((c) => c.y)
  return {
    cx: xs.reduce((a, b) => a + b) / 4,
    cy: ys.reduce((a, b) => a + b) / 4,
    w: Math.max(...xs) - Math.min(...xs),
    h: Math.max(...ys) - Math.min(...ys),
    minX: Math.min(...xs),
    maxX: Math.max(...xs),
    minY: Math.min(...ys),
    maxY: Math.max(...ys),
    data: node.dataset,
  }
}

/** 格位在畫面上的外框（CSS 座標，y 向下） */
function slotRect(areas: MapAreaObject[], name: string) {
  const area = areas.find((a) => a.id === '077')!
  const f = area.facilities.find((item) => item.customName === name)!
  const pos = f.areaPosition!
  const size = f.areaSizePx!
  const top = area.layout.hPx - pos.y - size.h
  return { x: pos.x, y: top, w: size.w, h: size.h, cx: pos.x + size.w / 2, cy: top + size.h / 2 }
}

describe('parked vehicle geometry (real model, real yard slots, final DOM)', () => {
  const areas = areasOf(yardMap)

  it('puts the body centre on the slot centre for every parked car', () => {
    render(areas, CARS.map((car) => vehicle(car)))
    for (const car of CARS) {
      const body = bodyRect(car.code)
      const slot = slotRect(areas, car.slot)
      expect(body.data.yard).toBe('true')
      expect(body.data.yardSlot).toBe(car.slot)
      expect(body.cx).toBeCloseTo(slot.cx, 1)
      expect(body.cy).toBeCloseTo(slot.cy, 1)
      // 車身 88×26.4，等比，不因格位改變
      expect(Math.max(body.w, body.h)).toBeCloseTo(88, 1)
      expect(Math.min(body.w, body.h)).toBeCloseTo(26.4, 1)
    }
  })

  it('fits the charging slots, and shows the dispatch/maintenance slots as too short instead of shrinking the car', () => {
    render(areas, CARS.map((car) => vehicle(car)))
    for (const car of CARS) {
      const body = bodyRect(car.code)
      const slot = slotRect(areas, car.slot)
      if (car.slot.startsWith('E')) {
        expect(body.minX).toBeGreaterThanOrEqual(slot.x - 0.01)
        expect(body.maxX).toBeLessThanOrEqual(slot.x + slot.w + 0.01)
        expect(body.minY).toBeGreaterThanOrEqual(slot.y - 0.01)
        expect(body.maxY).toBeLessThanOrEqual(slot.y + slot.h + 0.01)
      } else {
        // 格高 69.73 < 車長 88：兩端各凸出 9.1 px，對稱（置中正確、只是格位不夠長）
        expect(slot.y - body.minY).toBeCloseTo((88 - slot.h) / 2, 1)
        expect(body.maxY - (slot.y + slot.h)).toBeCloseTo((88 - slot.h) / 2, 1)
        expect(body.minX).toBeGreaterThan(slot.x)
        expect(body.maxX).toBeLessThan(slot.x + slot.w)
      }
    }
  })

  it('stays centred at any heading (0°, 90°, 180°, 270°, 37°)', () => {
    const car = CARS[5]
    for (const heading of [0, Math.PI / 2, Math.PI, (3 * Math.PI) / 2, (37 * Math.PI) / 180]) {
      render(areas, [vehicle({ ...car, heading })])
      const body = bodyRect(car.code)
      const slot = slotRect(areas, car.slot)
      expect(body.cx).toBeCloseTo(slot.cx, 1)
      expect(body.cy).toBeCloseTo(slot.cy, 1)
      act(() => root?.unmount())
      box?.remove()
    }
  })

  it('stays centred for a model with an explicit rear axle and no tail light', () => {
    const model: VehicleDefinition = {
      ...realModel,
      rearAxleFromTailRatio: 0.3,
      elements: realModel.elements.filter((el) => el.type !== 'light'),
    }
    render(areas, CARS.map((car) => vehicle(car)), model)
    for (const car of CARS) {
      const body = bodyRect(car.code)
      const slot = slotRect(areas, car.slot)
      expect(body.cx).toBeCloseTo(slot.cx, 1)
      expect(body.cy).toBeCloseTo(slot.cy, 1)
    }
  })

  it('keeps the car size and ratio when a slot is resized, and moves it with the new slot centre (no stale cache)', () => {
    const car = CARS[0]
    const rerender = render(areas, [vehicle(car)])
    const before = bodyRect(car.code)
    const resized = structuredClone(yardMap) as typeof yardMap
    const d1 = resized.areas[0].facilities.find((f: { customName?: string }) => f.customName === 'D1') as {
      areaSizePx: { w: number; h: number }
      areaPosition: { x: number; y: number }
    }
    d1.areaSizePx = { w: 30, h: 40 }
    d1.areaPosition = { x: d1.areaPosition.x + 10, y: d1.areaPosition.y + 5 }
    const nextAreas = areasOf(resized)
    rerender({ areas: nextAreas })
    const after = bodyRect(car.code)
    const slot = slotRect(nextAreas, 'D1')
    expect(after.w).toBeCloseTo(before.w, 6)
    expect(after.h).toBeCloseTo(before.h, 6)
    expect(after.cx).toBeCloseTo(slot.cx, 1)
    expect(after.cy).toBeCloseTo(slot.cy, 1)
  })

  it('draws the selected (highlighted) car at exactly the same place and size', () => {
    render(areas, [vehicle(CARS[2])])
    const plain = bodyRect('PMS05')
    act(() => root?.unmount())
    box?.remove()
    render(areas, [vehicle(CARS[2], { __selected: true })])
    const selected = bodyRect('PMS05')
    expect(selected.cx).toBeCloseTo(plain.cx, 9)
    expect(selected.cy).toBeCloseTo(plain.cy, 9)
    expect(selected.w).toBeCloseTo(plain.w, 9)
    expect(selected.h).toBeCloseTo(plain.h, 9)
  })

  it('does not move one car when another car updates', () => {
    const rerender = render(areas, CARS.slice(0, 2).map((car) => vehicle(car)))
    const before = bodyRect('PMS03')
    rerender({ vehicles: [vehicle(CARS[0]), vehicle({ ...CARS[1], x: CARS[1].x + 0.4 }, { timestamp: 2 })] })
    const after = bodyRect('PMS03')
    expect(after.cx).toBeCloseTo(before.cx, 9)
    expect(after.cy).toBeCloseTo(before.cy, 9)
  })

  it('does not trust a slot the vehicle itself reports when the backend has not located it', () => {
    const car = CARS[0]
    // 沒有中心端判定（location_kind 缺）：車端自帶的 segment_label 不採用，不吸附到格位
    render(areas, [vehicle(car, { location_kind: undefined })])
    expect(bodyRect(car.code).data.yard).toBe('false')
  })
})
