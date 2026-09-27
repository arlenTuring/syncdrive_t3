import { createContext } from 'react'
import type { AreaVehicleLive } from './types'

/**
 * 圖台車輛（不經過 MapAreaCanvas 的 props）。
 *
 * 車輛每秒更新好幾次；當 props 傳進 MapAreaCanvas 時整張圖台（每個設施、標籤）跟著重畫，
 * 儀表板上實測每次 60～70 毫秒。改由這個 context 直接送到車輛圖層，圖台本身不動。
 * 見 MapAreaCanvas 的 areaVehiclesFromContext。
 */
export const MapAreaVehiclesContext = createContext<AreaVehicleLive[] | null>(null)
