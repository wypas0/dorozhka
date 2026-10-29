// Один интерфейс данных для приложения: настоящий сервер или демо в памяти браузера (/beta/?demo).
// Демо работает на тех же правилах учёта (src/shared/rules.ts), что и сервер.
import {
  CLIENT_CONSENT_VERSION, COACH_CONSENT_VERSION, DEFAULT_DUR, DEFAULT_SETTINGS, FREE_LIMIT, Invalid, parseClient, parseConsent,
  parseProgram, parseSettings, type Client, type ClientInput, type Coach, type LessonType, type NewConsent, type Program, type Settings,
} from '../shared/types';
import {
  RuleError, addDays, applyPlan, createLessons, planned, setMark, suggestSets, summary, syncGroup, weekday,
  type JGroup, type JLesson, type Journal, type LessonInput, type Mark, type Now, type Pause, type Vacation,
} from '../shared/rules';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message || code); }
}

export interface PlanBody {
  programId?: string | null; type?: LessonType; total: number; perWeek?: number; startsOn: string;
  slots: Record<string, string>; place?: string; lane?: string | null; replace?: boolean; clientId?: string;
}
export type LessonBody = Partial<Omit<LessonInput, 'date' | 'start' | 'type'>> & Pick<LessonInput, 'date' | 'start' | 'type'>;
export type LessonPatch = Partial<Pick<JLesson, 'date' | 'start' | 'dur' | 'place' | 'lane' | 'log' | 'nextNote' | 'cancelled'>>;
export interface MarkResult { lesson: JLesson; makeup: JLesson | null; removed: string[] }

export interface Api {
  demo: boolean;
  me(): Promise<Coach>;
  consent(): Promise<Coach>;
  saveSettings(s: Partial<Settings> & { name?: string }): Promise<Coach>;
  programs(): Promise<Program[]>;
  addProgram(p: Omit<Program, 'id' | 'archived'>): Promise<Program>;
  saveProgram(p: Program): Promise<Program>;
  clients(): Promise<Client[]>;
  addClient(c: ClientInput, consents: NewConsent[]): Promise<Client>;
  saveClient(id: string, c: ClientInput): Promise<Client>;
  archive(id: string): Promise<Client>;
  restore(id: string): Promise<Client>;
  deleteClient(id: string): Promise<void>;
  addConsent(id: string, k: NewConsent): Promise<Client>;
  revokeConsent(id: string, consentId: string): Promise<Client>;
  exportUrl(): string;
  deleteAccount(confirm: string): Promise<void>;
  logout(): Promise<void>;
  // этап 1
  lessons(from: string, to: string): Promise<{ now: Now; lessons: JLesson[] }>;
  addLessons(b: LessonBody): Promise<JLesson[]>;
  saveLesson(id: string, p: LessonPatch): Promise<JLesson>;
  deleteLesson(id: string): Promise<void>;
  mark(lessonId: string, clientId: string, mark: Mark | null, reason?: string | null): Promise<MarkResult>;
  plan(clientId: string, b: PlanBody): Promise<{ created: number; removed: number }>;
  suggest(b: PlanBody): Promise<Record<string, string>[]>;
  addPause(clientId: string, from: string, to: string): Promise<Pause>;
  deletePause(clientId: string, id: string): Promise<void>;
  vacations(): Promise<Vacation[]>;
  addVacation(from: string, to: string): Promise<Vacation>;
  deleteVacation(id: string): Promise<void>;
  groups(): Promise<JGroup[]>;
  saveGroup(g: { id?: string; name: string; type: LessonType; memberIds: string[]; archived?: boolean }): Promise<JGroup>;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(path, {
    method, credentials: 'same-origin',
    headers: body === undefined ? {} : { 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data: any = await r.json().catch(() => ({}));
  if (!r.ok) throw new ApiError(r.status, data.error || 'server', data.message);
  return data as T;
}

export const httpApi: Api = {
  demo: false,
  me: () => call('GET', '/api/me'),
  consent: () => call('POST', '/api/consent', { version: COACH_CONSENT_VERSION, agree: true }),
  saveSettings: (s) => call('PUT', '/api/settings', s),
  programs: () => call('GET', '/api/programs'),
  addProgram: (p) => call('POST', '/api/programs', p),
  saveProgram: (p) => call('PUT', `/api/programs/${p.id}`, p),
  clients: () => call('GET', '/api/clients'),
  addClient: (client, consents) => call('POST', '/api/clients', { client, consents }),
  saveClient: (id, c) => call('PUT', `/api/clients/${id}`, c),
  archive: (id) => call('POST', `/api/clients/${id}/archive`),
  restore: (id) => call('POST', `/api/clients/${id}/restore`),
  deleteClient: async (id) => { await call('DELETE', `/api/clients/${id}`); },
  addConsent: (id, k) => call('POST', `/api/clients/${id}/consents`, k),
  revokeConsent: (id, cid) => call('POST', `/api/clients/${id}/consents/${cid}/revoke`),
  exportUrl: () => '/api/export',
  deleteAccount: async (confirm) => { await call('DELETE', '/api/account', { confirm }); },
  logout: async () => { await call('POST', '/auth/logout'); },
  lessons: (from, to) => call('GET', `/api/lessons?from=${from}&to=${to}`),
  addLessons: (b) => call('POST', '/api/lessons', b),
  saveLesson: (id, p) => call('PUT', `/api/lessons/${id}`, p),
  deleteLesson: async (id) => { await call('DELETE', `/api/lessons/${id}`); },
  mark: (lid, cid, mark, reason = null) => call('PUT', `/api/lessons/${lid}/marks/${cid}`, { mark, reason }),
  plan: (cid, b) => call('POST', `/api/clients/${cid}/plan`, b),
  suggest: (b) => call('POST', '/api/plan/suggest', b),
  addPause: (cid, from, to) => call('POST', `/api/clients/${cid}/pauses`, { from, to }),
  deletePause: async (cid, id) => { await call('DELETE', `/api/clients/${cid}/pauses/${id}`); },
  vacations: () => call('GET', '/api/vacations'),
  addVacation: (from, to) => call('POST', '/api/vacations', { from, to }),
  deleteVacation: async (id) => { await call('DELETE', `/api/vacations/${id}`); },
  groups: () => call('GET', '/api/groups'),
  saveGroup: (g) => (g.id ? call('PUT', `/api/groups/${g.id}`, g) : call('POST', '/api/groups', g)),
};

/* ---------- демо: те же правила, данные в памяти ---------- */

const uid = () => Math.random().toString(36).slice(2, 10);
const stamp = () => new Date().toISOString();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));
const localNow = (): Now => {
  const d = new Date(), p = (n: number) => String(n).padStart(2, '0');
  return { date: `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`, min: d.getHours() * 60 + d.getMinutes() };
};

type DemoClient = Omit<Client, 'pauses' | 'summary'>;

export function demoApi(): Api {
  const coach: Coach = {
    id: 'demo', email: 'demo@dorozhka.app', name: 'Айгерим', tz: 'Asia/Almaty',
    settings: { ...DEFAULT_SETTINGS, onboarded: true, pool: { name: 'Алатау, малая чаша', lanes: 4 }, week: DEFAULT_SETTINGS.week.map((h, i) => (i < 6 ? { from: '09:00', to: '21:00' } : h)) },
    consent: { version: COACH_CONSENT_VERSION, givenAt: stamp() }, tier: 'free', paidUntil: null, activeClients: 0, limit: FREE_LIMIT,
  };
  const consent = (signerName: string, kind: 'training' | 'health' = 'training', signedBy: 'self' | 'parent' = 'self') => ({
    id: uid(), kind, method: 'form' as const, signedBy, signerName, textVersion: CLIENT_CONSENT_VERSION, givenAt: stamp(), revokedAt: null,
  });
  const client = (name: string, extra: Partial<DemoClient> = {}): DemoClient => ({
    id: uid(), name, phone: null, isChild: false, parentName: null, note: null, createdAt: stamp(), archivedAt: null, consents: [consent(name)], ...extra,
  });
  const packs = (one: number, p8: number, p10: number) => [{ sessions: 1, price: one }, { sessions: 8, price: p8 }, { sessions: 10, price: p10 }];
  let programs: Program[] = [
    { id: uid(), type: 'individual', name: 'Индивидуальное', dur: 45, packs: packs(7000, 48000, 58000), archived: false },
    { id: uid(), type: 'baby', name: 'Грудничковое, с мамой', dur: 30, packs: packs(6000, 40000, 48000), archived: false },
    { id: uid(), type: 'split', name: 'Сплит, пара', dur: 45, packs: packs(5000, 36000, 43000), archived: false },
    { id: uid(), type: 'group', name: 'Группа, дети', dur: 45, packs: packs(3500, 26000, 30000), archived: false },
  ];
  let clients: DemoClient[] = [
    client('Олжас Бекенов', { phone: '+7 701 123 45 67' }),
    client('Аружан Ермек'),
    client('София Ахметова', { isChild: true, parentName: 'Динара Ахметова', consents: [consent('Динара Ахметова', 'training', 'parent')] }),
    client('Марат Жумабаев'),
    client('Ален Жумабаев'),
    client('Миша Ковалёв', { isChild: true, parentName: 'Ольга Ковалёва', consents: [consent('Ольга Ковалёва', 'training', 'parent')] }),
    client('Даня Ли', { isChild: true, parentName: 'Сергей Ли', consents: [consent('Сергей Ли', 'training', 'parent')] }),
    client('Тимур Байжанов', { note: 'Плечо — без баттерфляя до ноября' }),
    client('Руслан Ким', { archivedAt: stamp() }),
  ];
  const J: Journal = {
    clients: clients.map((c) => ({ id: c.id, name: c.name, archived: !!c.archivedAt, pauses: [], plan: null })),
    groups: [], lessons: [], payments: [], vacations: [],
    settings: { chargeNoShow: true, breakMin: 15, stepMin: 15, week: coach.settings.week },
  };
  // Расписание демо: планы с прошлой недели, часть занятий уже отмечена.
  const now = localNow(), monday = addDays(now.date, -weekday(now.date)), lastWeek = addDays(monday, -7);
  const [olzhas, aruzhan, sofia, marat, alen, misha, danya, timur] = clients;
  const plan = (c: DemoClient, type: LessonType, slots: Record<string, string>, total = 8, lane = '1') =>
    applyPlan(J, c.id, { total, perWeek: Object.keys(slots).length, startsOn: lastWeek, slots, dur: DEFAULT_DUR[type], type, place: '', lane, programId: null, replace: false }, now);
  plan(olzhas, 'individual', { 1: '19:00', 3: '19:00' });
  plan(aruzhan, 'individual', { 0: '18:00', 3: '18:00' });
  plan(sofia, 'baby', { 0: '09:30', 3: '09:30' }, 8, '1');
  plan(timur, 'individual', { 1: '10:00', 5: '10:00' });
  createLessons(J, { date: lastWeek, start: '17:00', dur: 45, type: 'split', kind: 'regular', clientIds: [marat.id, alen.id], groupId: null, place: '', lane: '4', repeat: { n: 8, days: [weekday(lastWeek), 3] } });
  J.groups.push({ id: uid(), type: 'group', name: 'Дельфины', memberIds: [misha.id, danya.id], archived: false });
  createLessons(J, { date: addDays(lastWeek, 2), start: '18:00', dur: 45, type: 'group', kind: 'regular', clientIds: [], groupId: J.groups[0].id, place: '', lane: '2', repeat: { n: 6, days: [2, 4] } });
  createLessons(J, { date: addDays(now.date, 1), start: '16:00', dur: 45, type: 'individual', kind: 'trial', clientIds: [olzhas.id], groupId: null, place: '', lane: '1', repeat: null });
  for (const l of J.lessons) {
    const past = `${l.date}T${l.start}` < `${now.date}T${String(Math.floor(now.min / 60)).padStart(2, '0')}:00`;
    if (!past || l.date === now.date) continue;
    for (const id of l.clientIds) l.att[id] = id === danya.id && l.date < monday ? 'absent' : id === aruzhan.id && l.date < monday ? 'excused' : 'present';
  }
  J.payments.push(
    { id: uid(), clientId: olzhas.id, withId: null, date: lastWeek, sessions: 8, amount: 48000, until: null },
    { id: uid(), clientId: sofia.id, withId: null, date: lastWeek, sessions: 8, amount: 40000, until: null },
    { id: uid(), clientId: marat.id, withId: alen.id, date: lastWeek, sessions: 8, amount: 36000, until: null },
    { id: uid(), clientId: misha.id, withId: null, date: lastWeek, sessions: 10, amount: 30000, until: null },
  );

  const active = () => clients.filter((c) => !c.archivedAt).length;
  const guard = async <T>(f: () => T): Promise<T> => {
    try { return clone(f()); } catch (e) {
      if (e instanceof Invalid || e instanceof RuleError) throw new ApiError(400, 'invalid', e.message);
      throw e;
    }
  };
  const find = (id: string) => clients.find((c) => c.id === id) || (() => { throw new ApiError(404, 'not_found'); })();
  const jc = (id: string) => J.clients.find((c) => c.id === id)!;
  const full = (c: DemoClient): Client => ({ ...c, pauses: jc(c.id)?.pauses ?? [], summary: summary(J, c.id, localNow()) });
  const limit = () => { if (active() >= FREE_LIMIT) throw new ApiError(409, 'free_limit', `На бесплатном тарифе до ${FREE_LIMIT} клиентов`); };
  const me = () => ({ ...coach, activeClients: active() });
  const lesson = (id: string) => J.lessons.find((l) => l.id === id) || (() => { throw new ApiError(404, 'not_found'); })();
  const ask = (b: PlanBody) => {
    const p = b.programId ? programs.find((x) => x.id === b.programId) : null;
    const type = p?.type || b.type || 'individual';
    return { ...b, type, dur: p?.dur || DEFAULT_DUR[type], perWeek: b.perWeek || Object.keys(b.slots).length || 1, place: b.place || '', lane: b.lane ?? null, programId: p?.id ?? null, replace: b.replace !== false };
  };
  return {
    demo: true,
    me: () => guard(me),
    consent: () => guard(me),
    saveSettings: (s) => guard(() => {
      coach.settings = parseSettings(s, coach.settings);
      J.settings = { ...J.settings, chargeNoShow: coach.settings.chargeNoShow, breakMin: coach.settings.breakMin, week: coach.settings.week };
      if (s.name !== undefined) coach.name = String(s.name).trim().slice(0, 80);
      return me();
    }),
    programs: () => guard(() => programs),
    addProgram: (p) => guard(() => { const x = { id: uid(), ...parseProgram(p), archived: false }; programs.push(x); return x; }),
    saveProgram: (p) => guard(() => {
      const x = { id: p.id, ...parseProgram(p), archived: !!p.archived };
      programs = programs.map((y) => (y.id === p.id ? x : y));
      return x;
    }),
    clients: () => guard(() => clients.map(full)),
    addClient: (c, ks) => guard(() => {
      const cl = parseClient(c), list = ks.map(parseConsent);
      if (!list.some((k) => k.kind === 'training')) throw new Invalid('Нужно согласие клиента на данные для занятий');
      limit();
      const x: DemoClient = { id: uid(), ...cl, createdAt: stamp(), archivedAt: null,
        consents: list.map((k) => ({ ...consent(k.signerName, k.kind, cl.isChild ? 'parent' : 'self'), method: k.method })) };
      clients.push(x);
      J.clients.push({ id: x.id, name: x.name, archived: false, pauses: [], plan: null });
      return full(x);
    }),
    saveClient: (id, c) => guard(() => full(Object.assign(find(id), parseClient(c)))),
    archive: (id) => guard(() => full(Object.assign(find(id), { archivedAt: stamp() }))),
    restore: (id) => guard(() => { limit(); return full(Object.assign(find(id), { archivedAt: null })); }),
    deleteClient: async (id) => {
      if (!find(id).archivedAt) throw new ApiError(409, 'not_archived', 'Сначала уберите клиента в архив');
      clients = clients.filter((c) => c.id !== id);
      J.clients = J.clients.filter((c) => c.id !== id);
      for (const l of J.lessons) { l.clientIds = l.clientIds.filter((x) => x !== id); delete l.att[id]; }
    },
    addConsent: (id, k) => guard(() => {
      const c = find(id), x = parseConsent(k);
      if (x.kind === 'health' && !c.consents.some((y) => y.kind === 'training' && !y.revokedAt)) throw new ApiError(400, 'consent_training_required');
      c.consents.push({ ...consent(x.signerName, x.kind, c.isChild ? 'parent' : 'self'), method: x.method });
      return full(c);
    }),
    revokeConsent: (id, cid) => guard(() => {
      const c = find(id), k = c.consents.find((y) => y.id === cid && !y.revokedAt);
      if (!k) throw new ApiError(404, 'not_found');
      for (const y of c.consents) if (y === k || (k.kind === 'training' && y.kind === 'health' && !y.revokedAt)) y.revokedAt = stamp();
      return full(c);
    }),
    exportUrl: () => URL.createObjectURL(new Blob([JSON.stringify({ coach: me(), programs, clients, journal: J }, null, 2)], { type: 'application/json' })),
    deleteAccount: async () => { location.href = '/beta/'; },
    logout: async () => { location.href = '/beta/'; },

    lessons: (from, to) => guard(() => ({ now: localNow(), lessons: J.lessons.filter((l) => l.date >= from && l.date <= to) })),
    addLessons: (b) => guard(() => createLessons(J, { kind: 'regular', clientIds: [], groupId: null, place: '', lane: null, repeat: null, dur: DEFAULT_DUR[b.type], ...b }).upsert),
    saveLesson: (id, p) => guard(() => Object.assign(lesson(id), p)),
    deleteLesson: async (id) => {
      lesson(id);
      J.lessons = J.lessons.filter((l) => l.id !== id);
      for (const l of J.lessons) if (l.extOf === id) l.extOf = null;
    },
    mark: (lid, cid, m, reason = null) => guard(() => { lesson(lid); const r = setMark(J, lid, cid, m, reason); return { lesson: r.lesson, makeup: r.makeup, removed: r.changes.remove }; }),
    plan: (cid, b) => guard(() => { find(cid); const r = applyPlan(J, cid, ask(b), localNow()); return { created: r.created, removed: r.changes.remove.length }; }),
    suggest: (b) => guard(() => {
      const p = ask(b), n = localNow();
      const ignore = new Set(b.clientId && p.replace ? planned(J, b.clientId, n).filter((l) => l.clientIds.length === 1).map((l) => l.id) : []);
      return suggestSets(J, p, ignore, n);
    }),
    addPause: (cid, from, to) => guard(() => {
      if (to < from) throw new Invalid('Конец раньше начала');
      const p = { id: uid(), from, to }; jc(find(cid).id).pauses.push(p); return p;
    }),
    deletePause: async (cid, id) => { const c = jc(find(cid).id); c.pauses = c.pauses.filter((p) => p.id !== id); },
    vacations: () => guard(() => J.vacations),
    addVacation: (from, to) => guard(() => {
      if (to < from) throw new Invalid('Конец раньше начала');
      const v = { id: uid(), from, to }; J.vacations.push(v); return v;
    }),
    deleteVacation: async (id) => { J.vacations = J.vacations.filter((v) => v.id !== id); },
    groups: () => guard(() => J.groups),
    saveGroup: (g) => guard(() => {
      if (!g.memberIds.length) throw new Invalid('В группе должен быть хотя бы один человек');
      let x = J.groups.find((y) => y.id === g.id);
      if (!x) { x = { id: uid(), type: g.type, name: g.name, memberIds: [], archived: false }; J.groups.push(x); }
      Object.assign(x, { name: g.name, type: g.type, memberIds: [...g.memberIds], archived: !!g.archived });
      syncGroup(J, x, localNow());
      return x;
    }),
  };
}

export const ERR: Record<string, string> = {
  free_limit: `На бесплатном тарифе до ${FREE_LIMIT} активных клиентов. Уберите кого-то в архив или перейдите на подписку.`,
  consent_training_required: 'Сначала нужно согласие на данные для занятий.',
  consent_parent_required: 'За ребёнка согласие даёт родитель.',
  not_found: 'Не найдено. Обновите страницу.',
  unauthorized: 'Сессия закончилась, войдите снова.',
  server: 'Что-то пошло не так. Попробуйте ещё раз.',
};
export const errText = (e: unknown) => (e instanceof ApiError ? (e.code === 'invalid' ? e.message : ERR[e.code] || e.message) : 'Нет связи с сервером.');
