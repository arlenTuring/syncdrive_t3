import { describe, expect, it } from 'vitest'
import {
  TRACK_CROSSOVER_PORTALS_KEY,
  crossoverPortalFieldMeters,
  getCrossoverPortals,
  type CrossoverPortals,
} from './trackCrossoverFacility'
import { syncLayoutFromCrossoverPortals } from './trackCrossoverLayout'
import { patchCrossoverPortalFieldMeters } from './waypointCode'
import type { FacilityObject } from '../types/facility'

/**
 * 端點有兩組座標：圖面（xM／yM）與現場（refFieldXM／refFieldYM）。
 *
 * 兩者分家的理由是圖面位置畫給人看、現場位置是實際量到的，本來就可以不一致。
 * 共用一對數值時，改一個現場座標就會把圖上的端點拉走——那不是使用者的意思。
 */

const DOMAIN = { xMinM: 0, xMaxM: 1000, yMinM: 0, yMaxM: 500 }
const LAYOUT = { xPx: 0, yPx: 0, wPx: 1000, hPx: 500 }

function portals(): CrossoverPortals {
  return {
    a: { xM: 700, yM: 394.685, attachedTrackId: '012', waypointCode: 'xo_2_a' },
    b: { xM: 747.392, yM: 373.972, attachedTrackId: '020', waypointCode: 'xo_2_b' },
  }
}

function facility(): FacilityObject {
  return {
    id: '190',
    type: 'TrackCrossover',
    name: '渡線',
    parameters: { [TRACK_CROSSOVER_PORTALS_KEY]: portals() },
  } as unknown as FacilityObject
}

describe('端點的現場座標與圖面座標分家', () => {
  it('舊圖資沒有 refField 時，現場座標退回圖面座標', () => {
    expect(crossoverPortalFieldMeters(portals().a)).toEqual({ xM: 700, yM: 394.685 })
  })

  it('手打現場縱向位置：只改 refField，圖面座標原封不動', () => {
    const next = patchCrossoverPortalFieldMeters(facility(), 'a', { yM: 120 })
    const after = getCrossoverPortals(next)!

    expect(crossoverPortalFieldMeters(after.a)).toEqual({ xM: 700, yM: 120 })
    // 圖上的端點不能被拉走
    expect(after.a.xM).toBe(700)
    expect(after.a.yM).toBe(394.685)
  })

  it('只改一軸時，另一軸沿用原本的現場座標', () => {
    const once = patchCrossoverPortalFieldMeters(facility(), 'a', { yM: 120 })
    const twice = patchCrossoverPortalFieldMeters(once, 'a', { xM: 55 })
    const after = getCrossoverPortals(twice)!

    expect(crossoverPortalFieldMeters(after.a)).toEqual({ xM: 55, yM: 120 })
  })

  it('另一個端點不受影響', () => {
    const next = patchCrossoverPortalFieldMeters(facility(), 'a', { yM: 120 })
    const after = getCrossoverPortals(next)!

    expect(crossoverPortalFieldMeters(after.b)).toEqual({ xM: 747.392, yM: 373.972 })
  })

  it('拖動端點（走 layout 同步）時，現場座標跟著圖面走', () => {
    const moved: CrossoverPortals = {
      a: { ...portals().a, xM: 710, yM: 400 },
      b: portals().b,
    }
    const sync = syncLayoutFromCrossoverPortals(moved, DOMAIN, LAYOUT)
    const patched = sync.parametersPatch[TRACK_CROSSOVER_PORTALS_KEY] as CrossoverPortals

    expect(crossoverPortalFieldMeters(patched.a)).toEqual({ xM: 710, yM: 400 })
  })

  it('拖動會覆蓋掉先前手打的現場座標——那個端點確實被移動了', () => {
    const edited = getCrossoverPortals(
      patchCrossoverPortalFieldMeters(facility(), 'a', { yM: 120 }),
    )!
    const sync = syncLayoutFromCrossoverPortals(edited, DOMAIN, LAYOUT)
    const patched = sync.parametersPatch[TRACK_CROSSOVER_PORTALS_KEY] as CrossoverPortals

    expect(crossoverPortalFieldMeters(patched.a)).toEqual({ xM: 700, yM: 394.685 })
  })
})
