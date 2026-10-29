// Этап 1: расписание и отметки. Каждая операция читает журнал тренера, применяет правило из src/shared/rules.ts
// и сохраняет изменения одной транзакцией. id из адреса ищется только в журнале этого тренера: чужое — 404.
import { Hono, type Context } from 'hono';
import type { AppEnv } from './env';
import { body, onApiError } from './errors';
import { loadJournal, saveChanges } from './journal';
import { DEFAULT_DUR, Invalid, LESSON_TYPES, int, oneOf, str, time, type LessonType } from '../shared/types';
import {
  MARKS, applyPlan, createLessons, planned, setMark, suggestSets, syncGroup, type JLesson, type LessonKind,
} from '../shared/rules';

type C = Context<AppEnv>;
export const schedule = new Hono<AppEnv>();
schedule.onError(onApiError);

const DATE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;
const date = (v: unknown, field: string) => {
  if (typeof v !== 'string' || !DATE.test(v) || isNaN(Date.parse(`${v}T00:00:00Z`))) throw new Invalid(`${field}: дата ГГГГ-ММ-ДД`);
  return v;
};
const notFound = (c: C) => c.json({ error: 'not_found' }, 404);
const lane = (v: unknown) => str(v, 'Дорожка', 20, { nullable: true });
const place = (v: unknown) => str(v ?? '', 'Место', 80, { min: 0 }) ?? '';
function slots(v: unknown) {
  if (!v || typeof v !== 'object' || Array.isArray(v)) throw new Invalid('Дни: нужен объект «день недели → время»');
  const out: Record<string, string> = {};
  for (const [k, t] of Object.entries(v)) {
    if (!/^[0-6]$/.test(k)) throw new Invalid('Дни: день недели от 0 (пн) до 6 (вс)');
    out[k] = time(t, 'Время');
  }
  return out;
}
const weekdays = (v: unknown) => {
  if (!Array.isArray(v) || v.length > 7) throw new Invalid('Дни: нужен список');
  return [...new Set(v.map((d) => int(d, 'День недели', 0, 6)))];
};
const ids = (v: unknown, field: string) => {
  if (!Array.isArray(v) || v.length > 200 || v.some((x) => typeof x !== 'string')) throw new Invalid(`${field}: нужен список`);
  return [...new Set(v as string[])];
};

/* ---------- занятия ---------- */

schedule.get('/lessons', async (c) => {
  const from = date(c.req.query('from'), 'С'), to = date(c.req.query('to'), 'По');
  if (to < from || Date.parse(to) - Date.parse(from) > 62 * 864e5) throw new Invalid('Период — не больше двух месяцев');
  const { J, now } = await loadJournal(c.env.DB, c.get('coachId'));
  return c.json({ now, lessons: J.lessons.filter((l) => l.date >= from && l.date <= to) });
});

schedule.post('/lessons', async (c) => {
  const b = await body(c), coach = c.get('coachId');
  const { J } = await loadJournal(c.env.DB, coach);
  const type = oneOf(b?.type, 'Вид занятия', LESSON_TYPES);
  const ch = createLessons(J, {
    date: date(b?.date, 'Дата'), start: time(b?.start, 'Начало'), dur: int(b?.dur ?? DEFAULT_DUR[type], 'Длительность', 5, 240), type,
    kind: oneOf(b?.kind ?? 'regular', 'Вид', ['regular', 'trial', 'makeup'] as const) as LessonKind,
    clientIds: b?.clientIds === undefined ? [] : ids(b.clientIds, 'Клиенты'),
    groupId: b?.groupId ? String(b.groupId) : null, place: place(b?.place), lane: lane(b?.lane),
    repeat: b?.repeat ? { n: int(b.repeat.n, 'Повторов', 1, 60), days: weekdays(b.repeat.days ?? []) } : null,
  });
  await saveChanges(c.env.DB, coach, ch);
  return c.json(ch.upsert, 201);
});

schedule.put('/lessons/:id', async (c) => {
  const b = await body(c), coach = c.get('coachId');
  const { J } = await loadJournal(c.env.DB, coach);
  const l = J.lessons.find((x) => x.id === c.req.param('id'));
  if (!l) return notFound(c);
  const patch: Partial<JLesson> = {};
  if (b?.date !== undefined) patch.date = date(b.date, 'Дата');
  if (b?.start !== undefined) patch.start = time(b.start, 'Начало');
  if (b?.dur !== undefined) patch.dur = int(b.dur, 'Длительность', 5, 240);
  if (b?.place !== undefined) patch.place = place(b.place);
  if (b?.lane !== undefined) patch.lane = lane(b.lane);
  if (b?.log !== undefined) patch.log = str(b.log, 'Конспект', 4000, { min: 0, nullable: true }) ?? '';
  if (b?.nextNote !== undefined) patch.nextNote = str(b.nextNote, 'На следующий раз', 1000, { min: 0, nullable: true }) ?? '';
  if (b?.cancelled !== undefined) patch.cancelled = b.cancelled === true;
  Object.assign(l, patch);
  await saveChanges(c.env.DB, coach, { upsert: [l], remove: [] });
  return c.json(l);
});

schedule.delete('/lessons/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM lessons WHERE id = ? AND coach_id = ?').bind(c.req.param('id'), c.get('coachId')).run();
  return r.meta.changes ? c.json({ ok: true }) : notFound(c);
});

/** Отметка: { mark: 'present' | 'absent' | 'excused' | null, reason? }. Ответ — занятие и отработка, если появилась. */
schedule.put('/lessons/:id/marks/:clientId', async (c) => {
  const b = await body(c), coach = c.get('coachId');
  const mark = b?.mark === null ? null : oneOf(b?.mark, 'Отметка', MARKS);
  const reason = str(b?.reason, 'Причина', 120, { nullable: true });
  const { J } = await loadJournal(c.env.DB, coach);
  if (!J.lessons.some((x) => x.id === c.req.param('id'))) return notFound(c);
  const r = setMark(J, c.req.param('id'), c.req.param('clientId'), mark, reason);
  await saveChanges(c.env.DB, coach, r.changes);
  return c.json({ lesson: r.lesson, makeup: r.makeup, removed: r.changes.remove });
});

/* ---------- абонемент → расписание ---------- */

async function planAsk(c: C, b: any) {
  let type: LessonType, dur: number, programId: string | null = null;
  if (b?.programId) {
    const p = await c.env.DB.prepare('SELECT id, type, dur FROM programs WHERE id = ? AND coach_id = ?').bind(String(b.programId), c.get('coachId')).first<any>();
    if (!p) throw new Invalid('Программа не найдена');
    ({ type, dur } = p); programId = p.id;
  } else {
    type = oneOf(b?.type, 'Вид занятия', LESSON_TYPES);
    dur = int(b?.dur ?? DEFAULT_DUR[type], 'Длительность', 5, 240);
  }
  const s = slots(b?.slots ?? {});
  return {
    type, dur, programId, slots: s,
    total: int(b?.total, 'Занятий', 1, 60),
    perWeek: int(b?.perWeek ?? Math.max(1, Object.keys(s).length), 'Раз в неделю', 1, 7),
    startsOn: date(b?.startsOn, 'С какого дня'),
    place: place(b?.place), lane: lane(b?.lane), replace: b?.replace !== false,
  };
}

schedule.post('/clients/:id/plan', async (c) => {
  const coach = c.get('coachId'), cid = c.req.param('id');
  const { J, now } = await loadJournal(c.env.DB, coach);
  if (!J.clients.some((x) => x.id === cid)) return notFound(c);
  const p = await planAsk(c, await body(c));
  const r = applyPlan(J, cid, p, now);
  await saveChanges(c.env.DB, coach, r.changes, [
    c.env.DB.prepare('INSERT INTO client_plans (id, coach_id, client_id, program_id, starts_on, total, slots, place) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
      .bind(r.plan.id, coach, cid, p.programId, p.startsOn, p.total, JSON.stringify(p.slots), p.place),
  ]);
  return c.json({ plan: r.plan, created: r.created, removed: r.changes.remove.length }, 201);
});

/** Подбор свободного времени: наборы «день → время», свободные на все даты абонемента. */
schedule.post('/plan/suggest', async (c) => {
  const b = await body(c), coach = c.get('coachId');
  const { J, now } = await loadJournal(c.env.DB, coach);
  const cid = b?.clientId ? String(b.clientId) : null;
  if (cid && !J.clients.some((x) => x.id === cid)) return notFound(c);
  const p = await planAsk(c, b);
  const ignore = new Set(cid && p.replace ? planned(J, cid, now).filter((l) => l.clientIds.length === 1).map((l) => l.id) : []);
  return c.json(suggestSets(J, p, ignore, now));
});

/* ---------- паузы клиента и отпуск тренера ---------- */

const range = (b: any) => {
  const from = date(b?.from, 'С'), to = date(b?.to, 'По');
  if (to < from) throw new Invalid('Конец раньше начала');
  return { from, to };
};

schedule.post('/clients/:id/pauses', async (c) => {
  const { from, to } = range(await body(c)), coach = c.get('coachId'), cid = c.req.param('id');
  const ok = await c.env.DB.prepare('SELECT 1 FROM clients WHERE id = ? AND coach_id = ?').bind(cid, coach).first();
  if (!ok) return notFound(c);
  const id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO client_pauses (id, coach_id, client_id, from_date, to_date) VALUES (?, ?, ?, ?, ?)').bind(id, coach, cid, from, to).run();
  return c.json({ id, from, to }, 201);
});
schedule.delete('/clients/:id/pauses/:pid', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM client_pauses WHERE id = ? AND client_id = ? AND coach_id = ?')
    .bind(c.req.param('pid'), c.req.param('id'), c.get('coachId')).run();
  return r.meta.changes ? c.json({ ok: true }) : notFound(c);
});

schedule.get('/vacations', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT id, from_date AS "from", to_date AS "to" FROM vacations WHERE coach_id = ? ORDER BY from_date').bind(c.get('coachId')).all();
  return c.json(results);
});
schedule.post('/vacations', async (c) => {
  const { from, to } = range(await body(c)), id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO vacations (id, coach_id, from_date, to_date) VALUES (?, ?, ?, ?)').bind(id, c.get('coachId'), from, to).run();
  return c.json({ id, from, to }, 201);
});
schedule.delete('/vacations/:id', async (c) => {
  const r = await c.env.DB.prepare('DELETE FROM vacations WHERE id = ? AND coach_id = ?').bind(c.req.param('id'), c.get('coachId')).run();
  return r.meta.changes ? c.json({ ok: true }) : notFound(c);
});

/* ---------- группы ---------- */

schedule.get('/groups', async (c) => {
  const { J } = await loadJournal(c.env.DB, c.get('coachId'));
  return c.json(J.groups);
});

async function saveGroup(c: C, id: string | null, b: any) {
  const coach = c.get('coachId');
  const { J, now } = await loadJournal(c.env.DB, coach);
  const g = id ? J.groups.find((x) => x.id === id) : { id: crypto.randomUUID(), type: 'group' as LessonType, name: '', memberIds: [] as string[], archived: false };
  if (!g) return notFound(c);
  g.name = str(b?.name, 'Название', 80)!;
  g.type = oneOf(b?.type, 'Вид', ['minigroup', 'group'] as const);
  g.memberIds = ids(b?.memberIds ?? [], 'Участники');
  g.archived = b?.archived === true;
  if (!g.memberIds.length) throw new Invalid('В группе должен быть хотя бы один человек');
  for (const m of g.memberIds) if (!J.clients.some((x) => x.id === m)) throw new Invalid('Участник не найден');
  const db = c.env.DB;
  const head = [
    id
      ? db.prepare('UPDATE client_groups SET name = ?, type = ?, archived_at = ? WHERE id = ? AND coach_id = ?').bind(g.name, g.type, g.archived ? new Date().toISOString() : null, g.id, coach)
      : db.prepare('INSERT INTO client_groups (id, coach_id, type, name) VALUES (?, ?, ?, ?)').bind(g.id, coach, g.type, g.name),
    db.prepare('DELETE FROM group_members WHERE group_id = ? AND coach_id = ?').bind(g.id, coach),
    ...g.memberIds.map((m) => db.prepare('INSERT INTO group_members (group_id, client_id, coach_id) VALUES (?, ?, ?)').bind(g.id, m, coach)),
  ];
  if (!id) J.groups.push(g);
  await saveChanges(db, coach, syncGroup(J, g, now), head);
  return c.json(g, id ? 200 : 201);
}
schedule.post('/groups', async (c) => saveGroup(c, null, await body(c)));
schedule.put('/groups/:id', async (c) => saveGroup(c, c.req.param('id'), await body(c)));
