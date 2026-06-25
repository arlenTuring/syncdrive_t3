import { MAX_NODE_WORLD_H, MAX_NODE_WORLD_W } from '../constants/facilityDimensions'
import { clamp } from './dom'

/** 吸附至 10cm（1 世界單位）並限制在可放置範圍內 */
export function snapDragPosition(
  x: number,
  y: number,
  nodeWorldSize?: { w: number; h: number },
  worldBounds?: { worldW: number; worldH: number },
): { x: number; y: number } {
  const mapWorldW = worldBounds?.worldW ?? MAX_NODE_WORLD_W
  const mapWorldH = worldBounds?.worldH ?? MAX_NODE_WORLD_H
  const nw = nodeWorldSize?.w ?? MAX_NODE_WORLD_W
  const nh = nodeWorldSize?.h ?? MAX_NODE_WORLD_H
  const maxX = Math.max(0, Math.floor(mapWorldW - nw))
  const maxY = Math.max(0, Math.floor(mapWorldH - nh))
  const sx = Math.round(x)
  const sy = Math.round(y)
  return {
    x: clamp(sx, 0, maxX),
    y: clamp(sy, 0, maxY),
  }
}
