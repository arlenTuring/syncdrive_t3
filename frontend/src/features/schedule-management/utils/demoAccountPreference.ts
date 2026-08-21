import { useSyncExternalStore } from 'react';

export type DemoAccountId = 'supervisor' | 'employee';

export type DemoAccount = {
  id: DemoAccountId;
  name: string;
  title: string;
};

export const DEMO_ACCOUNTS: DemoAccount[] = [
  { id: 'supervisor', name: 'Luna', title: '主管' },
  { id: 'employee', name: 'Arlen', title: '一般員工' },
];

const STORAGE_KEY = 'syncdrive_vtms_demo_account';

function parseAccountId(raw: string | null): DemoAccountId {
  return raw === 'employee' ? 'employee' : 'supervisor';
}

function readAccountId(): DemoAccountId {
  try {
    return parseAccountId(window.localStorage.getItem(STORAGE_KEY));
  } catch {
    return 'supervisor';
  }
}

let currentId: DemoAccountId = typeof window === 'undefined' ? 'supervisor' : readAccountId();
const listeners = new Set<() => void>();

function emit() {
  listeners.forEach((fn) => fn());
}

export function getDemoAccount(): DemoAccount {
  return DEMO_ACCOUNTS.find((item) => item.id === currentId) ?? DEMO_ACCOUNTS[0];
}

export function setDemoAccountId(id: DemoAccountId) {
  currentId = id;
  try {
    window.localStorage.setItem(STORAGE_KEY, id);
  } catch {
    // ignore
  }
  emit();
}

export function subscribeDemoAccount(onStoreChange: () => void): () => void {
  listeners.add(onStoreChange);
  return () => listeners.delete(onStoreChange);
}

export function useDemoAccount(): [DemoAccount, (id: DemoAccountId) => void] {
  const account = useSyncExternalStore(subscribeDemoAccount, getDemoAccount, getDemoAccount);
  return [account, setDemoAccountId];
}
