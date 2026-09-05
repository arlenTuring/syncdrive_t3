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
      className="flex shrink-0 gap-1 border-b border-zinc-800 bg-zinc-950 px-4 pt-3"
      role="tablist"
      aria-label={t('mapEditor.workspaceAria')}
    >
      <button
        type="button"
        role="tab"
        aria-selected={value === 'map'}
        className={`rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition ${
          value === 'map'
            ? 'border-zinc-600 bg-zinc-900 text-cyan-200'
            : 'border-transparent bg-transparent text-zinc-500 hover:text-zinc-300'
        }`}
        onClick={() => onChange('map')}
      >
        {t('mapEditor.tabMap')}
      </button>
      <button
        type="button"
        role="tab"
        aria-selected={value === 'trajectory'}
        className={`rounded-t-md border border-b-0 px-4 py-2 text-sm font-medium transition ${
          value === 'trajectory'
            ? 'border-zinc-600 bg-zinc-900 text-cyan-200'
            : 'border-transparent bg-transparent text-zinc-500 hover:text-zinc-300'
        }`}
        onClick={() => onChange('trajectory')}
      >
        {t('mapEditor.tabTrajectory')}
      </button>
    </div>
  )
}

export type { WorkspaceTab }
