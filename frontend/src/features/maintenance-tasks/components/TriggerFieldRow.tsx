import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { sanitizeIntegerInput } from '../utils/numericInput';
import { Checkbox, cn, fieldClass } from '../../../components/ui';

const INLINE_INPUT_ENABLED =
  cn(fieldClass({ size: 'md', fullWidth: false }), 'w-[90%] min-w-[180px] flex-1 max-w-[900px]');

type TriggerFieldRowProps = {
  label: ReactNode;
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  value: string;
  onValueChange: (value: string) => void;
  prefixText: string;
  suffixText: string;
  disabledMessage?: string;
  inputClassName?: string;
  sanitizeValue?: (raw: string) => string;
  /** 為 false 時不顯示勾選框，欄位視為必填（由上層區塊開關控制是否啟用） */
  showToggle?: boolean;
  required?: boolean;
};

export function TriggerFieldRow({
  label,
  enabled,
  onEnabledChange,
  value,
  onValueChange,
  prefixText,
  suffixText,
  disabledMessage,
  inputClassName = INLINE_INPUT_ENABLED,
  sanitizeValue = sanitizeIntegerInput,
  showToggle = true,
  required = false,
}: TriggerFieldRowProps) {
  const { t } = useTranslation();
  const resolvedDisabledMessage =
    disabledMessage ?? t('maintenanceTasks.triggerField.disabledDefault');
  const fieldActive = showToggle ? enabled : true;

  return (
    <div className={fieldActive ? '' : 'opacity-50'}>
      {showToggle ? (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-body-s text-text-secondary">
          <Checkbox checked={enabled} onCheckedChange={(checked) => onEnabledChange(checked)} />
          {label}
        </label>
      ) : (
        <div className="mb-2 flex items-center gap-1 text-body-s text-text-secondary">
          {required && <span className="text-status-error">*</span>}
          {label}
        </div>
      )}

      {fieldActive ? (
        <div className="flex w-full flex-wrap items-center gap-2 text-body-s text-text-secondary">
          <span>{prefixText}</span>
          <input
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => onValueChange(sanitizeValue(e.target.value))}
            placeholder={t('maintenanceTasks.triggerField.placeholder')}
            className={inputClassName}
          />
          <span>{suffixText}</span>
        </div>
      ) : (
        <p className="text-body-s text-text-disabled">{resolvedDisabledMessage}</p>
      )}
    </div>
  );
}
