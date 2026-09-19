export type FacilityType =
  | 'Slot'
  | 'Facility'
  | 'Geofence'
  | 'PSD'
  | 'Signal'
  | 'Track'
  | 'Pole'
  | 'DockingPoint'
  | 'Waypoint'
  | 'RoadLine'
  | 'Basemap'

export type FacilityName =
  | 'Parking'
  | 'Charging'
  | 'Wash'
  | 'Repair'
  | 'FacilityArea'
  | 'ZoneEntrance'
  | 'ZonePartition'
  | 'Geofence'
  | 'Gate'
  | 'Light'
  | 'Rail'
  | 'RailCorner'
  | 'RailTaper'
  | 'RailSwitch'
  | 'RailCross'
  | 'SmartPole'
  | 'DockingPoint'
  | 'Waypoint'
  | 'RoadLine'
  | 'Basemap'

/** 旋轉角度（度），可為任意數值以利微調 */
export type RotationDeg = number

/** 整備格：此格空間是否被佔用（與下方設備狀態分開） */
export type SlotOccupancy = 'Vacant' | 'Occupied'

/** 整備格：格上設備／作業狀態 */
export type SlotEquipmentState =
  | 'Idle'
  | 'Working'
  | 'Charging'
  | 'Repairing'
  | 'Error'

export type PSDState = 'Open' | 'Closed' | 'Moving' | 'Alarm'

export type SignalState = 'Normal' | 'Warning' | 'Fault' | 'Offline'

export type TrackState = 'Idle' | 'Occupied' | 'Error'

export type PoleState = 'Normal' | 'Error'

/** 停靠點（站點標記；預設藍點，可換自訂圖示） */
export type DockingPointState = 'Normal' | 'Inactive'

/** 途經點（必經點位；預設綠點，不顯示名稱） */
export type WaypointState = 'Normal' | 'Inactive'

/** 道路線（純視覺標記） */
export type RoadLineState = 'Normal'

/** 底圖（可載入本機圖片作為 Area 內背景） */
export type BasemapState = 'Normal'

/** 電子圍籬（僅供圖層／匯出；幾何以 parameters.verticesMeters 為準） */
export type GeofenceState = 'Normal'

/** 設施預設狀態（無即時改色規則命中時作為底色參考） */
export type FacilityAreaState = 'Normal' | 'Occupied' | 'Warning' | 'Error'

/** 非 Slot 設施之單一狀態；Slot 請用 slotOccupancy + slotEquipmentState */
export type NonSlotFacilityState =
  | PSDState
  | SignalState
  | TrackState
  | PoleState
  | DockingPointState
  | WaypointState
  | RoadLineState
  | BasemapState
  | FacilityAreaState
  | GeofenceState

export type FacilityState = NonSlotFacilityState

/** 各空間／設備狀態是否啟用（未列出或 true 以外視為啟用；明確 false 為停用） */
export type SlotOccupancyEnabledMap = Partial<Record<SlotOccupancy, boolean>>
export type SlotEquipmentEnabledMap = Partial<Record<SlotEquipmentState, boolean>>

/**
 * 設施雙座標（Area 內，左下原點）：
 * - areaPosition：區域座標（Area 座標系，非地圖像素；拉伸外框時不變）
 * - position：場域座標（domain 物理公尺，隨 layout/domain 映射更新）
 * - areaSizePx：圖台顯示尺寸（絕對畫素；與 Area 外框、場域 domain 無關；拉伸 Area 外框時不變）
 * - areaLayoutAnchor：定位時 Area 的 wPx/hPx（渲染換算用，拉伸外框時不變）
 * - parameters.refFieldXM / refFieldYM：場域座標（公尺，單點；號誌／智慧桿／月台門／停靠點／途經點；可依圖台映射自動帶入）
 * - parameters.refFieldXMinM…YMaxM：場域範圍（公尺；軌道／設施／圍籬）
 * - parameters.refFieldCornersM：斜接四角點（各 xM/yM；RailTaper）
 */
export type FacilityObject =
  | {
      id: string
      type: 'Slot'
      name: FacilityName
      customName: string
      areaPosition: { x: number; y: number }
      areaLayoutAnchor?: { wPx: number; hPx: number }
      position: { x: number; y: number }
      rotation: RotationDeg
      slotOccupancy: SlotOccupancy
      slotEquipmentState: SlotEquipmentState
      slotOccupancyEnabled?: SlotOccupancyEnabledMap
      slotEquipmentEnabled?: SlotEquipmentEnabledMap
      areaSizePx?: { w: number; h: number }
      parameters?: Record<string, unknown>
    }
  | {
      id: string
      type:
        | 'PSD'
        | 'Signal'
        | 'Track'
        | 'Pole'
        | 'Facility'
        | 'DockingPoint'
        | 'Waypoint'
        | 'RoadLine'
        | 'Basemap'
      name: FacilityName
      customName: string
      areaPosition: { x: number; y: number }
      areaLayoutAnchor?: { wPx: number; hPx: number }
      position: { x: number; y: number }
      rotation: RotationDeg
      currentState: NonSlotFacilityState
      areaSizePx?: { w: number; h: number }
      parameters?: Record<string, unknown>
    }
  | {
      id: string
      type: 'Geofence'
      name: 'Geofence'
      customName: string
      areaPosition: { x: number; y: number }
      areaLayoutAnchor?: { wPx: number; hPx: number }
      position: { x: number; y: number }
      rotation: RotationDeg
      currentState: GeofenceState
      areaSizePx?: { w: number; h: number }
      parameters?: Record<string, unknown>
    }

export type SlotFacility = Extract<FacilityObject, { type: 'Slot' }>
export type FacilityFacility = Extract<FacilityObject, { type: 'Facility' }>
export type GeofenceFacility = Extract<FacilityObject, { type: 'Geofence' }>

/** @deprecated 舊名稱；請改用 FacilityFacility */
export type ZoneFacility = FacilityFacility
