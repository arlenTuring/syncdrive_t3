import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DashboardEditor from '../../dashboard'
import { DataManagementPanel } from './DataManagementPanel'

export type AdvancedManagementSection = 'dashboard' | 'data'

export function AdvancedManagementPanel({
  initialSection = 'dashboard',
}: {
  initialSection?: AdvancedManagementSection
}) {
  const { t } = useTranslation()
  const [section, setSection] = useState<AdvancedManagementSection>(initialSection)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-zinc-800 bg-black">
      <div className="flex shrink-0 gap-1 border-b border-zinc-800 bg-zinc-950 px-3 pt-2">
        {(['dashboard', 'data'] as const).map((id) => (
          <button
            key={id}
            type="button"
            onClick={() => setSection(id)}
            className={`border-b-2 px-4 py-2 text-sm transition ${
              section === id
                ? 'border-sky-400 text-sky-300'
                : 'border-transparent text-zinc-500 hover:text-zinc-200'
            }`}
          >
            {t(`systemFoundation.advanced.${id}`)}
          </button>
        ))}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        {section === 'dashboard' ? (
          <DashboardEditor />
        ) : <DataManagementPanel />}
      </div>
    </div>
  )
}
