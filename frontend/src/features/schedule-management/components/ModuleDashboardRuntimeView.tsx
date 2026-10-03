import { AlertCircle, Loader2 } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { BindingHealthProvider } from '../../dashboard/context/BindingHealthContext';
import { DemoSimulationProvider } from '../../dashboard/context/DemoSimulationContext';
import { VehicleFleetMqttProvider } from '../../dashboard/context/VehicleFleetMqttContext';
import { FormatPainterProvider } from '../../dashboard/context/FormatPainterContext';
import { PlaneWorkspace } from '../../dashboard/PlaneWorkspace';
import type { DashboardPlane } from '../../dashboard/types';
import { VariableProvider } from '../../dashboard/VariableContext';
import { migratePlane } from '../../dashboard/utils/migrateDashboardPlane';
import { subscribeDatasourceInvalidation } from '../../dashboard/utils/datasourceInvalidationBus';
import { DASHBOARD_PLANES_TAG, fetchDashboardPlanes } from '../../dashboard/api/dashboardPlanesApi';
import { DASHBOARD_PLANES_STORAGE_KEY } from '../../../lib/canvasCacheReset';
import { findStoredDashboardPlane } from '../utils/moduleDashboardPages';

type ModuleDashboardRuntimeViewProps = {
  planeId: string;
  pageLabel: string;
};

const noop = () => undefined;

/**
 * 模組子頁：固定檢視模式載入儀表板平面（無編輯／狀態列）。
 */
export function ModuleDashboardRuntimeView({
  planeId,
  pageLabel,
}: ModuleDashboardRuntimeViewProps) {
  const { t } = useTranslation();

  /**
   * 版面以後端為準，每次進來都向後端拿；版面被別人存檔（或遷移腳本更新）時，後端會發
   * table:dashboard_planes 失效通知，這裡跟著重抓。
   *
   * 本機快取只在後端連不上時頂著用。原本是「有快取就直接用、不再問後端」：快取裡如果
   * 是舊版面（例如整備來源還是舊的班表查詢），執行畫面就一直照舊查詢長出卡片。
   */
  const [fetched, setFetched] = useState<{
    planeId: string;
    plane: DashboardPlane | null;
    failed: boolean;
  } | null>(null);
  const [reloadNonce, setReloadNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    void fetchDashboardPlanes()
      .then((planes) => {
        if (cancelled) return;
        try {
          if (planes.length > 0) window.localStorage.setItem(DASHBOARD_PLANES_STORAGE_KEY, JSON.stringify(planes));
        } catch {
          /* 快取寫不進去不影響顯示 */
        }
        setFetched({ planeId, plane: planes.find((item) => item.id === planeId) ?? null, failed: false });
      })
      .catch(() => {
        if (!cancelled) setFetched({ planeId, plane: null, failed: true });
      });
    return () => {
      cancelled = true;
    };
  }, [planeId, reloadNonce]);

  useEffect(() => subscribeDatasourceInvalidation((payload) => {
    if (payload.tags.includes(DASHBOARD_PLANES_TAG)) setReloadNonce((value) => value + 1);
  }), []);

  const current = fetched?.planeId === planeId ? fetched : null;
  const storedPlane = current
    ? (current.failed ? findStoredDashboardPlane(planeId) : current.plane)
    : null;
  const resolving = !current;
  /**
   * 跟儀表板編輯器載入時套同一組遷移（含泛用群組內部來源的系統查詢升級）。
   * 少了這一步，編輯器裡看到的是新版、模組子頁卻還在畫舊的那一份。
   */
  const storedKey = storedPlane
    ? `${storedPlane.id}:${storedPlane.serverVersion ?? ''}:${storedPlane.updatedAt}:${storedPlane.elements.length}`
    : '';
  const plane = useMemo(
    () => (storedPlane ? migratePlane(storedPlane) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storedKey],
  );

  if (resolving) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[#0a0a0b] px-6 text-center">
        <Loader2 className="size-8 animate-spin text-zinc-500" />
        <p className="text-xs text-zinc-500">{t('shell.moduleDashboard.loading')}</p>
      </div>
    );
  }

  if (!plane) {
    return (
      <div className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 bg-[#0a0a0b] px-6 text-center">
        <AlertCircle className="size-10 text-amber-500/80" />
        <div>
          <p className="text-sm font-medium text-zinc-200">
            {t('shell.moduleDashboard.notFoundTitle')}
          </p>
          <p className="mt-1 text-xs text-zinc-500">
            {t('shell.moduleDashboard.notFoundHint', { name: pageLabel })}
          </p>
        </div>
      </div>
    );
  }

  return (
    <DemoSimulationProvider>
      <VehicleFleetMqttProvider>
        <BindingHealthProvider plane={plane} enabled>
          <FormatPainterProvider
            value={{
              armed: null,
              arm: noop,
              cancel: noop,
              canApplyTo: () => false,
              apply: () => false,
            }}
          >
            <div className="flex min-h-0 flex-1 flex-col overflow-hidden bg-zinc-950">
              <VariableProvider variables={{}}>
                <PlaneWorkspace
                  plane={plane}
                  selectedElementId={null}
                  selectedElementIds={[]}
                  selectedChildId={null}
                  selectedChildIds={[]}
                  isEditMode={false}
                  onSelectElement={noop}
                  onSelectElements={noop}
                  onSelectChild={noop}
                  onSelectChildren={noop}
                  onUpdateElement={noop}
                  onBatchUpdateElements={noop}
                  onDeleteElement={noop}
                  onAddChild={noop}
                  onUpdateChild={noop}
                  onBatchUpdateChildren={noop}
                  onDeleteChild={noop}
                  onAddCanvas={noop}
                />
              </VariableProvider>
            </div>
          </FormatPainterProvider>
        </BindingHealthProvider>
      </VehicleFleetMqttProvider>
    </DemoSimulationProvider>
  );
}
