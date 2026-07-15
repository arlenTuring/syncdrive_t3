export const MAINTENANCE_TASK_CREATE_HASH = '#maintenance-tasks/create';

export type MaintenanceTaskScreen = 'list' | 'create';

export type MaintenanceTaskLocation = {
  screen: MaintenanceTaskScreen;
  editTaskId?: string;
};

export function maintenanceTaskEditHash(taskId: string): string {
  return `#maintenance-tasks/edit/${encodeURIComponent(taskId)}`;
}

export function isMaintenanceTaskCreateHash(hash = window.location.hash): boolean {
  return hash === MAINTENANCE_TASK_CREATE_HASH;
}

export function parseMaintenanceTaskEditId(hash = window.location.hash): string | undefined {
  const match = hash.match(/^#maintenance-tasks\/edit\/(.+)$/);
  if (!match) return undefined;
  return decodeURIComponent(match[1]);
}

export function readMaintenanceTaskLocation(): MaintenanceTaskLocation {
  const editTaskId = parseMaintenanceTaskEditId();
  if (editTaskId) return { screen: 'create', editTaskId };
  if (isMaintenanceTaskCreateHash()) return { screen: 'create' };
  return { screen: 'list' };
}

export function navigateToMaintenanceTaskCreate(): void {
  window.history.pushState({ maintenanceTaskScreen: 'create' }, '', MAINTENANCE_TASK_CREATE_HASH);
}

export function navigateToMaintenanceTaskEdit(taskId: string): void {
  window.history.pushState(
    { maintenanceTaskScreen: 'create', editTaskId: taskId },
    '',
    maintenanceTaskEditHash(taskId),
  );
}

export function isMaintenanceTaskEditorHash(hash = window.location.hash): boolean {
  return isMaintenanceTaskCreateHash(hash) || Boolean(parseMaintenanceTaskEditId(hash));
}

export function leaveMaintenanceTaskEditor(): void {
  if (isMaintenanceTaskEditorHash()) {
    window.history.back();
    return;
  }
  clearMaintenanceTaskEditorHash();
}

export function clearMaintenanceTaskEditorHash(): void {
  const base = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, '', base);
}
