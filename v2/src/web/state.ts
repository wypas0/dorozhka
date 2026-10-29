import { signal } from '@preact/signals';
import type { Client, Coach, Program } from '../shared/types';
import { addDays, weekday, type JGroup, type JLesson, type Now } from '../shared/rules';
import { demoApi, errText, httpApi, type Api } from './api';

export const isDemo = new URLSearchParams(location.search).has('demo');
export const api: Api = isDemo ? demoApi() : httpApi;

export const coach = signal<Coach | null>(null);
export const programs = signal<Program[]>([]);
export const clients = signal<Client[]>([]);
export const groups = signal<JGroup[]>([]);
export const toast = signal<string | null>(null);
export const route = signal(location.hash.replace(/^#\/?/, '') || 'today');

const localNow = (): Now => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, min: d.getHours() * 60 + d.getMinutes() };
};
/** «Сейчас» по часам тренера (сервер присылает со списком занятий). */
export const now = signal<Now>(localNow());
/** Неделя, которую смотрим: понедельник. */
export const weekOf = signal(addDays(now.value.date, -weekday(now.value.date)));
export const lessons = signal<JLesson[]>([]);

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

export async function loadLessons() {
  const r = await api.lessons(weekOf.value, addDays(weekOf.value, 6));
  now.value = r.now;
  lessons.value = r.lessons;
}
export async function loadAll() {
  const [p, c, g] = await Promise.all([api.programs(), api.clients(), api.groups()]);
  programs.value = p;
  clients.value = c;
  groups.value = g;
  await loadLessons();
}
/** После изменения расписания: занятия недели и сводки клиентов. */
export const refresh = () => Promise.all([loadLessons(), api.clients().then((c) => { clients.value = c; })]);

export const upsertClient = (c: Client) => {
  const list = clients.value.filter((x) => x.id !== c.id);
  clients.value = [...list, c].sort((a, b) => (!!a.archivedAt === !!b.archivedAt ? a.name.localeCompare(b.name, 'ru') : a.archivedAt ? 1 : -1));
};
export const refreshCoach = async () => { coach.value = await api.me(); };
export const clientName = (id: string) => clients.value.find((c) => c.id === id)?.name || '—';
