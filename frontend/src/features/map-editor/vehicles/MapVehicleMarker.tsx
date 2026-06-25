import type { CSSProperties } from 'react'
import { VehicleBodySvg } from '../../dashboard/vehicle-operation-actions/VehicleBodySvg'
import type { MapVehicleIconSpec } from './types'

export function MapVehicleMarker({
  spec,
  vehicleId,
  bgColor,
  showLabel = true,
  className,
  style,
}: {
  spec: MapVehicleIconSpec
  vehicleId: string
  bgColor: string
  showLabel?: boolean
  className?: string
  style?: CSSProperties
}) {
  const sorted = [...spec.layers].sort((a, b) => (a.zIndex ?? 0) - (b.zIndex ?? 0))

  return (
    <div
      className={className}
      style={{
        width: spec.width,
        height: spec.height,
        pointerEvents: 'none',
        ...style,
      }}
      title={vehicleId}
    >
      <div
        className="relative h-full w-full"
        style={{ '--map-vehicle-bg': bgColor } as CSSProperties}
      >
        {sorted.map((layer) => {
          if (layer.kind === 'css') {
            return (
              <div
                key={layer.id}
                aria-hidden
                style={{ ...layer.style, zIndex: layer.zIndex }}
              />
            )
          }
          if (layer.kind === 'svg-body') {
            return (
              <div
                key={layer.id}
                className="pointer-events-none absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2"
                style={{ zIndex: layer.zIndex }}
              >
                <VehicleBodySvg
                  bgColor={bgColor}
                  size={Math.round(spec.width * 0.88)}
                />
              </div>
            )
          }
          if (layer.kind === 'label' && showLabel) {
            return (
              <span key={layer.id} style={{ ...layer.style, zIndex: layer.zIndex }}>
                {vehicleId}
              </span>
            )
          }
          return null
        })}
      </div>
    </div>
  )
}
