import { tokenVar } from '../../../styles/tokens'

/** 系統健康趨勢各指標的顏色（卡片進度條、圖例、折線共用；取自設計色票） */
export const HEALTH_SERIES_COLOR = {
  cpuUsagePercent: tokenVar('color-blue-500'),
  cpuTempC: tokenVar('color-cyan-400'),
  memoryUsagePercent: tokenVar('color-green-500'),
  diskFreePercent: tokenVar('color-purple-500'),
} as const

/** 超過警戒值 */
export const HEALTH_ALERT_COLOR = tokenVar('status-error')
