import type { ReactNode } from 'react';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { ShiftDeploymentAction, ShiftListTab, ShiftRow } from '../types';
import { ShiftRouteTrack } from './ShiftRouteTrack';

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
    <section className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800/80 bg-[#18181b]">
      <div className="flex shrink-0 items-end justify-between gap-3 border-b border-zinc-800 px-4 pt-3">
        <div className="flex gap-5">
          <TabButton active={tab === 'mainline'} onClick={() => setTab('mainline')}>
            {t('shiftDeployment.table.tabMainline')}
          </TabButton>
          <TabButton active={tab === 'maintenance'} onClick={() => setTab('maintenance')}>
            {t('shiftDeployment.table.tabMaintenance')}
          </TabButton>
        </div>
        <div className="pb-2 text-[12px] text-zinc-400">
          {t('shiftDeployment.table.currentSchedule')}{' '}
          <span className="text-zinc-200">{scheduleName}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-auto">
        <table className="w-full min-w-[980px] border-collapse text-left text-[13px]">
          <thead className="sticky top-0 bg-[#27272a] text-[12px] text-zinc-400">
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
                <td colSpan={7} className="px-4 py-10 text-center text-zinc-500">
                  {t('shiftDeployment.table.empty')}
                </td>
              </tr>
            ) : tab === 'mainline' ? (
              rows.map((row, index) => (
                <tr
                  key={row.shiftKey}
                  className="border-b border-white/5"
                  style={{ backgroundColor: index % 2 === 1 ? 'rgba(255,255,255,0.02)' : undefined }}
                >
                  <Td className="font-semibold text-zinc-100">{row.tripCode}</Td>
                  <Td className="text-zinc-300">{row.directionLabel}</Td>
                  <Td className="text-zinc-200">{row.vehicleCode}</Td>
                  <Td>
                    <ShiftRouteTrack row={row} />
                  </Td>
                  <Td>
                    <StatusPill row={row} />
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-400">{row.departTime}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => onAction({ kind: 'shift-detail', tab, row })}
                      className="text-sky-400 hover:underline"
                    >
                      {t('shiftDeployment.table.viewDetail')}
                    </button>
                  </Td>
                </tr>
              ))
            ) : (
              rows.map((row, index) => (
                <tr
                  key={row.shiftKey}
                  className="border-b border-white/5"
                  style={{ backgroundColor: index % 2 === 1 ? 'rgba(255,255,255,0.02)' : undefined }}
                >
                  <Td className="font-semibold text-zinc-100">{row.tripCode}</Td>
                  <Td className="text-zinc-200">{row.vehicleCode}</Td>
                  <Td className="text-zinc-300">{row.maintTypeLabel ?? '—'}</Td>
                  <Td>
                    <StatusPill row={row} />
                  </Td>
                  <Td className="whitespace-nowrap text-zinc-400">{row.departTime}</Td>
                  <Td>
                    <button
                      type="button"
                      onClick={() => onAction({ kind: 'shift-detail', tab, row })}
                      className="text-sky-400 hover:underline"
                    >
                      {t('shiftDeployment.table.viewDetail')}
                    </button>
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
      className={`border-b-2 pb-2 text-[14px] transition ${
        active
          ? 'border-blue-500 font-medium text-blue-400'
          : 'border-transparent text-zinc-500 hover:text-zinc-300'
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
      className="inline-flex rounded-full px-2.5 py-0.5 text-[12px] font-medium"
      style={{ backgroundColor: row.statusBg, color: row.statusColor }}
    >
      {row.statusLabel}
    </span>
  );
}
