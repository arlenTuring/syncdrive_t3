import { AlertTriangle, RefreshCw } from 'lucide-react';
import { useBindingHealth } from '../context/BindingHealthContext';
import { summarizeBindingIssues } from '../template/bindingHealth';

export function BindingIssuesBar() {
  const { issues, isChecking, refresh } = useBindingHealth();
  if (issues.length === 0 && !isChecking) return null;

  const summary = summarizeBindingIssues(issues);

  return (
    <button
      type="button"
      onClick={refresh}
      title={summary.tooltip}
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-status-warning-light border border-status-warning-light
                 text-status-warning text-body-xs font-bold hover:bg-status-warning-light transition-colors max-w-[280px]"
    >
      {isChecking ? <RefreshCw size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
      <span className="truncate">
        {isChecking ? '檢查連線…' : summary.displayLabel}
      </span>
    </button>
  );
}
