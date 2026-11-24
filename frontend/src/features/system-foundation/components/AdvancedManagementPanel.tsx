import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import DashboardEditor from '../../dashboard'
import { DataManagementPanel } from './DataManagementPanel'
import { Tabs, tabPanelProps } from '../../../components/ui';

export type AdvancedManagementSection = 'dashboard' | 'data'

export function AdvancedManagementPanel({
  initialSection = 'dashboard',
}: {
  initialSection?: AdvancedManagementSection
}) {
  const { t } = useTranslation()
  const [section, setSection] = useState<AdvancedManagementSection>(initialSection)

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-xl border border-border-quaternary bg-surface-sub-background">
      <div className="flex shrink-0 border-b border-border-quaternary bg-surface-sub-background px-3 pt-2">
        <Tabs
          idBase="advanced-management"
          value={section}
          onChange={setSection}
          items={(['dashboard', 'data'] as const).map((id) => ({ id, label: t(`systemFoundation.advanced.${id}`) }))}
        />
      </div>
      <div {...tabPanelProps('advanced-management', section)} className="min-h-0 flex-1 overflow-hidden">
        {section === 'dashboard' ? (
          <DashboardEditor />
        ) : <DataManagementPanel />}
      </div>
    </div>
  )
}
