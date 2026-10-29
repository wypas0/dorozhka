// Правила учёта «Дорожки» — перенесены из shared/logic.js и dorozhka.html старого журнала без изменения смысла.
// Чистые функции над «журналом» тренера в памяти: и Worker (после чтения из D1), и демо работают через них.
// Операции меняют журнал и возвращают набор изменений, который вызывающий сохраняет у себя.
// Даты — 'YYYY-MM-DD', время — 'HH:MM' по часовому поясу тренера, день недели 0 = понедельник.
import type { Hours, LessonType, Settings } from './types';

export type Mark = 'present' | 'absent' | 'excused';
export type LessonKind = 'regular' | 'trial' | 'makeup';
export const MARKS: Mark[] = ['present', 'absent', 'excused'];

export interface JLesson {
  id: string;
  date: string;
  start: string;
  dur: number;
  type: LessonType;
  kind: LessonKind;
  groupId: string | null;
  planId: string | null;
  extOf: string | null;          // отработка за занятие, где все предупредили
  place: string;
  lane: string | null;
  log: string;
  nextNote: string;
  cancelled: boolean;
  clientIds: string[];
  att: Record<string, Mark>;
  reasons: Record<string, string>;
}
export interface Pause { id: string; from: string; to: string }
export interface JClient {
  id: string;
  name: string;
  archived: boolean;
  pauses: Pause[];
  plan: { id: string; slots: Record<string, string>; total: number; startsOn: string; programId: string | null } | null;
}
export interface JPayment { id: string; clientId: string; withId: string | null; date: string; sessions: number; amount: number; until: string | null }
export interface JGroup { id: string; type: LessonType; name: string; memberIds: string[]; archived: boolean }
export interface Vacation { id: string; from: string; to: string }
export interface Journal {
  clients: JClient[];
  groups: JGroup[];
  lessons: JLesson[];
  payments: JPayment[];
  vacations: Vacation[];
  settings: Pick<Settings, 'chargeNoShow' | 'breakMin' | 'stepMin' | 'week'>;
}

/** Что сохранить после операции: занятия целиком (с отметками) и id удалённых занятий. */
export interface Changes { upsert: JLesson[]; remove: string[] }
const changes = (): Changes => ({ upsert: [], remove: [] });

export class RuleError extends Error {}
const fail = (m: string): never => { throw new RuleError(m); };

/* ---------- даты и время ---------- */

const pad = (n: number) => String(n).padStart(2, '0');
export const dateOf = (iso: string) => { const [y, m, d] = iso.split('-').map(Number); return new Date(Date.UTC(y, m - 1, d)); };
export const dayKey = (d: Date) => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;
export const addDays = (iso: string, n: number) => dayKey(new Date(dateOf(iso).getTime() + n * 864e5));
export const weekday = (iso: string) => (dateOf(iso).getUTCDay() + 6) % 7;
export const toMin = (t: string) => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };
export const fromMin = (m: number) => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;
export const DEFAULT_TZ = 'Asia/Almaty';
/** «Настенное» время тренера: дата и минуты в его часовом поясе. */
export function wallNow(now: Date, tz = DEFAULT_TZ) {
  let p: Record<string, string>;
  try {
    p = Object.fromEntries(new Intl.DateTimeFormat('en-GB', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
      .formatToParts(now).map((x) => [x.type, x.value]));
  } catch { return wallNow(now, DEFAULT_TZ); }
  return { date: `${p.year}-${p.month}-${p.day}`, min: +p.hour * 60 + +p.minute };
}
export type Now = { date: string; min: number };
const startKey = (l: Pick<JLesson, 'date' | 'start'>) => `${l.date}T${l.start}`;
const nowKey = (n: Now) => `${n.date}T${fromMin(n.min)}`;
export const byStart = (a: JLesson, b: JLesson) => startKey(a).localeCompare(startKey(b));
export const isFuture = (l: JLesson, now: Now) => startKey(l) > nowKey(now);
export const endMin = (l: JLesson) => toMin(l.start) + l.dur;

/* ---------- паузы, отпуск, состав ---------- */

export const pauseAt = (c: JClient | undefined, date: string) => c?.pauses.find((p) => p.from <= date && date <= p.to);
export const isPaused = (c: JClient | undefined, date: string) => !!pauseAt(c, date);
export const onVacation = (J: Journal, date: string) => J.vacations.some((v) => v.from <= date && date <= v.to);
const clientOf = (J: Journal, id: string) => J.clients.find((c) => c.id === id);
/** Кого ждём на занятии: всех, кто не на паузе в этот день. */
export const activeClients = (J: Journal, l: JLesson) => l.clientIds.filter((id) => !isPaused(clientOf(J, id), l.date));

// Сплит — это всегда пара: один клиент на сплит или двое считаются как двое.
export const SPLIT_N = 2;
// Группа и мини-группа: от 1 человека, без верхнего предела.
export const GROUP_MIN = 1;
export const isGroupish = (t: LessonType) => t === 'group' || t === 'minigroup';
export const heads = (l: JLesson) => (l.type === 'split' ? SPLIT_N : l.clientIds.length);

/* ---------- списание и остаток ---------- */

/**
 * Списывается ли занятие с абонемента: да, если клиент был или не предупредил
 * (если тренер не выключил chargeNoShow; нет настройки — значит да). Пробное не списывается никогда.
 */
export function charged(J: Journal, l: JLesson, cid: string) {
  if (l.kind === 'trial') return false;
  const a = l.att[cid];
  return a === 'present' || (a === 'absent' && J.settings.chargeNoShow !== false);
}

/**
 * Остаток абонемента на дату `today`. Списанные занятия берутся из самой старой оплаты.
 * У новых оплат срока нет; старая оплата со сроком (until) покрывает только занятия до этой даты, остаток после неё сгорает.
 * remaining < 0 — долг; until — ближайший срок оплаты, на которой ещё есть занятия.
 */
export function balance(J: Journal, cid: string, today: string) {
  const used = J.lessons.filter((l) => !l.cancelled && l.clientIds.includes(cid) && charged(J, l, cid)).sort(byStart);
  const pays = J.payments.filter((p) => p.clientId === cid || p.withId === cid).sort((a, b) => a.date.localeCompare(b.date))
    .map((p) => ({ p, left: p.sessions }));
  let debt = 0;
  for (const l of used) { const b = pays.find((x) => x.left > 0 && (!x.p.until || l.date <= x.p.until)); if (b) b.left--; else debt++; }
  const active = pays.filter((x) => !x.p.until || x.p.until >= today);
  const remaining = active.reduce((t, x) => t + x.left, 0) - debt;
  const aPaid = active.reduce((t, x) => t + x.p.sessions, 0);
  return {
    paid: pays.reduce((t, x) => t + x.p.sessions, 0),
    aPaid,
    aUsed: aPaid - Math.max(0, remaining),
    used: used.length,
    remaining,
    burned: pays.filter((x) => x.p.until && x.p.until < today).reduce((t, x) => t + x.left, 0),
    until: active.filter((x) => x.left > 0 && x.p.until).map((x) => x.p.until!).sort()[0] || null,
  };
}
export const remaining = (J: Journal, cid: string, today = '9999-12-31') => balance(J, cid, today).remaining;

/* ---------- расписание по абонементу ---------- */

/**
 * Даты ровно для n занятий по выбранным дням недели с `from`, дни отпуска тренера пропускаются.
 * Серия заканчивается на n и сама никогда не продлевается.
 */
export function planDates(J: Journal, from: string, days: number[], n: number) {
  const out: string[] = [];
  if (!days.length || !(n > 0)) return out;
  for (let d = from, guard = 0; out.length < n && guard < 730; d = addDays(d, 1), guard++) {
    if (days.includes(weekday(d)) && !onVacation(J, d)) out.push(d);
  }
  return out;
}
/** У каждого дня недели своё время: slots = { '0': '18:00', '3': '18:30' }. */
export const planSlots = (J: Journal, from: string, slots: Record<string, string>, n: number) =>
  planDates(J, from, Object.keys(slots).map(Number), n).map((date) => ({ date, time: slots[String(weekday(date))] }));

const gap = (J: Journal) => Math.max(0, +(J.settings.breakMin ?? 10) || 0);
const step = (J: Journal) => Math.max(5, +J.settings.stepMin || 10);
/** Занятые минуты дня: каждое неотменённое занятие, расширенное перерывом до и после. */
const busyOn = (J: Journal, date: string, ignore: Set<string>) =>
  J.lessons.filter((l) => l.date === date && !l.cancelled && !ignore.has(l.id)).map((l) => [toMin(l.start) - gap(J), endMin(l) + gap(J), l] as const);
export const clash = (J: Journal, date: string, start: string, dur: number, ignore = new Set<string>()) => {
  const a = toMin(start), b = a + dur;
  return busyOn(J, date, ignore).find(([x, y]) => a < y && b > x)?.[2] || null;
};
const hoursOf = (J: Journal, d: number): Hours => J.settings.week[d] ?? null;

/** Начала занятий внутри рабочих часов, свободные во все эти даты (все — один день недели d). */
function freeTimes(J: Journal, dates: string[], dur: number, ignore: Set<string>, d: number, now: Now) {
  const h = hoursOf(J, d);
  if (!h || !dates.length) return [];
  const st = step(J), busy = dates.map((x) => busyOn(J, x, ignore));
  const min = dates.includes(now.date) ? now.min : 0, out: number[] = [];
  for (let a = Math.ceil(toMin(h.from) / st) * st; a + dur <= toMin(h.to); a += st) {
    if (a > min && busy.every((bs) => !bs.some(([x, y]) => a < y && a + dur > x))) out.push(a);
  }
  return out;
}
function combos<T>(arr: T[], k: number) {
  const out: T[][] = [], cur: T[] = [];
  const rec = (i: number) => { if (cur.length === k) { out.push(cur.slice()); return; } for (let j = i; j < arr.length; j++) { cur.push(arr[j]); rec(j + 1); cur.pop(); } };
  rec(0);
  return out;
}
export interface PlanAsk { total: number; perWeek: number; startsOn: string; slots: Record<string, string>; dur: number }
/**
 * Готовые наборы для клиента: perWeek рабочих дней, свободных на каждую дату абонемента.
 * Сначала одно время во все дни, потом дни, разнесённые по неделе, потом ближе к уже введённому времени.
 */
export function suggestSets(J: Journal, p: PlanAsk, ignore: Set<string>, now: Now) {
  const days = [0, 1, 2, 3, 4, 5, 6].filter((i) => hoursOf(J, i)), k = Math.min(p.perWeek, days.length);
  if (!k || !p.total || !p.startsOn) return [];
  const pref = toMin(Object.values(p.slots)[0] || '18:00');
  const near = (f: number[]) => f.reduce((a, x) => (Math.abs(x - pref) < Math.abs(a - pref) ? x : a));
  const sets: { slots: Record<string, string>; same: number; spread: number; dist: number }[] = [];
  for (const cb of combos(days, k)) {
    const dates = planDates(J, p.startsOn, cb, p.total);
    if (dates.length < p.total) continue;
    const free = cb.map((d) => freeTimes(J, dates.filter((x) => weekday(x) === d), p.dur, ignore, d, now));
    if (free.some((f) => !f.length)) continue;
    const common = free.reduce((a, f) => a.filter((x) => f.includes(x)));
    const spread = k > 1 ? Math.min(...cb.map((d, i) => (cb[(i + 1) % k] - d + 7) % 7)) : 7;
    const times = common.length ? cb.map(() => near(common)) : free.map(near);
    sets.push({ slots: Object.fromEntries(cb.map((d, i) => [String(d), fromMin(times[i])])), same: common.length ? 1 : 0, spread: spread > 1 ? 1 : 0, dist: times.reduce((a, x) => a + Math.abs(x - pref), 0) / k });
  }
  return sets.sort((a, b) => b.same - a.same || b.spread - a.spread || a.dist - b.dist).slice(0, 5).map((s) => s.slots);
}

/** Будущие неотмеченные занятия клиента вне групп — их заменяет новый абонемент. */
export const planned = (J: Journal, cid: string, now: Now) =>
  J.lessons.filter((l) => !l.groupId && !l.cancelled && l.clientIds.includes(cid) && isFuture(l, now) && !Object.keys(l.att).length);

const newLesson = (o: Partial<JLesson> & Pick<JLesson, 'date' | 'start' | 'dur' | 'type'>): JLesson => ({
  id: crypto.randomUUID(), kind: 'regular', groupId: null, planId: null, extOf: null, place: '', lane: null, log: '', nextNote: '',
  cancelled: false, clientIds: [], att: {}, reasons: {}, ...o,
});

export interface PlanInput extends PlanAsk { type: LessonType; place: string; lane: string | null; programId: string | null; replace: boolean }
/**
 * Абонемент → расписание: ровно total занятий по дням и времени плана, без продления.
 * replace — убрать клиента из уже запланированных будущих занятий (пустые удаляются).
 */
export function applyPlan(J: Journal, cid: string, p: PlanInput, now: Now) {
  const c = clientOf(J, cid) || fail('Клиент не найден');
  if (isGroupish(p.type)) fail('Клиент группы ходит по расписанию группы');
  if (!Object.keys(p.slots).length) fail('Отметьте хотя бы один день недели');
  const list = planSlots(J, p.startsOn, p.slots, p.total);
  if (!list.length) fail('Не нашлось ни одного дня для занятий');
  const ch = changes();
  if (p.replace) {
    for (const l of planned(J, cid, now)) {
      l.clientIds = l.clientIds.filter((x) => x !== cid);
      if (l.clientIds.length) ch.upsert.push(l); else ch.remove.push(l.id);
    }
    J.lessons = J.lessons.filter((l) => !ch.remove.includes(l.id));
  }
  const planId = crypto.randomUUID();
  c.plan = { id: planId, slots: p.slots, total: p.total, startsOn: p.startsOn, programId: p.programId };
  for (const x of list) {
    const l = newLesson({ date: x.date, start: x.time, dur: p.dur, type: p.type, planId, place: p.place, lane: p.lane, clientIds: [cid] });
    J.lessons.push(l);
    ch.upsert.push(l);
  }
  J.lessons.sort(byStart);
  return { plan: c.plan, changes: ch, created: list.length };
}

/* ---------- отдельные занятия ---------- */

export interface LessonInput {
  date: string; start: string; dur: number; type: LessonType; kind: LessonKind;
  clientIds: string[]; groupId: string | null; place: string; lane: string | null;
  repeat: { n: number; days: number[] } | null;
}
export function createLessons(J: Journal, x: LessonInput) {
  let clientIds = x.clientIds, groupId: string | null = null;
  if (isGroupish(x.type)) {
    const g = J.groups.find((y) => y.id === x.groupId) || fail('Выберите группу');
    if (g.memberIds.length < GROUP_MIN) fail('В группе должен быть хотя бы один человек');
    clientIds = [...g.memberIds]; groupId = g.id;
  } else {
    if (!clientIds.length) fail('Выберите клиента');
    if (x.type === 'split' && clientIds.length > SPLIT_N) fail('Сплит — это двое');
    for (const id of clientIds) if (!clientOf(J, id)) fail('Клиент не найден');
  }
  const n = x.repeat?.n || 1;
  const dates = n === 1 ? [x.date] : planDates(J, x.date, [...new Set([weekday(x.date), ...(x.repeat?.days || [])])], n);
  const ch = changes();
  for (const date of dates) {
    const l = newLesson({ date, start: x.start, dur: x.dur, type: x.type, kind: x.kind, groupId, place: x.place, lane: x.lane, clientIds: [...clientIds] });
    J.lessons.push(l);
    ch.upsert.push(l);
  }
  J.lessons.sort(byStart);
  return ch;
}

/* ---------- отметки и отработка ---------- */

/**
 * Все на занятии предупредили: ничего не списано, поэтому в конец серии добавляется одна отработка —
 * в ближайший свободный день плана клиента. Снятие отметки убирает отработку, пока она не отмечена.
 * Группы и пробные не продлеваются.
 */
export function syncMakeup(J: Journal, l: JLesson, ch = changes()) {
  if (l.groupId || l.kind === 'trial' || l.cancelled) return { add: null as JLesson | null, ch };
  const ids = l.clientIds.filter((id) => l.att[id] || !isPaused(clientOf(J, id), l.date));
  const want = ids.length > 0 && ids.every((id) => l.att[id] === 'excused');
  const ext = J.lessons.find((x) => x.extOf === l.id);
  if (!want) {
    if (ext && !Object.keys(ext.att).length) { J.lessons = J.lessons.filter((x) => x !== ext); ch.remove.push(ext.id); }
    return { add: null, ch };
  }
  if (ext) return { add: ext, ch };
  const key = [...l.clientIds].sort().join(',');
  const last = J.lessons.filter((x) => !x.groupId && !x.cancelled && [...x.clientIds].sort().join(',') === key)
    .reduce((a, x) => (x.date > a ? x.date : a), l.date);
  const pl = clientOf(J, l.clientIds[0])?.plan;
  const slots: Record<string, string> = pl?.slots && Object.keys(pl.slots).length ? pl.slots : { [String(weekday(l.date))]: l.start };
  const busy = (date: string, start: string) => {
    const a = toMin(start), b = a + l.dur;
    return J.lessons.some((x) => x.date === date && !x.cancelled && a < endMin(x) + gap(J) && b > toMin(x.start) - gap(J));
  };
  type Pick = { day: string; start: string } | null;
  let pick: Pick = null, first: Pick = null;
  for (let i = 1; i <= 120 && !pick; i++) {
    const day = addDays(last, i), start = slots[String(weekday(day))];
    if (!start || onVacation(J, day)) continue;
    first = first || { day, start };
    if (!busy(day, start)) pick = { day, start };
  }
  pick = pick || first;
  if (!pick) return { add: null, ch };
  const add = newLesson({ date: pick.day, start: pick.start, dur: l.dur, type: l.type, kind: 'makeup', planId: l.planId, place: l.place, lane: l.lane, clientIds: [...l.clientIds], extOf: l.id });
  J.lessons.push(add);
  J.lessons.sort(byStart);
  ch.upsert.push(add);
  return { add, ch };
}

/** Ставит, меняет или снимает (mark = null) отметку клиента и обновляет отработку. */
export function setMark(J: Journal, lessonId: string, cid: string, mark: Mark | null, reason: string | null) {
  const l = J.lessons.find((x) => x.id === lessonId) || fail('Занятие не найдено');
  if (!l.clientIds.includes(cid)) fail('Этого клиента нет на занятии');
  if (mark) l.att[cid] = mark; else delete l.att[cid];
  if (mark && reason) l.reasons[cid] = reason; else delete l.reasons[cid];
  const ch = changes();
  ch.upsert.push(l);
  const { add } = syncMakeup(J, l, ch);
  return { lesson: l, makeup: add, changes: ch };
}

/** Новый состав группы попадает во все её будущие занятия; отметки ушедших снимаются. */
export function syncGroup(J: Journal, g: JGroup, now: Now) {
  const ch = changes();
  for (const l of J.lessons) {
    if (l.groupId !== g.id || !isFuture(l, now)) continue;
    l.clientIds = [...g.memberIds];
    l.type = g.type;
    for (const k of Object.keys(l.att)) if (!g.memberIds.includes(k)) { delete l.att[k]; delete l.reasons[k]; }
    ch.upsert.push(l);
  }
  return ch;
}

/* ---------- сводка клиента для экрана «Клиенты» ---------- */

export type Cell = Mark | 'trial' | 'pause' | 'unmarked' | 'cancelled';
export interface ClientSummary {
  remaining: number;      // < 0 — долг
  paid: number;           // занятий в действующих оплатах
  used: number;
  last: Cell[];           // последние 8 прошедших занятий, старые слева
  next: { date: string; start: string; kind: LessonKind } | null;
  unmarked: number;       // прошедшие без отметки
  plan: JClient['plan'];
  type: LessonType | null;
}
export function cellOf(J: Journal, l: JLesson, cid: string): Cell {
  if (l.cancelled) return 'cancelled';
  if (isPaused(clientOf(J, cid), l.date) && !l.att[cid]) return 'pause';
  const m = l.att[cid];
  if (!m) return 'unmarked';
  if (l.kind === 'trial' && m === 'present') return 'trial';
  return m;
}
export function summary(J: Journal, cid: string, now: Now): ClientSummary {
  const mine = J.lessons.filter((l) => l.clientIds.includes(cid)).sort(byStart);
  const past = mine.filter((l) => !isFuture(l, now));
  const b = balance(J, cid, now.date);
  const next = mine.find((l) => !l.cancelled && isFuture(l, now) && !isPaused(clientOf(J, cid), l.date)) || null;
  return {
    remaining: b.remaining, paid: b.aPaid, used: b.used,
    last: past.slice(-8).map((l) => cellOf(J, l, cid)),
    next: next && { date: next.date, start: next.start, kind: next.kind },
    unmarked: past.filter((l) => cellOf(J, l, cid) === 'unmarked').length,
    plan: clientOf(J, cid)?.plan ?? null,
    type: mine.at(-1)?.type ?? null,
  };
}
