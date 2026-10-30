import {
  createContext,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import type { DashboardPlane } from '../types';
import {
  collectBindingIssues,
  collectBindingIssuesWithPing,
  issuesByRefId,
  type BindingIssue,
} from '../template/bindingHealth';

interface BindingHealthContextValue {
  issues: BindingIssue[];
  issueMap: Map<string, BindingIssue>;
  isChecking: boolean;
  refresh: () => void;
}

const BindingHealthContext = createContext<BindingHealthContextValue | null>(null);
/**
 * 只放 issueMap：每個畫布元件都要查自己有沒有綁定問題，但不需要「檢查中」這類狀態。
 * 跟完整 context 分開，30 秒一次的連線檢查來回切 isChecking 時，畫布元件不會整批重畫。
 */
const EMPTY_ISSUE_MAP = new Map<string, BindingIssue>();
const BindingIssueMapContext = createContext<Map<string, BindingIssue>>(EMPTY_ISSUE_MAP);

/** 內容一樣就沿用舊陣列：定時重檢的結果多半沒變，換新陣列會讓所有消費者重畫 */
function keepIfSame(prev: BindingIssue[], next: BindingIssue[]): BindingIssue[] {
  if (prev === next) return prev;
  if (prev.length !== next.length) return next;
  return JSON.stringify(prev) === JSON.stringify(next) ? prev : next;
}

export function BindingHealthProvider({
  plane,
  enabled,
  children,
}: {
  plane: DashboardPlane | null;
  enabled: boolean;
  children: ReactNode;
}) {
  const [issues, setIssues] = useState<BindingIssue[]>([]);
  const [isChecking, setIsChecking] = useState(false);
  const [tick, setTick] = useState(0);

  const refresh = () => setTick(t => t + 1);

  const planeKey = plane ? `${plane.id}:${plane.updatedAt ?? 0}` : '';

  useEffect(() => {
    if (!enabled || !plane) {
      setIssues((prev) => keepIfSame(prev, []));
      return;
    }

    const staticIssues = collectBindingIssues(plane);
    setIssues((prev) => keepIfSame(prev, staticIssues));

    let cancelled = false;
    setIsChecking(true);
    collectBindingIssuesWithPing(plane)
      .then(full => {
        if (!cancelled) setIssues((prev) => keepIfSame(prev, full));
      })
      .finally(() => {
        if (!cancelled) setIsChecking(false);
      });

    const onDsChange = () => setTick(t => t + 1);
    window.addEventListener('syncdrive-datasources-changed', onDsChange);

    const interval = window.setInterval(() => setTick(t => t + 1), 30_000);

    return () => {
      cancelled = true;
      window.removeEventListener('syncdrive-datasources-changed', onDsChange);
      clearInterval(interval);
    };
  }, [planeKey, enabled, tick]);

  const issueMap = useMemo(() => issuesByRefId(issues), [issues]);
  const value = useMemo(
    () => ({
      issues,
      issueMap,
      isChecking,
      refresh,
    }),
    [issues, issueMap, isChecking],
  );

  return (
    <BindingHealthContext.Provider value={value}>
      <BindingIssueMapContext.Provider value={issueMap}>
        {children}
      </BindingIssueMapContext.Provider>
    </BindingHealthContext.Provider>
  );
}

export function useBindingHealth() {
  const ctx = useContext(BindingHealthContext);
  if (!ctx) {
    return {
      issues: [] as BindingIssue[],
      issueMap: new Map<string, BindingIssue>(),
      isChecking: false,
      refresh: () => {},
    };
  }
  return ctx;
}

/** 只要查綁定問題（畫布元件、屬性面板）用這個，不會因為「檢查中」切換而重畫 */
export function useBindingIssueMap(): Map<string, BindingIssue> {
  return useContext(BindingIssueMapContext);
}
