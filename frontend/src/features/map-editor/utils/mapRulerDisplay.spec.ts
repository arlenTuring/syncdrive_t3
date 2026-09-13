import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { createBlankArea, DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import type { FacilityObject } from '../types/facility'
import {
  cycleMapRulerDisplayMode,
  rulerDomainAtFieldMeters,
  rulerFieldMetersAtDomain,
  trackGenFieldAabb,
} from './mapRulerDisplay'
import {
  TRACKGEN_LOCAL_PATH_KEY,
  TRACKGEN_REAL_PATH_KEY,
} from './trackGenPaths'

describe('mapRulerDisplay', () => {
  it('cycles off → scale → field → off', () => {
    assert.equal(cycleMapRulerDisplayMode('off'), 'scale')
    assert.equal(cycleMapRulerDisplayMode('scale'), 'field')
    assert.equal(cycleMapRulerDisplayMode('field'), 'off')
  })

  it('ruler field labels stay monotonic (no domain/track mix)', () => {
    const track: FacilityObject = {
      id: 't1',
      type: 'Track',
      name: 'Rail',
      customName: '',
      areaPosition: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Idle',
      areaSizePx: { w: 400, h: 40 },
      parameters: {
        [TRACKGEN_REAL_PATH_KEY]: [
          [-900, -100],
          [-100, -50],
        ],
        [TRACKGEN_LOCAL_PATH_KEY]: [
          [0, 0.5],
          [1, 0.5],
        ],
      },
    }
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 400, yMinM: 0, yMaxM: 500 },
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 800,
        hPx: 1000,
        borderPx: 0,
      },
      facilities: [track],
    }
    const aabb = trackGenFieldAabb(area)
    assert.ok(aabb)
    assert.equal(aabb!.xMinM, -900)
    assert.equal(aabb!.yMaxM, -50)

    const domain = area.domain
    const ys = [0, 100, 200, 300, 400, 500].map(
      (domainYM) =>
        rulerFieldMetersAtDomain(domain, domain.xMinM, domainYM, area).yM,
    )
    for (let i = 1; i < ys.length; i += 1) {
      assert.ok(ys[i]! > ys[i - 1]!, `expected monotonic y, got ${ys}`)
    }
    // 不得出現 domain 刻度數字混進場域尺
    assert.ok(!ys.some((y) => y === 200 || y === 300 || y === 400))
  })

  it('without track gen, field ruler equals domain', () => {
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 100, yMinM: 0, yMaxM: 200 },
    }
    const p = rulerFieldMetersAtDomain(area.domain, 50, 100, area)
    assert.equal(p.xM, 50)
    assert.equal(p.yM, 100)
  })

  it('rulerDomainAtFieldMeters inverts rulerFieldMetersAtDomain', () => {
    const track: FacilityObject = {
      id: 't1',
      type: 'Track',
      name: 'Rail',
      customName: '',
      areaPosition: { x: 0, y: 0 },
      position: { x: 0, y: 0 },
      rotation: 0,
      currentState: 'Idle',
      areaSizePx: { w: 400, h: 40 },
      parameters: {
        [TRACKGEN_REAL_PATH_KEY]: [
          [-900, -330],
          [-873, -262],
        ],
        [TRACKGEN_LOCAL_PATH_KEY]: [
          [0, 0],
          [1, 1],
        ],
      },
    }
    const area = {
      ...createBlankArea('1', DEFAULT_MAP_PIXEL_SIZE),
      domain: { xMinM: 0, xMaxM: 400, yMinM: 0, yMaxM: 500 },
      layout: {
        xPx: 0,
        yPx: 0,
        wPx: 800,
        hPx: 1000,
        borderPx: 0,
      },
      facilities: [track],
    }
    const field = { xM: -886.5, yM: -296 }
    const domain = rulerDomainAtFieldMeters(
      area.domain,
      field.xM,
      field.yM,
      area,
    )
    const back = rulerFieldMetersAtDomain(
      area.domain,
      domain.xM,
      domain.yM,
      area,
    )
    assert.ok(Math.abs(back.xM - field.xM) < 1e-6)
    assert.ok(Math.abs(back.yM - field.yM) < 1e-6)
  })
})
