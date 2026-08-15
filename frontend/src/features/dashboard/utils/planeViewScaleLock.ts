const STORAGE_KEY = 'syncdrive_dashboard_plane_scale_lock';

export type PlaneScaleLockPref = {
  locked: boolean;
  userZoom: number;
};

type Store = Record<string, PlaneScaleLockPref>;

function readStore(): Store {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return {};
    return parsed as Store;
  } catch {
    return {};
  }
}

function writeStore(store: Store) {
  try {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(store));
  } catch {
    // ignore
  }
}

export function readPlaneScaleLock(planeId: string): PlaneScaleLockPref | null {
  const entry = readStore()[planeId];
  if (!entry || typeof entry !== 'object') return null;
  if (typeof entry.userZoom !== 'number' || !Number.isFinite(entry.userZoom)) return null;
  return {
    locked: Boolean(entry.locked),
    userZoom: Math.max(0.2, Math.min(5, entry.userZoom)),
  };
}

export function writePlaneScaleLock(planeId: string, pref: PlaneScaleLockPref) {
  const store = readStore();
  if (!pref.locked) {
    delete store[planeId];
  } else {
    store[planeId] = {
      locked: true,
      userZoom: Math.max(0.2, Math.min(5, pref.userZoom)),
    };
  }
  writeStore(store);
}
