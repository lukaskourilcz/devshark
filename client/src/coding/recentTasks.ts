// Navigation history only: progress and access still come from the server.
// This account-data key is cleared by the existing sign-out/account switch.
import { useEffect } from 'react';
import { accountEpoch } from '../lib/accountData';
import { readJSON, writeJSON } from '../lib/storage';
import { createStore, useStore } from '../lib/store';

const KEY = 'devshark:coding:recent:v1';
const validId = (id: unknown): id is string => typeof id === 'string' && /^[a-z0-9-]{3,64}$/.test(id);
const read = (): string[] => {
  const value = readJSON<unknown>(KEY, []);
  return Array.isArray(value) ? value.filter(validId).slice(0, 100) : [];
};
const recent = createStore(read);

export function rememberCodingTask(id: string, epoch: number): void {
  if (epoch !== accountEpoch() || !validId(id)) return;
  const ids = read();
  if (ids[0] === id) return;
  writeJSON(KEY, [id, ...ids.filter(other => other !== id)].slice(0, 100));
  recent.emit();
}

export function useRecentCodingTasks(): string[] {
  const ids = useStore(recent);
  useEffect(() => {
    const changed = (event: StorageEvent) => { if (event.key === KEY || event.key === null) recent.emit(); };
    window.addEventListener('storage', changed);
    return () => window.removeEventListener('storage', changed);
  }, []);
  return ids;
}
