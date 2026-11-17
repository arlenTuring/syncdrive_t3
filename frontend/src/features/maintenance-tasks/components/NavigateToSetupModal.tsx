import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { Button, Dialog } from '../../../components/ui';

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
    <Dialog
      title={t('shiftList.navigateSetup.title')}
      onClose={onClose}
      widthClassName="w-full max-w-[520px]"
      footer={(
        <>
          {onSecondary && secondaryLabel ? (
            <Button hierarchy="subordinate" variant="outlined" onPress={onSecondary}>{secondaryLabel}</Button>
          ) : null}
          <Button onPress={onConfirm}>{resolvedPrimary}</Button>
        </>
      )}
    >
      <p className="text-body-s text-text-tertiary">{t('shiftList.navigateSetup.body')}</p>
    </Dialog>
  );
}
