import { DASHBOARD_PLANES_STORAGE_KEY } from '../../../lib/canvasCacheReset';
import type { DashboardPlane } from '../../dashboard/types';

export type ModuleDashboardPage = {
  id: string;
  /** SIDEBAR_MODULE_GROUPS[].id */
  moduleId: string;
  label: string;
  planeId: string;
  createdAt: number;
};

const PAGES_STORAGE_KEY = 'syncdrive_vtms_module_dashboard_pages';

export function listStoredDashboardPlanes(): DashboardPlane[] {
  try {
    const raw = window.localStorage.getItem(DASHBOARD_PLANES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is DashboardPlane =>
        !!item
        && typeof item === 'object'
        && typeof (item as DashboardPlane).id === 'string'
        && typeof (item as DashboardPlane).name === 'string',
    );
  } catch {
    return [];
  }
}

export function findStoredDashboardPlane(planeId: string): DashboardPlane | null {
  return listStoredDashboardPlanes().find((plane) => plane.id === planeId) ?? null;
}

export function readModuleDashboardPages(): ModuleDashboardPage[] {
  try {
    const raw = window.localStorage.getItem(PAGES_STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (item): item is ModuleDashboardPage =>
        !!item
        && typeof item === 'object'
        && typeof (item as ModuleDashboardPage).id === 'string'
        && typeof (item as ModuleDashboardPage).moduleId === 'string'
        && typeof (item as ModuleDashboardPage).planeId === 'string'
        && typeof (item as ModuleDashboardPage).label === 'string',
    );
  } catch {
    return [];
  }
}

export function writeModuleDashboardPages(pages: ModuleDashboardPage[]) {
  try {
    window.localStorage.setItem(PAGES_STORAGE_KEY, JSON.stringify(pages));
  } catch {
    // ignore
  }
}

export function createModuleDashboardPageId(): string {
  return `mdp-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;
}

export function moduleDashboardViewId(pageId: string): string {
  return `mdp:${pageId}`;
}

export function parseModuleDashboardViewId(view: string): string | null {
  if (!view.startsWith('mdp:')) return null;
  const id = view.slice(4).trim();
  return id || null;
}
