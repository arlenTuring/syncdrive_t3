/** 路網拓撲：點位／設施之間的有向時間距離網路（附著於地圖檔） */

export const POINT_TOPOLOGY_VERSION = 1 as const

export type PointTopologyNodeKind =
  | 'docking'
  | 'waypoint'
  | 'facility'
  /** 大型設施內的設施停靠點（拓撲上為琥珀色） */
  | 'facility-docking'
  /**
   * 虛擬渡線途經點（TrackCrossover 端點 A／B 內建）。
   * 與一般 `waypoint` 功能相同（可連線、可入路線），但資料來源與清單分類分開。
   * 穩定 id＝`xowp:<facilityId>:a|b`；對外站序 id＝portal.waypointCode。
   */
  | 'crossover-waypoint'
  /**
   * 交叉軌道途經點（RailCross 四口 lt／lb／rt／rb）。
   * 穩定 id＝`xcwp:<facilityId>:lt|lb|rt|rb`；對外站序 id＝portal.waypointCode。
   */
  | 'cross-waypoint'

/**
 * 拓撲編輯器內的節點佈局座標（畫布像素，原點左上）。
 * 與地圖場域公尺座標分開，搬動節點不改地圖真實位置。
 */
export type PointTopologyNode = {
  id: string
  kind: PointTopologyNodeKind
  /** 顯示名稱（開啟編輯器時會自設施同步） */
  label: string
  /** DockingPoint／虛擬渡線／交叉軌道途經點的對外代號（waypointCode）；一般 Waypoint 可省略（用 facility id） */
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
  /**
   * 拓撲畫布上，二次貝塞爾控制點相對弦中點的偏移（像素）。
   * 省略或 null＝依預設（直線或整備分扇）；拖線徑後寫入。
   */
  curveOffsetX?: number | null
  curveOffsetY?: number | null
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
