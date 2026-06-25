import { createContext, useContext, useMemo, type ReactNode } from 'react'
import {
  defaultMapExtentMeters,
  mapWorldSizeFromExtent,
  type MapExtentMeters,
} from '../constants/mapExtent'

export type MapExtentContextValue = MapExtentMeters & {
  worldW: number
  worldH: number
}

const MapExtentContext = createContext<MapExtentContextValue | null>(null)

export function MapExtentProvider({
  extent,
  children,
}: {
  extent: MapExtentMeters
  children: ReactNode
}) {
  const value = useMemo(() => {
    const { widthM, heightM, worldW, worldH } = mapWorldSizeFromExtent(extent)
    return {
      width: widthM,
      height: heightM,
      worldW,
      worldH,
    }
  }, [extent.width, extent.height])

  return (
    <MapExtentContext.Provider value={value}>{children}</MapExtentContext.Provider>
  )
}

export function useMapExtent(): MapExtentContextValue {
  const ctx = useContext(MapExtentContext)
  if (!ctx) {
    const fallback = mapWorldSizeFromExtent(defaultMapExtentMeters())
    return {
      width: fallback.widthM,
      height: fallback.heightM,
      worldW: fallback.worldW,
      worldH: fallback.worldH,
    }
  }
  return ctx
}
