import type { MapVehicleIconSpec } from './types'

/**
 * 預設地圖車輛圖示：多層 CSS + SVG 剪影。
 * 可複製此物件並替換 layers 以套用自訂設計。
 */
export const DEFAULT_MAP_VEHICLE_ICON: MapVehicleIconSpec = {
  id: 'vtms-bus-layered',
  name: 'VTMS 巴士',
  width: 34,
  height: 34,
  anchorX: 0.5,
  anchorY: 0.5,
  layers: [
    {
      kind: 'css',
      id: 'glow',
      zIndex: 0,
      style: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '220%',
        height: '220%',
        transform: 'translate(-50%, -50%)',
        borderRadius: '50%',
        background:
          'radial-gradient(circle, rgba(255,255,255,0.22) 0%, rgba(255,255,255,0.06) 45%, transparent 70%)',
        pointerEvents: 'none',
      },
    },
    {
      kind: 'css',
      id: 'body-bg',
      zIndex: 1,
      style: {
        position: 'absolute',
        left: '50%',
        top: '50%',
        width: '88%',
        height: '88%',
        transform: 'translate(-50%, -50%)',
        borderRadius: '20%',
        backgroundColor: 'var(--map-vehicle-bg, #51A2FF)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.35)',
        transition: 'background-color 0.3s ease',
      },
    },
    {
      kind: 'svg-body',
      id: 'body-silhouette',
      zIndex: 2,
    },
    {
      kind: 'label',
      id: 'vehicle-id',
      zIndex: 3,
      style: {
        position: 'absolute',
        left: '50%',
        top: '100%',
        transform: 'translateX(-50%)',
        marginTop: 2,
        fontSize: 9,
        fontWeight: 700,
        lineHeight: 1,
        color: '#f8fafc',
        whiteSpace: 'nowrap',
        maxWidth: 56,
        overflow: 'hidden',
        textOverflow: 'ellipsis',
        textShadow: '0 1px 2px rgba(0,0,0,0.8)',
        pointerEvents: 'none',
      },
    },
  ],
}
