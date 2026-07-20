/** 點位拓撲：停靠點／途經點之間的有向時間距離網路（附著於地圖檔） */

export const POINT_TOPOLOGY_VERSION = 1 as const

export type PointTopologyNodeKind = 'docking' | 'waypoint'

/**
 * 拓撲編輯器內的節點佈局座標（畫布像素，原點左上）。
 * 與地圖場域公尺座標分開，搬動節點不改地圖真實位置。
 */
export type PointTopologyNode = {
  id: string
  kind: PointTopologyNodeKind
  /** 顯示名稱（開啟編輯器時會自設施同步） */
  label: string
  /** DockingPoint 的 stationId；Waypoint 可省略 */
  stationId?: string
  x: number
  y: number
  /** 穩定色碼（#rrggbb） */
  color: string
}

/**
 * 有向邊：一條線只代表一個方向。
 * 兩節點之間最多兩條邊（A→B 與 B→A 各一），不可再多。
 */
export type PointTopologyEdge = {
  id: string
  fromNodeId: string
  toNodeId: string
  minTravelTimeSeconds: number | null
  avgTravelTimeSeconds: number | null
  distanceMeters: number | null
}

export type PointTopology = {
  version: typeof POINT_TOPOLOGY_VERSION
  nodes: PointTopologyNode[]
  edges: PointTopologyEdge[]
}

export function emptyPointTopology(): PointTopology {
  return {
    version: POINT_TOPOLOGY_VERSION,
    nodes: [],
    edges: [],
  }
}
