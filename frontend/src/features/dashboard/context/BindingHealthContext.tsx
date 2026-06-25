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
      setIssues([]);
      return;
    }

    const staticIssues = collectBindingIssues(plane);
    setIssues(staticIssues);

    let cancelled = false;
    setIsChecking(true);
    collectBindingIssuesWithPing(plane)
      .then(full => {
        if (!cancelled) setIssues(full);
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

  const value = useMemo(
    () => ({
      issues,
      issueMap: issuesByRefId(issues),
      isChecking,
      refresh,
    }),
    [issues, isChecking],
  );

  return (
    <BindingHealthContext.Provider value={value}>
      {children}
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
