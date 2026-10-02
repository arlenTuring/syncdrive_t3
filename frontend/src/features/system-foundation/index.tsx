import { SystemFoundationPage } from './SystemFoundationPage';
import type { AdvancedManagementSection } from './components/AdvancedManagementPanel';

export default function SystemFoundationApp({
  initialTab,
  initialAdvancedSection,
}: {
  initialTab?: 'health' | 'settings' | 'advanced';
  initialAdvancedSection?: AdvancedManagementSection;
}) {
  return <SystemFoundationPage initialTab={initialTab} initialAdvancedSection={initialAdvancedSection} />;
}
