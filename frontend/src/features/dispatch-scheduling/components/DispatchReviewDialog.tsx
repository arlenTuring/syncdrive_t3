import { useState } from 'react';
import type { DispatchListItem } from '../types';
import { isDispatchRevocable } from '../types';
import {
  CreateDispatchConfirmHeader,
  CreateDispatchConfirmStep,
} from './CreateDispatchConfirmStep';

const APPROVE_PHRASE = '核准';

type DispatchReviewMode = 'view' | 'approve';

type DispatchReviewDialogProps = {
  row: DispatchListItem;
  mode: DispatchReviewMode;
  onClose: () => void;
  onApprove?: (row: DispatchListItem) => void;
  onReject?: (row: DispatchListItem) => void;
  onWithdraw?: (row: DispatchListItem) => void;
};

function execTimeFromRow(row: DispatchListItem): string {
  if (row.exec_time) return row.exec_time;
  const match = /(\d{2}):(\d{2})/.exec(row.created_at);
  return match ? `${match[1]}:${match[2]}` : '00:00';
}

function execDisplayFromRow(row: DispatchListItem): string {
  const datePart = row.created_at.split(' ')[0] || '';
  return `${datePart} ${execTimeFromRow(row)}`.trim();
}

export function DispatchReviewDialog({
  row,
  mode,
  onClose,
  onApprove,
  onReject,
  onWithdraw,
}: DispatchReviewDialogProps) {
  const [phrase, setPhrase] = useState('');
  const canApprove = mode === 'approve' && phrase.trim() === APPROVE_PHRASE;
  const canWithdraw = isDispatchRevocable(row.status);
  const isApprove = mode === 'approve';
  const showFooter = isApprove || canWithdraw;
  const stations = row.stations?.length
    ? row.stations
    : [
        {
          id: `${row.dispatch_id}-loc`,
          stationId: row.location,
          name: row.location,
          taskLabels: [],
        },
      ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4">
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="create-dispatch-title"
        className="flex max-h-[92vh] w-full max-w-xl flex-col overflow-hidden rounded-2xl border border-zinc-800 bg-[#18181b] shadow-2xl"
      >
        <CreateDispatchConfirmHeader
          onClose={onClose}
          title={isApprove ? '派遣任務雙重確認' : '派遣任務'}
        />
        <CreateDispatchConfirmStep
          execTime={execTimeFromRow(row)}
          execDisplay={execDisplayFromRow(row)}
          priority={row.priority}
          vehicleCode={row.vehicle_code}
          tripMinutes={row.trip_minutes ?? 30}
          stations={stations}
          confirmText={phrase}
          onConfirmTextChange={setPhrase}
          showConfirmField={isApprove}
          confirmLabel="輸入核准並建立"
          confirmPlaceholder="核准"
          variant={isApprove ? 'approval' : 'pending'}
          dispatchStatus={row.status}
        />
        {showFooter ? (
          <footer
            className={`flex shrink-0 items-center px-6 py-4 ${
              isApprove ? 'justify-between' : 'justify-start'
            }`}
          >
            {isApprove ? (
              <>
                <button
                  type="button"
                  onClick={() => onReject?.(row)}
                  className="rounded-lg border border-red-500 px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10"
                >
                  駁回
                </button>
                <button
                  type="button"
                  disabled={!canApprove}
                  onClick={() => onApprove?.(row)}
                  className="rounded-lg bg-[#2B7FFF] px-4 py-2 text-sm font-medium text-white hover:bg-[#2569e6] disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500"
                >
                  核准
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => onWithdraw?.(row)}
                className="rounded-lg border border-red-500 bg-transparent px-4 py-2 text-sm font-medium text-red-500 hover:bg-red-500/10"
              >
                撤銷申請
              </button>
            )}
          </footer>
        ) : null}
      </div>
    </div>
  );
}
