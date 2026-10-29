// Журнал тренера из D1 в память (для правил из src/shared/rules.ts) и обратно.
// Всё читается и пишется только с coach_id из сессии; в записи каждая строка дополнительно проверяется по coach_id.
import { mergeSettings } from '../shared/types';
import { wallNow, type Changes, type JClient, type JGroup, type JLesson, type Journal, type Mark } from '../shared/rules';

export async function loadJournal(db: D1Database, coachId: string) {
  const q = (sql: string) => db.prepare(sql).bind(coachId);
  const [coach, clients, pauses, plans, groups, members, lessons, att, payments, vacations] = await db.batch([
    q('SELECT tz, settings FROM coaches WHERE id = ?'),
    q('SELECT id, name, archived_at FROM clients WHERE coach_id = ?'),
    q('SELECT id, client_id, from_date, to_date FROM client_pauses WHERE coach_id = ? ORDER BY from_date'),
    q('SELECT id, client_id, program_id, starts_on, total, slots FROM client_plans WHERE coach_id = ? ORDER BY created_at, rowid'),
    q('SELECT id, type, name, archived_at FROM client_groups WHERE coach_id = ?'),
    q('SELECT group_id, client_id FROM group_members WHERE coach_id = ?'),
    q('SELECT * FROM lessons WHERE coach_id = ? ORDER BY date, start'),
    q('SELECT lesson_id, client_id, mark, reason FROM attendance WHERE coach_id = ? ORDER BY rowid'),
    q('SELECT id, client_id, with_client_id, date, sessions, amount, until FROM payments WHERE coach_id = ?'),
    q('SELECT id, from_date, to_date FROM vacations WHERE coach_id = ? ORDER BY from_date'),
  ]);
  const c0 = coach.results[0] as any;
  const settings = mergeSettings(JSON.parse(c0.settings));
  const byClient = new Map<string, JClient>();
  for (const r of clients.results as any[]) byClient.set(r.id, { id: r.id, name: r.name, archived: !!r.archived_at, pauses: [], plan: null });
  for (const r of pauses.results as any[]) byClient.get(r.client_id)?.pauses.push({ id: r.id, from: r.from_date, to: r.to_date });
  for (const r of plans.results as any[]) {
    const c = byClient.get(r.client_id);
    if (c) c.plan = { id: r.id, slots: JSON.parse(r.slots), total: r.total, startsOn: r.starts_on, programId: r.program_id };
  }
  const byGroup = new Map<string, JGroup>();
  for (const r of groups.results as any[]) byGroup.set(r.id, { id: r.id, type: r.type, name: r.name, memberIds: [], archived: !!r.archived_at });
  for (const r of members.results as any[]) byGroup.get(r.group_id)?.memberIds.push(r.client_id);
  const byLesson = new Map<string, JLesson>();
  for (const r of lessons.results as any[]) {
    byLesson.set(r.id, {
      id: r.id, date: r.date, start: r.start, dur: r.dur, type: r.type, kind: r.kind, groupId: r.group_id, planId: r.plan_id,
      extOf: r.ext_of, place: r.place, lane: r.lane, log: r.log, nextNote: r.next_note, cancelled: !!r.cancelled,
      clientIds: [], att: {}, reasons: {},
    });
  }
  for (const r of att.results as any[]) {
    const l = byLesson.get(r.lesson_id);
    if (!l) continue;
    l.clientIds.push(r.client_id);
    if (r.mark) l.att[r.client_id] = r.mark as Mark;
    if (r.reason) l.reasons[r.client_id] = r.reason;
  }
  const J: Journal = {
    clients: [...byClient.values()],
    groups: [...byGroup.values()],
    lessons: [...byLesson.values()],
    payments: (payments.results as any[]).map((r) => ({ id: r.id, clientId: r.client_id, withId: r.with_client_id, date: r.date, sessions: r.sessions, amount: r.amount, until: r.until })),
    vacations: (vacations.results as any[]).map((r) => ({ id: r.id, from: r.from_date, to: r.to_date })),
    settings: { chargeNoShow: settings.chargeNoShow, breakMin: settings.breakMin, stepMin: settings.stepMin, week: settings.week },
  };
  return { J, now: wallNow(new Date(), c0.tz) };
}

/** Сохраняет изменения одной транзакцией (D1 batch). Занятие пишется целиком: строка и все отметки. */
export function saveStatements(db: D1Database, coachId: string, ch: Changes) {
  const out: D1PreparedStatement[] = [];
  for (const id of ch.remove) out.push(db.prepare('DELETE FROM lessons WHERE id = ? AND coach_id = ?').bind(id, coachId));
  const stamp = new Date().toISOString();
  for (const l of ch.upsert) {
    out.push(db.prepare(`INSERT INTO lessons (id, coach_id, date, start, dur, type, kind, group_id, plan_id, ext_of, place, lane, log, next_note, cancelled)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(id) DO UPDATE SET date = excluded.date, start = excluded.start, dur = excluded.dur, type = excluded.type, kind = excluded.kind,
        group_id = excluded.group_id, plan_id = excluded.plan_id, ext_of = excluded.ext_of, place = excluded.place, lane = excluded.lane,
        log = excluded.log, next_note = excluded.next_note, cancelled = excluded.cancelled
      WHERE lessons.coach_id = excluded.coach_id`)
      .bind(l.id, coachId, l.date, l.start, l.dur, l.type, l.kind, l.groupId, l.planId, l.extOf, l.place, l.lane, l.log, l.nextNote, l.cancelled ? 1 : 0));
    out.push(db.prepare('DELETE FROM attendance WHERE lesson_id = ? AND coach_id = ? AND client_id NOT IN (SELECT value FROM json_each(?))')
      .bind(l.id, coachId, JSON.stringify(l.clientIds)));
    for (const cid of l.clientIds) {
      const mark = l.att[cid] ?? null;
      out.push(db.prepare(`INSERT INTO attendance (lesson_id, client_id, coach_id, mark, reason, marked_at) VALUES (?, ?, ?, ?, ?, ?)
        ON CONFLICT(lesson_id, client_id) DO UPDATE SET mark = excluded.mark, reason = excluded.reason,
          marked_at = CASE WHEN attendance.mark IS excluded.mark THEN attendance.marked_at ELSE excluded.marked_at END
        WHERE attendance.coach_id = excluded.coach_id`)
        .bind(l.id, cid, coachId, mark, mark ? l.reasons[cid] ?? null : null, mark ? stamp : null));
    }
  }
  return out;
}

export async function saveChanges(db: D1Database, coachId: string, ch: Changes, extra: D1PreparedStatement[] = []) {
  const stmts = [...extra, ...saveStatements(db, coachId, ch)];
  if (stmts.length) await db.batch(stmts);
}
