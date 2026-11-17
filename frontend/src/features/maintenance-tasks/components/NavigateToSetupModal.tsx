import { X } from 'lucide-react';
import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog, IconButton } from '../../../components/ui';

type NavigateToSetupModalProps = {
  onClose: () => void;
  onConfirm: () => void;
  /**
   * 第二個按鈕（可選）：例如「手動製作」等分支流程。
   * 若未提供則僅顯示 primary 按鈕。
   */
  onSecondary?: () => void;
  primaryLabel?: string;
  secondaryLabel?: string;
};

export function NavigateToSetupModal({
  onClose,
  onConfirm,
  onSecondary,
  primaryLabel,
  secondaryLabel,
}: NavigateToSetupModalProps) {
  const { t } = useTranslation();
  const resolvedPrimary = primaryLabel ?? t('shiftList.navigateSetup.goSetup');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <Dialog headerless padded={false} title={t('shiftList.navigateSetup.title')} onClose={onClose} widthClassName="w-full max-w-[520px]">
<div className="px-8 py-8 flex min-h-0 flex-1 flex-col overflow-auto">
        <div className="flex items-start justify-between gap-4">
          <h2
            id="navigate-setup-title"
            className="text-headline-5 text-text-primary"
          >
            {t('shiftList.navigateSetup.title')}
          </h2>
          <IconButton hierarchy="subordinate" variant="standard" className="shrink-0" onPress={onClose} label={t('common.close')} icon={<X />} />
        </div>

        <p className="mt-4 text-body-s text-text-tertiary">
          {t('shiftList.navigateSetup.body')}
        </p>

        <div className="mt-8 flex justify-end">
          <div className="flex gap-3">
            {onSecondary && secondaryLabel ? (
              <Button hierarchy="subordinate" variant="outlined" onPress={onSecondary}>{secondaryLabel}</Button>
            ) : null}
            <Button onPress={onConfirm}>{resolvedPrimary}</Button>
          </div>
        </div>
      </div>
</Dialog>
  );
}
