import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { DEFAULT_MAP_PIXEL_SIZE } from '../types/area'
import { isTrackGenComponent } from './trackGenFacility'
import {
  createBlankMapEntry,
  createTrackGenMapEntry,
} from './mapLibraryStorage'
import { parseMapFileJson } from './mapFileJson'

describe('mapLibraryStorage factories', () => {
  it('createBlankMapEntry builds one empty Area and blank mode', () => {
    const entry = createBlankMapEntry(DEFAULT_MAP_PIXEL_SIZE)
    const parsed = parseMapFileJson(entry.mapDocument)
    assert.equal(parsed.creationMode, 'blank')
    assert.equal(parsed.areas.length, 1)
    assert.equal(parsed.basemaps.length, 0)
    assert.equal(parsed.areas[0]?.facilities.length, 0)
  })

  it('createTrackGenMapEntry fills canvas with TrackGen and no Area', () => {
    const entry = createTrackGenMapEntry(DEFAULT_MAP_PIXEL_SIZE)
    assert.equal(entry.mapDocument.creationMode, 'trackGen')
    const parsed = parseMapFileJson(entry.mapDocument)
    assert.equal(parsed.creationMode, 'trackGen')
    assert.equal(parsed.areas.length, 0)
    assert.equal(parsed.basemaps.length, 1)
    const bm = parsed.basemaps[0]!
    assert.ok(isTrackGenComponent(bm.parameters))
    assert.equal(bm.layout.xPx, 0)
    assert.equal(bm.layout.yPx, 0)
    assert.equal(bm.layout.wPx, DEFAULT_MAP_PIXEL_SIZE.width)
    assert.equal(bm.layout.hPx, DEFAULT_MAP_PIXEL_SIZE.height)
  })
})
