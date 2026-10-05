import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { DashboardPlane, PlaneDataSettings } from '../types';

/**
 * 目前這張儀表板的資料設定（「資料設定」視窗存的那份，伺服器 dashboard_planes.data_settings）。
 *
 * 元件綁的是資料來源 ID（例如 default-internal、default-mqtt）。每張儀表板可以把這些 ID 對應到
 * 自己選的連線定義；沒對應的照元件原本的 ID。SQL 查詢、MQTT 訂閱、REST 載入都經過這裡解析，
 * 解析後的 ID 也是查詢快取的 key——所以切換儀表板不會拿到上一張的資料，改 A 的選擇也不會動到 B。
 */
export type PlaneSourceResolver = (id: string) => string;

export function resolvePlaneSourceId(settings: PlaneDataSettings | undefined | null, id: string): string;
export function resolvePlaneSourceId(settings: PlaneDataSettings | undefined | null, id: string | undefined): string | undefined;
export function resolvePlaneSourceId(settings: PlaneDataSettings | undefined | null, id: string | undefined): string | undefined {
  if (!id) return id;
  return settings?.sourceMap?.[id] || id;
}

interface PlaneDataSourceValue {
  planeId: string | null;
  resolve: PlaneSourceResolver;
}

const identity: PlaneSourceResolver = (id) => id;
const PlaneDataSourceContext = createContext<PlaneDataSourceValue>({ planeId: null, resolve: identity });

export function PlaneDataSourceProvider({
  plane,
  children,
}: {
  plane: Pick<DashboardPlane, 'id' | 'dataSettings'> | null | undefined;
  children: ReactNode;
}) {
  const planeId = plane?.id ?? null;
  const mapKey = JSON.stringify(plane?.dataSettings?.sourceMap ?? {});
  const value = useMemo<PlaneDataSourceValue>(() => {
    const sourceMap = JSON.parse(mapKey) as Record<string, string>;
    return { planeId, resolve: (id) => resolvePlaneSourceId({ sourceMap }, id) };
  }, [planeId, mapKey]);
  return <PlaneDataSourceContext.Provider value={value}>{children}</PlaneDataSourceContext.Provider>;
}

/** 目前儀表板的來源解析器（不在任何儀表板裡時原樣回傳） */
export function usePlaneSourceResolver(): PlaneSourceResolver {
  return useContext(PlaneDataSourceContext).resolve;
}

/** 單一來源 ID 解析成這張儀表板實際使用的定義 ID */
export function usePlaneSourceId(id: string): string;
export function usePlaneSourceId(id: string | undefined): string | undefined;
export function usePlaneSourceId(id: string | undefined): string | undefined {
  const resolve = usePlaneSourceResolver();
  return id ? resolve(id) : id;
}
