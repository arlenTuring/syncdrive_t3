import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import type { DispatchListItem } from '../types';
import { isDispatchRevocable } from '../types';
import {
  CreateDispatchConfirmTitle,
  CreateDispatchConfirmStep,
} from './CreateDispatchConfirmStep';
import { Button, Dialog } from '../../../components/ui';

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
  const { t } = useTranslation();
  const [phrase, setPhrase] = useState('');
  const approvePhrase = t('dispatchScheduling.confirm.approvePhrase');
  const canApprove =
    mode === 'approve'
    && (phrase.trim() === approvePhrase || phrase.trim() === APPROVE_PHRASE);
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
    <Dialog
      padded={false}
      title={<CreateDispatchConfirmTitle title={isApprove ? t('dispatchScheduling.confirm.dualVerifyTitle') : t('dispatchScheduling.confirm.taskTitle')} />}
      onClose={onClose}
      widthClassName="w-full max-w-xl"
      heightClassName="max-h-[92vh]"
    >
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
          confirmLabel={t('dispatchScheduling.confirm.approveAndCreate')}
          confirmPlaceholder={t('dispatchScheduling.confirm.approvePlaceholder')}
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
                <Button hierarchy="danger" variant="outlined" onPress={() => onReject?.(row)}>{t('dispatchScheduling.confirm.reject')}</Button>
                <Button disabled={!canApprove} onPress={() => onApprove?.(row)}>{t('dispatchScheduling.confirm.approve')}</Button>
              </>
            ) : (
              <Button hierarchy="danger" variant="outlined" onPress={() => onWithdraw?.(row)}>{t('dispatchScheduling.confirm.withdraw')}</Button>
            )}
          </footer>
        ) : null}
      </Dialog>
  );
}
