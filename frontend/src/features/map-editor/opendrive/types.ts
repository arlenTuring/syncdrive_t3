export type OpenDriveBounds = {
  xmin: number
  ymin: number
  xmax: number
  ymax: number
}

export type OpenDrivePoint = {
  x: number
  y: number
}

export type OpenDriveLanePolygon = {
  roadId: string
  laneId: string
  laneType: string
  mmslLaneId: string | null
  points: OpenDrivePoint[]
}

export type OpenDrivePlan = {
  bounds: OpenDriveBounds
  lanes: OpenDriveLanePolygon[]
  roadCount: number
  laneCount: number
}

export type WidthPoly = {
  sOffset: number
  a: number
  b: number
  c: number
  d: number
}

export type RefSample = {
  s: number
  x: number
  y: number
  hdg: number
}

export type ParsedLane = {
  id: number
  type: string
  mmslLaneId: string | null
  widths: WidthPoly[]
}
