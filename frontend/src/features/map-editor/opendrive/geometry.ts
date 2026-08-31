import type { RefSample } from './types'

export type LineGeometry = {
  kind: 'line'
  s: number
  x: number
  y: number
  hdg: number
  length: number
}

export type ArcGeometry = {
  kind: 'arc'
  s: number
  x: number
  y: number
  hdg: number
  length: number
  curvature: number
}

export type RoadGeometry = LineGeometry | ArcGeometry

export function sampleReferenceLine(
  geometries: RoadGeometry[],
  stepM = 1,
): RefSample[] {
  if (geometries.length === 0) return []

  const samples: RefSample[] = []

  for (const geom of geometries) {
    const segSamples = Math.max(2, Math.ceil(geom.length / stepM) + 1)
    for (let i = 0; i < segSamples; i++) {
      const ds = (i / (segSamples - 1)) * geom.length
      const s = geom.s + ds
      if (samples.length > 0 && s <= samples[samples.length - 1]!.s + 1e-9) {
        continue
      }
      const pt = evalGeometryAt(geom, ds)
      samples.push({ s, ...pt })
    }
  }

  if (samples.length === 0) {
    const g = geometries[0]!
    samples.push({ s: g.s, x: g.x, y: g.y, hdg: g.hdg })
  }

  return samples
}

export function evalGeometryAt(
  geom: RoadGeometry,
  ds: number,
): { x: number; y: number; hdg: number } {
  if (geom.kind === 'line') {
    return {
      x: geom.x + ds * Math.cos(geom.hdg),
      y: geom.y + ds * Math.sin(geom.hdg),
      hdg: geom.hdg,
    }
  }

  const c = geom.curvature
  if (Math.abs(c) < 1e-12) {
    return {
      x: geom.x + ds * Math.cos(geom.hdg),
      y: geom.y + ds * Math.sin(geom.hdg),
      hdg: geom.hdg,
    }
  }

  const radius = 1 / c
  const theta = geom.hdg - Math.sign(c) * Math.PI / 2
  const cx = geom.x - radius * Math.cos(theta)
  const cy = geom.y - radius * Math.sin(theta)
  const angle = theta + ds * c
  return {
    x: cx + radius * Math.cos(angle),
    y: cy + radius * Math.sin(angle),
    hdg: geom.hdg + ds * c,
  }
}

export function offsetFromReference(
  x: number,
  y: number,
  hdg: number,
  t: number,
): { x: number; y: number } {
  return {
    x: x - t * Math.sin(hdg),
    y: y + t * Math.cos(hdg),
  }
}
