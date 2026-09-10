import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import {
  AREA_DROP_DEFAULTS,
  defaultAreaSizePxForDrop,
  defaultMapChromeSizePxForDrop,
  poleIconFillBoxStyle,
  POLE_ASSET_CONTENT,
} from './facilityDimensions'
import type { MapAreaDomain, MapAreaLayout } from '../types/area'

const domain: MapAreaDomain = {
  xMinM: 0,
  xMaxM: 200,
  yMinM: 0,
  yMaxM: 100,
}

const layout: MapAreaLayout = {
  xPx: 0,
  yPx: 0,
  wPx: 1000,
  hPx: 600,
  borderPx: 0,
}

describe('facilityDimensions drop sizes', () => {
  it('sizes equipment by Area layout pixels (not huge fixed meters)', () => {
    const signal = defaultAreaSizePxForDrop('Signal', 'Light', domain, layout)
    const pole = defaultAreaSizePxForDrop('Pole', 'SmartPole', domain, layout)
    const facility = defaultAreaSizePxForDrop(
      'Facility',
      'FacilityArea',
      domain,
      layout,
    )
    const waypoint = defaultAreaSizePxForDrop(
      'Waypoint',
      'Waypoint',
      domain,
      layout,
    )
    const psd = defaultAreaSizePxForDrop('PSD', 'Gate', domain, layout)

    assert.ok(signal.w < 90 && signal.h < 90)
    assert.ok(signal.w >= 16 && signal.h >= 16)
    // 智慧桿瘦高；預設已小 4 倍，可與燈號接近但比例仍瘦高
    assert.ok(pole.h > pole.w * 1.5)
    assert.ok(pole.h >= 16)
    assert.ok(facility.w > signal.w)
    assert.ok(facility.w <= layout.wPx / 3 + 1)
    // 途經點預設小 4 倍（仍可操作）；數值來自 AREA_DROP_DEFAULTS
    assert.ok(waypoint.w >= AREA_DROP_DEFAULTS.waypoint.minPx)
    assert.ok(waypoint.w <= AREA_DROP_DEFAULTS.waypoint.maxPx + 1)
    assert.ok(Math.abs(waypoint.w - waypoint.h) < 1e-6)
    // 月台門為薄長條
    assert.ok(psd.w > psd.h * 2)
  })

  it('scales equipment with smaller formal layout', () => {
    const small: MapAreaLayout = { ...layout, wPx: 400, hPx: 240 }
    const signalBig = defaultAreaSizePxForDrop('Signal', 'Light', domain, layout)
    const signalSmall = defaultAreaSizePxForDrop(
      'Signal',
      'Light',
      domain,
      small,
    )
    assert.ok(signalSmall.w < signalBig.w)
  })

  it('keeps track family band-relative and within layout', () => {
    const rail = defaultAreaSizePxForDrop('Track', 'Rail', domain, layout)
    const corner = defaultAreaSizePxForDrop(
      'Track',
      'RailCorner',
      domain,
      layout,
    )
    assert.ok(rail.w > rail.h) // 長條
    // 圓角在公尺上是方形；layout 長寬比≠domain 時像素可不為正方
    assert.ok(corner.w >= 16 && corner.h >= 16)
    assert.ok(rail.w <= layout.wPx / 3 + 1e-6)
    assert.ok(rail.h >= 16)
    assert.ok(corner.w <= layout.wPx / 3 + 1e-6)
  })

  it('sizes map chrome (Area / TrackGen) from pixelSize', () => {
    const ps = { width: 3152, height: 642 }
    const area = defaultMapChromeSizePxForDrop('area', ps)
    const trackGen = defaultMapChromeSizePxForDrop('trackGen', ps)
    assert.ok(area.w < ps.width)
    assert.ok(area.h < ps.height)
    assert.ok(trackGen.w > area.w)
    assert.ok(trackGen.h >= 180)
  })

  it('poleIconFillBoxStyle maps asset content to fill the selection box', () => {
    const box = { w: 40, h: 100 }
    const s = poleIconFillBoxStyle(box.w, box.h)
    // 內容區應對齊外框四邊
    assert.ok(Math.abs(s.left + POLE_ASSET_CONTENT.left * s.width) < 1e-6)
    assert.ok(Math.abs(s.top + POLE_ASSET_CONTENT.top * s.height) < 1e-6)
    assert.ok(Math.abs(POLE_ASSET_CONTENT.width * s.width - box.w) < 1e-6)
    assert.ok(Math.abs(POLE_ASSET_CONTENT.height * s.height - box.h) < 1e-6)
  })
})
