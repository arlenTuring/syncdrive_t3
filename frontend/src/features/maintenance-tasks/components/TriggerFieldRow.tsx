import type { ReactNode } from 'react';
import { sanitizeIntegerInput } from '../utils/numericInput';

const INLINE_INPUT_ENABLED =
  'h-[42px] w-[90%] min-w-[180px] flex-1 max-w-[900px] rounded-lg border border-zinc-700/80 bg-zinc-900/80 px-3 text-sm text-zinc-100 placeholder:text-zinc-600 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30';

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
  disabledMessage = '不偵測此項目',
  inputClassName = INLINE_INPUT_ENABLED,
  sanitizeValue = sanitizeIntegerInput,
  showToggle = true,
  required = false,
}: TriggerFieldRowProps) {
  const fieldActive = showToggle ? enabled : true;

  return (
    <div className={fieldActive ? '' : 'opacity-50'}>
      {showToggle ? (
        <label className="mb-2 flex cursor-pointer items-center gap-2 text-sm text-zinc-300">
          <input
            type="checkbox"
            checked={enabled}
            onChange={(e) => onEnabledChange(e.target.checked)}
            className="size-4 shrink-0 rounded border-zinc-600 bg-zinc-900 text-[#2B7FFF] focus:ring-[#2B7FFF]/30"
          />
          {label}
        </label>
      ) : (
        <div className="mb-2 flex items-center gap-1 text-sm text-zinc-300">
          {required && <span className="text-red-500">*</span>}
          {label}
        </div>
      )}

      {fieldActive ? (
        <div className="flex w-full flex-wrap items-center gap-2 text-sm text-zinc-300">
          <span>{prefixText}</span>
          <input
            type="text"
            inputMode="numeric"
            value={value}
            onChange={(e) => onValueChange(sanitizeValue(e.target.value))}
            placeholder="請輸入"
            className={inputClassName}
          />
          <span>{suffixText}</span>
        </div>
      ) : (
        <p className="text-sm text-zinc-600">{disabledMessage}</p>
      )}
    </div>
  );
}
