import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { DrivingCapabilityModal } from '../shift-records/components/DrivingCapabilityModal';
import { DeploymentShiftTable } from './components/DeploymentShiftTable';
import { ScheduleAdjustApplyDialog } from './components/ScheduleAdjustApplyDialog';
import { SummaryCards } from './components/SummaryCards';
import { VehicleControlSection } from './components/VehicleControlSection';
import { cancelShiftOrder, setDispatchEnabled, useDeploymentData } from './hooks/useDeploymentData';
import type { ShiftDeploymentAction } from './types';
import { systemConfirm } from '../../lib/systemDialog';
import { Button } from '../../components/ui';

export function ShiftDeploymentPage() {
  const { t } = useTranslation();
  const data = useDeploymentData();
  const [hint, setHint] = useState<string | null>(null);
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [detailOrderId, setDetailOrderId] = useState<string | null>(null);

  const describeAction = (action: ShiftDeploymentAction): string => {
    switch (action.kind) {
      case 'event-open':
        return t('shiftDeployment.actions.eventOpen');
      case 'vehicle-stop':
        return t('shiftDeployment.actions.vehicleStop', { vehicleCode: action.vehicleCode });
      case 'vehicle-start':
        return t('shiftDeployment.actions.vehicleStart', { vehicleCode: action.vehicleCode });
      case 'vehicle-reset':
        return t('shiftDeployment.actions.vehicleReset', { vehicleCode: action.vehicleCode });
      default:
        return t('shiftDeployment.actions.fallback');
    }
  };

  const onAction = async (action: ShiftDeploymentAction) => {
    if (action.kind === 'schedule-adjust') {
      setHint(null);
      setAdjustOpen(true);
      return;
    }
    if (action.kind === 'shift-detail') {
      setHint(null);
      setDetailOrderId(action.row.shiftKey);
      return;
    }
    if (action.kind === 'shift-cancel') {
      const { row } = action;
      if (!(await systemConfirm(t('shiftDeployment.actions.confirmCancel', { tripCode: row.tripCode })))) {
        return;
      }
      setHint(null);
      cancelShiftOrder(row.shiftKey)
        .then(() => {
          setHint(t('shiftDeployment.actions.cancelSuccess', { tripCode: row.tripCode }));
          data.reload();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setHint(t('shiftDeployment.actions.cancelFailed', { message }));
        });
      return;
    }
    if (action.kind === 'dispatch-pause' || action.kind === 'dispatch-start') {
      const enabling = action.kind === 'dispatch-start';
      const confirmKey = enabling
        ? 'shiftDeployment.actions.confirmDispatchStart'
        : 'shiftDeployment.actions.confirmDispatchPause';
      if (!(await systemConfirm(t(confirmKey)))) return;
      setHint(null);
      setDispatchEnabled(enabling)
        .then(() => {
          setHint(t(enabling
            ? 'shiftDeployment.actions.dispatchStarted'
            : 'shiftDeployment.actions.dispatchPaused'));
          data.reload();
        })
        .catch((err: unknown) => {
          const message = err instanceof Error ? err.message : String(err);
          setHint(t('shiftDeployment.actions.dispatchToggleFailed', { message }));
        });
      return;
    }
    setHint(describeAction(action));
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      {hint ? (
        <div className="shrink-0 border-b border-border-theme-light bg-surface-theme px-5 py-2 text-body-xs text-text-theme">
          {hint}
          <Button variant="text" className="ml-3" onPress={() => setHint(null)}>{t('common.close')}</Button>
        </div>
      ) : null}
      <div className="flex min-h-0 flex-1 flex-col gap-4 overflow-auto p-4">
        <SummaryCards
          mode={data.mode}
          stats={data.stats}
          schedule={data.schedule}
          event={data.event}
          dispatchEnabled={data.dispatchEnabled}
          onAction={onAction}
        />
        <VehicleControlSection vehicles={data.vehicles} onAction={onAction} />
        <div className="flex min-h-[320px] flex-1 flex-col">
          <DeploymentShiftTable
            scheduleName={data.schedule.scheduleName}
            mainline={data.mainline}
            maintenance={data.maintenance}
            onAction={onAction}
          />
        </div>
      </div>
      {adjustOpen ? (
        <ScheduleAdjustApplyDialog
          onClose={() => setAdjustOpen(false)}
          currentScheduleName={data.schedule.scheduleName}
          onApplied={data.reload}
        />
      ) : null}
      {detailOrderId ? (
        <DrivingCapabilityModal
          orderId={detailOrderId}
          onClose={() => setDetailOrderId(null)}
        />
      ) : null}
    </div>
  );
}
