import { Plus } from 'lucide-react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';

export const TIME_TEMPLATE_PANEL_HEADER_ROW_CLASS =
  'flex h-[34px] shrink-0 items-center gap-2 px-3 py-1.5';

export const TIME_TEMPLATE_PANEL_TITLE_CLASS =
  'whitespace-nowrap text-[16px] font-medium leading-[20px] text-[#F3F4F6]';

export const TIME_TEMPLATE_PANEL_ADD_BUTTON_CLASS =
  'inline-flex h-[34px] shrink-0 items-center justify-center gap-1.5 rounded-lg bg-[rgba(81,162,255,0.24)] px-3.5 py-2 text-sm font-medium leading-[18px] tracking-[0.5px] text-[#51A2FF] hover:bg-[rgba(81,162,255,0.32)] disabled:cursor-not-allowed disabled:opacity-40';

type TimeTemplatePanelTitleProps = {
  icon: ReactNode;
  title: string;
};

export function TimeTemplatePanelTitle({ icon, title }: TimeTemplatePanelTitleProps) {
  return (
    <div className="flex shrink-0 items-center gap-2">
      <span className="flex size-5 shrink-0 items-center justify-center text-[#99A1AF]">
        {icon}
      </span>
      <span className={TIME_TEMPLATE_PANEL_TITLE_CLASS}>{title}</span>
    </div>
  );
}

type TimeTemplatePanelAddButtonProps = {
  onClick: () => void;
  disabled?: boolean;
  title?: string;
};

export function TimeTemplatePanelAddButton({
  onClick,
  disabled = false,
  title,
}: TimeTemplatePanelAddButtonProps) {
  const { t } = useTranslation();
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={TIME_TEMPLATE_PANEL_ADD_BUTTON_CLASS}
      title={title}
    >
      <Plus className="size-[18px] shrink-0" strokeWidth={2} />
      {t('timeTemplates.panelAdd')}
    </button>
  );
}
