import { signal } from '@preact/signals';
import type { Client, Coach, Program } from '../shared/types';
import { demoApi, errText, httpApi, type Api } from './api';

export const isDemo = new URLSearchParams(location.search).has('demo');
export const api: Api = isDemo ? demoApi() : httpApi;

export const coach = signal<Coach | null>(null);
export const programs = signal<Program[]>([]);
export const clients = signal<Client[]>([]);
export const toast = signal<string | null>(null);
export const route = signal(location.hash.replace(/^#\/?/, '') || 'today');

addEventListener('hashchange', () => { route.value = location.hash.replace(/^#\/?/, '') || 'today'; });
export const go = (r: string) => { location.hash = `/${r}`; };

let toastTimer = 0;
export function say(msg: string) {
  toast.value = msg;
  clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = null; }, 3200);
}

/** Выполняет действие; ошибку показывает тостом и возвращает null. */
export async function run<T>(f: () => Promise<T>, ok?: string): Promise<T | null> {
  try {
    const r = await f();
    if (ok) say(ok);
    return r;
  } catch (e) {
    say(errText(e));
    return null;
  }
}

export async function loadAll() {
  const [p, c] = await Promise.all([api.programs(), api.clients()]);
  programs.value = p;
  clients.value = c;
}
export const upsertClient = (c: Client) => {
  const list = clients.value.filter((x) => x.id !== c.id);
  clients.value = [...list, c].sort((a, b) => (!!a.archivedAt === !!b.archivedAt ? a.name.localeCompare(b.name, 'ru') : a.archivedAt ? 1 : -1));
};
export const refreshCoach = async () => { coach.value = await api.me(); };
