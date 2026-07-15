export const SHIFT_LIST_CREATE_HASH = '#shift-list/create';

export type ShiftListScreen = 'list' | 'create';

export type ShiftListLocation = {
  screen: ShiftListScreen;
  editShiftId?: string;
};

export function shiftListEditHash(shiftId: string): string {
  return `#shift-list/edit/${encodeURIComponent(shiftId)}`;
}

export function isShiftListCreateHash(hash = window.location.hash): boolean {
  return hash === SHIFT_LIST_CREATE_HASH;
}

export function parseShiftListEditId(hash = window.location.hash): string | undefined {
  const match = hash.match(/^#shift-list\/edit\/(.+)$/);
  if (!match) return undefined;
  return decodeURIComponent(match[1]);
}

export function readShiftListLocation(): ShiftListLocation {
  const editShiftId = parseShiftListEditId();
  if (editShiftId) return { screen: 'create', editShiftId };
  if (isShiftListCreateHash()) return { screen: 'create' };
  return { screen: 'list' };
}

export function navigateToShiftListCreate(): void {
  window.history.pushState({ shiftListScreen: 'create' }, '', SHIFT_LIST_CREATE_HASH);
}

export function navigateToShiftListEdit(shiftId: string): void {
  window.history.pushState(
    { shiftListScreen: 'create', editShiftId: shiftId },
    '',
    shiftListEditHash(shiftId),
  );
}

export function isShiftListEditorHash(hash = window.location.hash): boolean {
  return isShiftListCreateHash(hash) || Boolean(parseShiftListEditId(hash));
}

export function leaveShiftListEditor(): void {
  if (isShiftListEditorHash()) {
    window.history.back();
    return;
  }
  clearShiftListEditorHash();
}

export function clearShiftListEditorHash(): void {
  const base = `${window.location.pathname}${window.location.search}`;
  window.history.replaceState(window.history.state, '', base);
}
