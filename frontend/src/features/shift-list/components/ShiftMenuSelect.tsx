import { useTranslation } from 'react-i18next';
import { SiteSelect, type SiteSelectGroup, type SiteSelectOption } from '../../../components/SiteSelect';

export type ShiftMenuOption = SiteSelectOption;
export type ShiftMenuGroup = SiteSelectGroup;

/** 舊呼叫端的薄介面；選單行為與浮層由全站共用 SiteSelect 提供。 */
export function ShiftMenuSelect({
  label,
  value,
  placeholder,
  options,
  groups,
  onChange,
  widthClass = 'w-[176px] shrink-0',
  panelWidth = 160,
  disabled = false,
  hideLabel = false,
  size = 'md',
  triggerClassName = '',
  'aria-label': ariaLabel,
}: {
  label: string;
  value: string;
  placeholder?: string;
  options?: ShiftMenuOption[];
  groups?: ShiftMenuGroup[];
  onChange: (value: string) => void;
  widthClass?: string;
  panelWidth?: number;
  disabled?: boolean;
  hideLabel?: boolean;
  size?: 'sm' | 'md';
  triggerClassName?: string;
  'aria-label'?: string;
}) {
  const { t } = useTranslation();
  return (
    <div className={widthClass}>
      {hideLabel ? null : <span className="mb-1.5 block text-xs leading-none text-zinc-400">{label}</span>}
      <SiteSelect
        value={value}
        options={options}
        groups={groups}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        panelWidth={panelWidth}
        placeholder={placeholder ?? t('shiftList.menuSelect.placeholder')}
        aria-label={ariaLabel || label || t('shiftList.menuSelect.menuAria')}
        className={`w-full border border-zinc-700/80 bg-zinc-900/80 text-zinc-100 focus:border-[#2B7FFF] focus:outline-none focus:ring-1 focus:ring-[#2B7FFF]/30 ${
          size === 'sm' ? 'h-8 rounded-md px-2 text-xs' : 'h-10 rounded-lg px-3 text-sm'
        } ${triggerClassName}`}
      />
    </div>
  );
}
