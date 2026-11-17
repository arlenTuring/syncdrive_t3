import { useTranslation } from 'react-i18next'

type WorkspaceTab = 'map' | 'trajectory'

type WorkspaceTabsProps = {
  value: WorkspaceTab
  onChange: (tab: WorkspaceTab) => void
}

export function WorkspaceTabs({ value, onChange }: WorkspaceTabsProps) {
  const { t } = useTranslation()

  return (
    <div
      className="flex shrink-0 gap-1 border-b border-border-quaternary bg-surface-sub-background px-4 pt-3"
      role="tablist"
      aria-label={t('mapEditor.workspaceAria')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'map'}
        className={`rounded-t-md border border-b-0 px-4 py-2 text-body-s font-medium transition ${
          value === 'map'
            ? 'border-border-tertiary bg-surface-primary text-text-theme-light'
            : 'border-transparent bg-transparent text-text-quaternary hover:text-text-secondary'
        }`}
        onClick={() => onChange('map')}
      >
        {t('mapEditor.tabMap')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'trajectory'}
        className={`rounded-t-md border border-b-0 px-4 py-2 text-body-s font-medium transition ${
          value === 'trajectory'
            ? 'border-border-tertiary bg-surface-primary text-text-theme-light'
            : 'border-transparent bg-transparent text-text-quaternary hover:text-text-secondary'
        }`}
        onClick={() => onChange('trajectory')}
      >
        {t('mapEditor.tabTrajectory')}
      </button>
    </div>
  )
}

export type { WorkspaceTab }
