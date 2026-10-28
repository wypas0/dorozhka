// Общие типы и проверки для Worker'а и приложения: одна копия правил формы данных.

export type LessonType = 'individual' | 'baby' | 'split' | 'minigroup' | 'group';
export const LESSON_TYPES: LessonType[] = ['individual', 'baby', 'split', 'minigroup', 'group'];
export const TYPE_LABEL: Record<LessonType, string> = {
  individual: 'Индивидуальное', baby: 'Грудничковое', split: 'Сплит', minigroup: 'Мини-группа', group: 'Групповое',
};

/** Версии текстов согласий. Новая версия — тренер подтверждает заново. */
export const COACH_CONSENT_VERSION = '2026-10-28';
export const CLIENT_CONSENT_VERSION = '2026-10-28';
export const FREE_LIMIT = 10;

/** Длительность по умолчанию: грудничковое 30 мин, остальные 45 (правило учёта). */
export const DEFAULT_DUR: Record<LessonType, number> = { individual: 45, baby: 30, split: 45, minigroup: 45, group: 45 };
export const WEEKDAYS = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
export type Hours = { from: string; to: string } | null; // null — выходной
export type RemindLead = '15m' | '30m' | '1h' | '2h';

export interface Settings {
  pool: { name: string; lanes: number };  // бассейн и число дорожек (для вида «Дорожки»)
  week: Hours[];                          // рабочие часы по дням, 0 = понедельник
  breakMin: number;                       // перерыв между занятиями
  stepMin: number;                        // шаг подбора свободного времени
  chargeNoShow: boolean;                  // списывать неявку без предупреждения
  remindLead: RemindLead;                 // за сколько напоминать о занятии
  onboarded: boolean;                     // прошёл «Первый вход»
}
const WORKDAY = { from: '09:00', to: '20:00' };
export const DEFAULT_SETTINGS: Settings = {
  pool: { name: '', lanes: 4 },
  week: [WORKDAY, WORKDAY, WORKDAY, WORKDAY, WORKDAY, { from: '09:00', to: '13:00' }, null],
  breakMin: 15,
  stepMin: 15,
  chargeNoShow: true,
  remindLead: '30m',
  onboarded: false,
};

export interface Coach {
  id: string;
  email: string;
  name: string;
  tz: string;
  settings: Settings;
  consent: { version: string; givenAt: string } | null;
  tier: 'free' | 'beta' | 'month' | 'year';
  paidUntil: string | null;
  activeClients: number;
  limit: number | null; // null — без ограничения
}

export interface Pack { sessions: number; price: number | null }
export interface Program {
  id: string;
  type: LessonType;
  name: string;
  dur: number;
  packs: Pack[];   // разовое, 8, 10 занятий…; цена null — ещё не вписана
  archived: boolean;
}
export const DEFAULT_PACKS = (): Pack[] => [{ sessions: 1, price: null }, { sessions: 8, price: null }, { sessions: 10, price: null }];

export type ConsentKind = 'training' | 'health';
export type ConsentMethod = 'form' | 'written' | 'link';
export interface ClientConsent {
  id: string;
  kind: ConsentKind;
  method: ConsentMethod;
  signedBy: 'self' | 'parent';
  signerName: string;
  textVersion: string;
  givenAt: string;
  revokedAt: string | null;
}

export interface Client {
  id: string;
  name: string;
  phone: string | null;
  isChild: boolean;
  parentName: string | null;
  note: string | null;
  createdAt: string;
  archivedAt: string | null;
  consents: ClientConsent[];
}

export interface NewConsent {
  kind: ConsentKind;
  method: ConsentMethod;
  signerName: string;
}
export interface ClientInput {
  name: string;
  phone?: string | null;
  isChild?: boolean;
  parentName?: string | null;
  note?: string | null;
}

/* ---------- проверки входных данных ---------- */

export class Invalid extends Error {}
const fail = (msg: string): never => { throw new Invalid(msg); };

export const str = (v: unknown, field: string, max: number, opts: { min?: number; nullable?: boolean } = {}): string | null => {
  if ((v === undefined || v === null || v === '') && opts.nullable) return null;
  if (typeof v !== 'string') return fail(`${field}: нужен текст`);
  const s = v.trim();
  if (s.length < (opts.min ?? 1)) return fail(`${field}: пусто`);
  if (s.length > max) return fail(`${field}: слишком длинно`);
  return s;
};
export const int = (v: unknown, field: string, min: number, max: number): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) return fail(`${field}: число от ${min} до ${max}`);
  return v;
};
export const oneOf = <T extends string>(v: unknown, field: string, list: readonly T[]): T => {
  if (typeof v !== 'string' || !list.includes(v as T)) return fail(`${field}: недопустимое значение`);
  return v as T;
};
const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;
export const time = (v: unknown, field: string): string => {
  if (typeof v !== 'string' || !TIME.test(v)) return fail(`${field}: время ЧЧ:ММ`);
  return v;
};

export function parseClient(b: any): Required<ClientInput> {
  const isChild = b?.isChild === true;
  return {
    name: str(b?.name, 'Имя', 80)!,
    phone: str(b?.phone, 'Телефон', 32, { nullable: true }),
    isChild,
    parentName: isChild ? str(b?.parentName, 'Имя родителя', 80) : null,
    note: str(b?.note, 'Заметка', 2000, { nullable: true }),
  };
}
export function parseConsent(b: any): NewConsent {
  return {
    kind: oneOf(b?.kind, 'Согласие', ['training', 'health'] as const),
    method: oneOf(b?.method, 'Способ', ['form', 'written'] as const),
    signerName: str(b?.signerName, 'Кто подписал', 80)!,
  };
}
export function parseProgram(b: any): Omit<Program, 'id' | 'archived'> {
  const packs = Array.isArray(b?.packs) ? b.packs : fail('Цены: нужен список');
  if (packs.length > 6) fail('Цены: не больше 6 пакетов');
  const parsed: Pack[] = packs.map((p: any) => ({
    sessions: int(p?.sessions, 'Занятий в пакете', 1, 100),
    price: p?.price === null || p?.price === undefined || p?.price === '' ? null : int(p.price, 'Цена', 0, 10_000_000),
  }));
  if (new Set(parsed.map((p) => p.sessions)).size !== parsed.length) fail('Цены: пакеты повторяются');
  return {
    type: oneOf(b?.type, 'Вид занятия', LESSON_TYPES),
    name: str(b?.name, 'Название', 80)!,
    dur: int(b?.dur, 'Длительность', 5, 240),
    packs: parsed.sort((x, y) => x.sessions - y.sessions),
  };
}
const parseHours = (h: any, day: number): Hours => {
  if (h === null) return null;
  const from = time(h?.from, `${WEEKDAYS[day]}: начало`), to = time(h?.to, `${WEEKDAYS[day]}: конец`);
  if (to <= from) fail(`${WEEKDAYS[day]}: конец раньше начала`);
  return { from, to };
};
export function parseSettings(b: any, cur: Settings): Settings {
  const week = b?.week === undefined ? cur.week
    : Array.isArray(b.week) && b.week.length === 7 ? b.week.map(parseHours) : fail('Рабочие часы: нужно 7 дней');
  const pool = b?.pool === undefined ? cur.pool : {
    name: str(b.pool?.name ?? '', 'Бассейн', 80, { min: 0 }) ?? '',
    lanes: int(b.pool?.lanes, 'Дорожек', 1, 12),
  };
  return {
    pool,
    week,
    breakMin: b?.breakMin === undefined ? cur.breakMin : int(b.breakMin, 'Перерыв', 0, 120),
    stepMin: b?.stepMin === undefined ? cur.stepMin : int(b.stepMin, 'Шаг', 5, 60),
    chargeNoShow: b?.chargeNoShow === undefined ? cur.chargeNoShow : b.chargeNoShow === true,
    remindLead: b?.remindLead === undefined ? cur.remindLead : oneOf(b.remindLead, 'Напоминание', ['15m', '30m', '1h', '2h'] as const),
    onboarded: b?.onboarded === undefined ? cur.onboarded : b.onboarded === true,
  };
}
export const mergeSettings = (raw: unknown): Settings => {
  const s = (raw && typeof raw === 'object' ? raw : {}) as Partial<Settings>;
  return { ...DEFAULT_SETTINGS, ...s, pool: { ...DEFAULT_SETTINGS.pool, ...s.pool } };
};
