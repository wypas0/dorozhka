// Один интерфейс данных для приложения: настоящий сервер или демо в памяти браузера (/beta/?demo).
import {
  CLIENT_CONSENT_VERSION, COACH_CONSENT_VERSION, DEFAULT_SETTINGS, FREE_LIMIT, Invalid, parseClient, parseConsent,
  parseProgram, parseSettings, type Client, type ClientInput, type Coach, type NewConsent, type Program, type Settings,
} from '../shared/types';

export class ApiError extends Error {
  constructor(public status: number, public code: string, message?: string) { super(message || code); }
}

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
};

/* ---------- демо: те же правила, данные в памяти ---------- */

const uid = () => Math.random().toString(36).slice(2, 10);
const stamp = () => new Date().toISOString();
const clone = <T>(x: T): T => JSON.parse(JSON.stringify(x));

export function demoApi(): Api {
  const coach: Coach = {
    id: 'demo', email: 'demo@dorozhka.app', name: 'Айгерим', tz: 'Asia/Almaty', settings: { ...DEFAULT_SETTINGS },
    consent: { version: COACH_CONSENT_VERSION, givenAt: stamp() }, tier: 'free', paidUntil: null, activeClients: 0, limit: FREE_LIMIT,
  };
  const consent = (signerName: string, kind: 'training' | 'health' = 'training', signedBy: 'self' | 'parent' = 'self') => ({
    id: uid(), kind, method: 'form' as const, signedBy, signerName, textVersion: CLIENT_CONSENT_VERSION, givenAt: stamp(), revokedAt: null,
  });
  const client = (name: string, extra: Partial<Client> = {}): Client => ({
    id: uid(), name, phone: null, isChild: false, parentName: null, note: null, createdAt: stamp(), archivedAt: null,
    consents: [consent(name)], ...extra,
  });
  coach.settings = { ...coach.settings, onboarded: true, pool: { name: 'Алатау, малая чаша', lanes: 4 } };
  const packs = (one: number, p8: number, p10: number) => [{ sessions: 1, price: one }, { sessions: 8, price: p8 }, { sessions: 10, price: p10 }];
  let programs: Program[] = [
    { id: uid(), type: 'individual', name: 'Индивидуальное', dur: 45, packs: packs(7000, 48000, 58000), archived: false },
    { id: uid(), type: 'baby', name: 'Грудничковое, с мамой', dur: 30, packs: packs(6000, 40000, 48000), archived: false },
    { id: uid(), type: 'split', name: 'Сплит, пара', dur: 45, packs: packs(5000, 36000, 43000), archived: false },
    { id: uid(), type: 'group', name: 'Группа, дети', dur: 45, packs: packs(3500, 26000, 30000), archived: false },
  ];
  let clients: Client[] = [
    client('Дана Сейткали', { phone: '+7 701 123 45 67', consents: [consent('Дана Сейткали'), consent('Дана Сейткали', 'health')] }),
    client('Алихан Нуртаев', { isChild: true, parentName: 'Асель Нуртаева', consents: [consent('Асель Нуртаева', 'training', 'parent')] }),
    client('Мира Ахметова', { isChild: true, parentName: 'Ерлан Ахметов', consents: [consent('Ерлан Ахметов', 'training', 'parent')] }),
    client('Тимур Байжанов', { note: 'Плечо — без баттерфляя до ноября' }),
    client('Айша Касымова', { isChild: true, parentName: 'Сауле Касымова', consents: [consent('Сауле Касымова', 'training', 'parent')] }),
    client('Руслан Ким', { archivedAt: stamp() }),
  ];
  const active = () => clients.filter((c) => !c.archivedAt).length;
  const guard = async <T>(f: () => T): Promise<T> => {
    try { return clone(f()); } catch (e) { if (e instanceof Invalid) throw new ApiError(400, 'invalid', e.message); throw e; }
  };
  const find = (id: string) => clients.find((c) => c.id === id) || (() => { throw new ApiError(404, 'not_found'); })();
  const limit = () => { if (active() >= FREE_LIMIT) throw new ApiError(409, 'free_limit', `На бесплатном тарифе до ${FREE_LIMIT} клиентов`); };
  const me = () => ({ ...coach, activeClients: active() });
  return {
    demo: true,
    me: () => guard(me),
    consent: () => guard(me),
    saveSettings: (s) => guard(() => {
      coach.settings = parseSettings(s, coach.settings);
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
    clients: () => guard(() => [...clients].sort((a, b) => (!!a.archivedAt === !!b.archivedAt ? a.name.localeCompare(b.name, 'ru') : a.archivedAt ? 1 : -1))),
    addClient: (c, ks) => guard(() => {
      const cl = parseClient(c), list = ks.map(parseConsent);
      if (!list.some((k) => k.kind === 'training')) throw new Invalid('Нужно согласие клиента на данные для занятий');
      limit();
      const x: Client = { id: uid(), ...cl, createdAt: stamp(), archivedAt: null,
        consents: list.map((k) => ({ ...consent(k.signerName, k.kind, cl.isChild ? 'parent' : 'self'), method: k.method })) };
      clients.push(x);
      return x;
    }),
    saveClient: (id, c) => guard(() => Object.assign(find(id), parseClient(c))),
    archive: (id) => guard(() => Object.assign(find(id), { archivedAt: stamp() })),
    restore: (id) => guard(() => { limit(); return Object.assign(find(id), { archivedAt: null }); }),
    deleteClient: async (id) => {
      if (!find(id).archivedAt) throw new ApiError(409, 'not_archived', 'Сначала уберите клиента в архив');
      clients = clients.filter((c) => c.id !== id);
    },
    addConsent: (id, k) => guard(() => {
      const c = find(id), x = parseConsent(k);
      if (x.kind === 'health' && !c.consents.some((y) => y.kind === 'training' && !y.revokedAt)) throw new ApiError(400, 'consent_training_required');
      c.consents.push({ ...consent(x.signerName, x.kind, c.isChild ? 'parent' : 'self'), method: x.method });
      return c;
    }),
    revokeConsent: (id, cid) => guard(() => {
      const c = find(id), k = c.consents.find((y) => y.id === cid && !y.revokedAt);
      if (!k) throw new ApiError(404, 'not_found');
      for (const y of c.consents) if (y === k || (k.kind === 'training' && y.kind === 'health' && !y.revokedAt)) y.revokedAt = stamp();
      return c;
    }),
    exportUrl: () => URL.createObjectURL(new Blob([JSON.stringify({ coach: me(), programs, clients }, null, 2)], { type: 'application/json' })),
    deleteAccount: async () => { location.href = '/beta/'; },
    logout: async () => { location.href = '/beta/'; },
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
