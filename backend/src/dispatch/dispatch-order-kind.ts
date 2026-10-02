import type { PlannedDispatch } from './dispatch.plan';

export type BusinessLineKind = 'MAINLINE' | 'TRANSITION' | 'MAINTENANCE';

export function businessLineKind(item: Pick<PlannedDispatch, 'kind' | 'taskType'>): BusinessLineKind {
  if (item.kind === 'passenger') return 'MAINLINE';
  if (item.kind === 'movement' || ['dispatch', 'standby', 'idle'].includes(item.taskType)) {
    return 'TRANSITION';
  }
  return 'MAINTENANCE';
}
