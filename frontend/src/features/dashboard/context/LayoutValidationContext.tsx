import { createContext, useContext, useMemo, type ReactNode } from 'react';
import type { LayoutIssue } from '../utils/collision';
import { layoutIssuesByRefId } from '../utils/collision';

interface LayoutValidationContextValue {
  issues: LayoutIssue[];
  issueMap: Map<string, LayoutIssue>;
  hasIssues: boolean;
}

const LayoutValidationContext = createContext<LayoutValidationContextValue | null>(null);

export function LayoutValidationProvider({
  issues,
  children,
}: {
  issues: LayoutIssue[];
  children: ReactNode;
}) {
  const value = useMemo(
    () => ({
      issues,
      issueMap: layoutIssuesByRefId(issues),
      hasIssues: issues.length > 0,
    }),
    [issues],
  );

  return (
    <LayoutValidationContext.Provider value={value}>
      {children}
    </LayoutValidationContext.Provider>
  );
}

export function useLayoutValidation() {
  const ctx = useContext(LayoutValidationContext);
  if (!ctx) {
    return { issues: [] as LayoutIssue[], issueMap: new Map<string, LayoutIssue>(), hasIssues: false };
  }
  return ctx;
}
