import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShiftDeploymentAction, ShiftListTab, ShiftRow } from '../types';
import { ShiftRouteTrack } from './ShiftRouteTrack';
import { Button } from '../../../components/ui';

export function DeploymentShiftTable({
  scheduleName,
  mainline,
  maintenance,
  onAction,
}: {
  scheduleName: string;
  mainline: ShiftRow[];
  maintenance: ShiftRow[];
  onAction: (action: ShiftDeploymentAction) => void;
}) {
  const { t } = useTranslation();
  const [tab, setTab] = useState<ShiftListTab>('mainline');
  const rows = tab === 'mainline' ? mainline : maintenance;

  return (
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-quaternary bg-surface-popup">
      <div className="flex shrink-0 items-end justify-between gap-3 border-b border-border-quaternary px-4 pt-3">
        <div className="flex gap-5">
          <TabButton active={tab === 'mainline'} onClick={() => setTab('mainline')}>
            {t('shiftDeployment.table.tabMainline')}
          </TabButton>
          <TabButton active={tab === 'maintenance'} onClick={() => setTab('maintenance')}>
            {t('shiftDeployment.table.tabMaintenance')}
          </TabButton>
        </div>
        <div className="pb-2 text-body-xs text-text-tertiary">
          {t('shiftDeployment.table.currentSchedule')}{' '}
          <span className="text-text-primary">{scheduleName}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-body-s">
          <thead className="sticky top-0 bg-surface-secondary text-body-xs text-text-tertiary">
            <tr>
              {tab === 'mainline' ? (
                <>
                  <Th>{t('shiftDeployment.table.tripCode')}</Th>
                  <Th>{t('shiftDeployment.table.direction')}</Th>
                  <Th>{t('shiftDeployment.table.vehicle')}</Th>
                  <Th className="min-w-[280px]">{t('shiftDeployment.table.routeProgress')}</Th>
                  <Th>{t('shiftDeployment.table.shiftStatus')}</Th>
                  <Th>{t('shiftDeployment.table.departTime')}</Th>
                  <Th>{t('shiftDeployment.table.actions')}</Th>
                </>
              ) : (
                <>
                  <Th>{t('shiftDeployment.table.taskCode')}</Th>
                  <Th>{t('shiftDeployment.table.assignedVehicle')}</Th>
                  <Th>{t('shiftDeployment.table.maintItem')}</Th>
                  <Th>{t('shiftDeployment.table.progressStatus')}</Th>
                  <Th>{t('shiftDeployment.table.expectedComplete')}</Th>
                  <Th>{t('shiftDeployment.table.actions')}</Th>
                </>
              )}
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-text-quaternary">
                  {t('shiftDeployment.table.empty')}
                </td>
              </tr>
            ) : tab === 'mainline' ? (
              rows.map((row, index) => (
                <tr
                  key={row.shiftKey}
                  className="border-b border-border-disabled"
                  style={{ backgroundColor: index % 2 === 1 ? 'rgba(255,255,255,0.02)' : undefined }}
                >
                  <Td className="font-semibold text-text-primary">{row.tripCode}</Td>
                  <Td className="text-text-secondary">{row.directionLabel}</Td>
                  <Td className="text-text-primary">{row.vehicleCode}</Td>
                  <Td>
                    <ShiftRouteTrack row={row} />
                  </Td>
                  <Td>
                    <StatusPill row={row} />
                  </Td>
                  <Td className="whitespace-nowrap text-text-tertiary">{row.departTime}</Td>
                  <Td>
                    <div className="flex items-center gap-3">
                      <Button variant="text" onPress={() => onAction({ kind: 'shift-detail', tab, row })}>{t('shiftDeployment.table.viewDetail')}</Button>
                      {row.orderStatus === 'PENDING' || row.orderStatus === 'PROCESSING' ? (
                        <Button hierarchy="danger" variant="text" onPress={() => onAction({ kind: 'shift-cancel', row })}>{t('shiftDeployment.table.cancel')}</Button>
                      ) : null}
                    </div>
                  </Td>
                </tr>
              ))
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.shiftKey}
                  className="border-b border-border-disabled"
                  style={{ backgroundColor: index % 2 === 1 ? 'rgba(255,255,255,0.02)' : undefined }}
                >
                  <Td className="font-semibold text-text-primary">{row.tripCode}</Td>
                  <Td className="text-text-primary">{row.vehicleCode}</Td>
                  <Td className="text-text-secondary">{row.maintTypeLabel ?? '—'}</Td>
                  <Td>
                    <StatusPill row={row} />
                  </Td>
                  <Td className="whitespace-nowrap text-text-tertiary">{row.departTime}</Td>
                  <Td>
                    <Button variant="text" onPress={() => onAction({ kind: 'shift-detail', tab, row })}>{t('shiftDeployment.table.viewDetail')}</Button>
                  </Td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={`border-b-2 pb-2 text-body-s transition ${
        active
          ? 'border-border-theme font-medium text-text-theme'
          : 'border-transparent text-text-quaternary hover:text-text-secondary'
      }`}
    >
      {children}
    </button>
  );
}

function Th({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <th className={`whitespace-nowrap px-3 py-2.5 font-medium ${className}`}>{children}</th>
  );
}

function Td({
  children,
  className = '',
}: {
  children: ReactNode;
  className?: string;
}) {
  return <td className={`px-3 py-2 align-middle ${className}`}>{children}</td>;
}

function StatusPill({ row }: { row: ShiftRow }) {
  return (
    <span
      className="inline-flex rounded-full px-2.5 py-0.5 text-body-xs-bold"
      style={{ backgroundColor: row.statusBg, color: row.statusColor }}
    >
      {row.statusLabel}
    </span>
  );
}
