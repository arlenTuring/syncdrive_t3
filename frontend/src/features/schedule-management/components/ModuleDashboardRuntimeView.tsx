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
import { patchDashboardRuntimeFixes } from '../../dashboard/utils/migrateVehicleMonitorProtocol';
import {
  findStoredDashboardPlane,
  refreshDashboardPlanesCache,
} from '../utils/moduleDashboardPages';

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
   * 先查本機快取，查不到再問後端。
   *
   * 版面是後端資產，本機只是快取——乾淨的瀏覽器（或清過快取的）第一次點進來時
   * 快取一定是空的。少了這一段補抓，畫面會直接說「平面可能已被刪除」，但它其實
   * 好端端地在資料庫裡，而使用者被指去做一件不該做的事：重新新增子頁。
   */
  const cached = findStoredDashboardPlane(planeId);
  const [fetched, setFetched] = useState<{
    planeId: string;
    plane: DashboardPlane | null;
  } | null>(null);

  const storedPlane = cached ?? (fetched?.planeId === planeId ? fetched.plane : null);
  const resolving = !cached && fetched?.planeId !== planeId;
  /**
   * 跟儀表板編輯器載入時套同一組執行期修正（例如舊版整備分佈換成新元件）。
   * 少了這一步，編輯器裡看到的是新版、模組子頁卻還在畫舊的那一份。
   * cached 每次 render 都是新物件，用版面身分與更新時間當相依。
   */
  const storedKey = storedPlane ? `${storedPlane.id}:${storedPlane.updatedAt}:${storedPlane.elements.length}` : '';
  const plane = useMemo(
    () => (storedPlane ? patchDashboardRuntimeFixes(storedPlane) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [storedKey],
  );

  useEffect(() => {
    if (cached) return undefined;
    let cancelled = false;
    void refreshDashboardPlanesCache().then((planes) => {
      if (cancelled) return;
      setFetched({ planeId, plane: planes.find((item) => item.id === planeId) ?? null });
    });
    return () => {
      cancelled = true;
    };
    // cached 是每次 render 新建的物件，用布林值當相依才不會讓 effect 反覆重跑
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [planeId, Boolean(cached)]);

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
