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
      className="flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-amber-950/40 border border-amber-600/50
                 text-amber-300 text-xs font-bold hover:bg-amber-900/50 transition-colors max-w-[280px]"
    >
      {isChecking ? <RefreshCw size={12} className="animate-spin" /> : <AlertTriangle size={12} />}
      <span className="truncate">
        {isChecking ? '檢查連線…' : summary.displayLabel}
      </span>
    </button>
  );
}
