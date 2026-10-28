// API тренера. Правило изоляции: каждый запрос к базе фильтрует по coachId из сессии (c.get('coachId')),
// id из адреса или тела ищется только среди строк этого тренера. Чужое — всегда 404, как будто его нет.
import { Hono, type Context } from 'hono';
import { deleteCookie } from 'hono/cookie';
import type { AppEnv } from './env';
import { requireCoach, sameOrigin, SESSION_COOKIE } from './auth';
import {
  CLIENT_CONSENT_VERSION, COACH_CONSENT_VERSION, FREE_LIMIT, Invalid, mergeSettings, parseClient, parseConsent,
  parseProgram, parseSettings, type Client, type ClientConsent, type Coach, type Program,
} from '../shared/types';

type C = Context<AppEnv>;
const now = () => new Date().toISOString();

export const api = new Hono<AppEnv>();
api.use('*', sameOrigin, requireCoach);

api.onError((err, c) => {
  if (err instanceof Invalid) return c.json({ error: 'invalid', message: err.message }, 400);
  const m = String(err?.message || '');
  if (m.includes('free_limit')) return c.json({ error: 'free_limit', message: `На бесплатном тарифе до ${FREE_LIMIT} клиентов` }, 409);
  const consent = m.match(/consent_[a-z_]+/)?.[0];
  if (consent) return c.json({ error: consent }, 400);
  console.error('api', err);
  return c.json({ error: 'server' }, 500);
});

const body = async (c: C) => c.req.json().catch(() => { throw new Invalid('Тело запроса — не JSON'); });

/* ---------- тренер ---------- */

async function loadCoach(c: C): Promise<Coach> {
  const id = c.get('coachId'), db = c.env.DB;
  const [coach, consent, sub, cnt] = await db.batch([
    db.prepare('SELECT id, email, name, tz, settings FROM coaches WHERE id = ?').bind(id),
    db.prepare('SELECT version, given_at FROM coach_consents WHERE coach_id = ? ORDER BY given_at DESC, rowid DESC LIMIT 1').bind(id),
    db.prepare('SELECT tier, paid_until FROM subscriptions WHERE coach_id = ?').bind(id),
    db.prepare('SELECT count(*) AS n FROM clients WHERE coach_id = ? AND archived_at IS NULL').bind(id),
  ]);
  const r = coach.results[0] as any, k = consent.results[0] as any, s = sub.results[0] as any;
  const tier = (s?.tier || 'free') as Coach['tier'];
  const paid = tier !== 'free' && (!s?.paid_until || s.paid_until >= now().slice(0, 10));
  return {
    id: r.id, email: r.email, name: r.name, tz: r.tz, settings: mergeSettings(JSON.parse(r.settings)),
    consent: k ? { version: k.version, givenAt: k.given_at } : null,
    tier, paidUntil: s?.paid_until ?? null,
    activeClients: (cnt.results[0] as any).n,
    limit: paid ? null : FREE_LIMIT,
  };
}

api.get('/me', async (c) => c.json(await loadCoach(c)));

/** Согласие тренера. Версия — только текущая, дата — только серверная. */
api.post('/consent', async (c) => {
  const b = await body(c);
  if (b?.version !== COACH_CONSENT_VERSION || b?.agree !== true) throw new Invalid('Нужно согласие с текущей версией условий');
  await c.env.DB.prepare('INSERT INTO coach_consents (id, coach_id, version) VALUES (?, ?, ?)')
    .bind(crypto.randomUUID(), c.get('coachId'), COACH_CONSENT_VERSION).run();
  return c.json(await loadCoach(c));
});

/** Выгрузка всех своих данных одним JSON (право субъекта на доступ к своим данным). */
api.get('/export', async (c) => {
  const id = c.get('coachId'), db = c.env.DB;
  const tables = ['coach_consents', 'subscriptions', 'programs', 'clients', 'client_consents', 'client_plans', 'client_pauses',
    'client_groups', 'group_members', 'lessons', 'attendance', 'payments', 'vacations', 'measurements', 'skills', 'plan_templates'];
  const res = await db.batch(tables.map((t) => db.prepare(`SELECT * FROM ${t} WHERE coach_id = ?`).bind(id)));
  const coach = await db.prepare('SELECT id, email, name, tz, settings, created_at FROM coaches WHERE id = ?').bind(id).first();
  const out: Record<string, unknown> = { exportedAt: now(), coach };
  tables.forEach((t, i) => { out[t] = res[i].results; });
  c.header('content-disposition', `attachment; filename="dorozhka-${now().slice(0, 10)}.json"`);
  return c.json(out);
});

/** Отзыв согласия тренера = удаление аккаунта со всеми данными, включая фото чеков. */
api.delete('/account', async (c) => {
  const b = await body(c);
  if (b?.confirm !== 'УДАЛИТЬ') throw new Invalid('Для удаления введите УДАЛИТЬ');
  const id = c.get('coachId');
  for (let cursor: string | undefined; ;) {
    const list = await c.env.RECEIPTS.list({ prefix: `${id}/`, cursor });
    if (list.objects.length) await c.env.RECEIPTS.delete(list.objects.map((o) => o.key));
    if (!list.truncated) break;
    cursor = list.cursor;
  }
  await c.env.DB.prepare('DELETE FROM coaches WHERE id = ?').bind(id).run(); // каскадом уходит всё остальное
  deleteCookie(c, SESSION_COOKIE, { path: '/', secure: true });
  return c.json({ ok: true });
});

// Дальше — только после согласия тренера.
api.use('*', async (c, next) => {
  const ok = await c.env.DB.prepare('SELECT 1 FROM coach_consents WHERE coach_id = ? AND version = ?')
    .bind(c.get('coachId'), COACH_CONSENT_VERSION).first();
  if (!ok) return c.json({ error: 'consent_required' }, 403);
  await next();
});

api.put('/settings', async (c) => {
  const cur = await loadCoach(c);
  const b = await body(c);
  const settings = parseSettings(b, cur.settings);
  const name = b?.name === undefined ? cur.name : String(b.name).trim().slice(0, 80);
  await c.env.DB.prepare('UPDATE coaches SET settings = ?, name = ? WHERE id = ?').bind(JSON.stringify(settings), name, cur.id).run();
  return c.json(await loadCoach(c));
});

/* ---------- программы и цены ---------- */

const programOf = (r: any): Program => ({ id: r.id, type: r.type, name: r.name, dur: r.dur, packs: JSON.parse(r.packs), archived: !!r.archived });

api.get('/programs', async (c) => {
  const { results } = await c.env.DB.prepare('SELECT * FROM programs WHERE coach_id = ? ORDER BY archived, rowid').bind(c.get('coachId')).all();
  return c.json(results.map(programOf));
});
api.post('/programs', async (c) => {
  const p = parseProgram(await body(c)), id = crypto.randomUUID();
  await c.env.DB.prepare('INSERT INTO programs (id, coach_id, type, name, dur, packs) VALUES (?, ?, ?, ?, ?, ?)')
    .bind(id, c.get('coachId'), p.type, p.name, p.dur, JSON.stringify(p.packs)).run();
  return c.json({ id, ...p, archived: false }, 201);
});
api.put('/programs/:id', async (c) => {
  const b = await body(c), p = parseProgram(b);
  const r = await c.env.DB.prepare('UPDATE programs SET type = ?, name = ?, dur = ?, packs = ?, archived = ? WHERE id = ? AND coach_id = ?')
    .bind(p.type, p.name, p.dur, JSON.stringify(p.packs), b?.archived === true ? 1 : 0, c.req.param('id'), c.get('coachId')).run();
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json({ id: c.req.param('id'), ...p, archived: b?.archived === true });
});

/* ---------- клиенты ---------- */

const consentOf = (r: any): ClientConsent => ({
  id: r.id, kind: r.kind, method: r.method, signedBy: r.signed_by, signerName: r.signer_name,
  textVersion: r.text_version, givenAt: r.given_at, revokedAt: r.revoked_at,
});
async function loadClients(c: C, only?: string): Promise<Client[]> {
  const id = c.get('coachId'), db = c.env.DB;
  const where = only ? 'coach_id = ? AND id = ?' : 'coach_id = ?';
  const cwhere = only ? 'coach_id = ? AND client_id = ?' : 'coach_id = ?';
  const args = only ? [id, only] : [id];
  const [cl, cs] = await db.batch([
    db.prepare(`SELECT * FROM clients WHERE ${where} ORDER BY archived_at IS NOT NULL, name COLLATE NOCASE`).bind(...args),
    db.prepare(`SELECT * FROM client_consents WHERE ${cwhere} ORDER BY given_at`).bind(...args),
  ]);
  const byClient = new Map<string, ClientConsent[]>();
  for (const r of cs.results as any[]) byClient.set(r.client_id, [...(byClient.get(r.client_id) || []), consentOf(r)]);
  return (cl.results as any[]).map((r) => ({
    id: r.id, name: r.name, phone: r.phone, isChild: !!r.is_child, parentName: r.parent_name, note: r.note,
    createdAt: r.created_at, archivedAt: r.archived_at, consents: byClient.get(r.id) || [],
  }));
}
const oneClient = async (c: C, id: string) => (await loadClients(c, id))[0];

api.get('/clients', async (c) => c.json(await loadClients(c)));
api.get('/clients/:id', async (c) => {
  const cl = await oneClient(c, c.req.param('id'));
  return cl ? c.json(cl) : c.json({ error: 'not_found' }, 404);
});

/** Новый клиент сразу с согласием на данные для занятий: без него клиента не добавить. */
api.post('/clients', async (c) => {
  const b = await body(c);
  const cl = parseClient(b.client);
  const consents = (Array.isArray(b.consents) ? b.consents : []).map(parseConsent);
  if (!consents.some((x: { kind: string }) => x.kind === 'training')) throw new Invalid('Нужно согласие клиента на данные для занятий');
  consents.sort((a: { kind: string }, z: { kind: string }) => (a.kind === 'training' ? -1 : z.kind === 'training' ? 1 : 0));
  const id = crypto.randomUUID(), coach = c.get('coachId'), db = c.env.DB;
  await db.batch([
    db.prepare('INSERT INTO clients (id, coach_id, name, phone, is_child, parent_name, note) VALUES (?, ?, ?, ?, ?, ?, ?)')
      .bind(id, coach, cl.name, cl.phone, cl.isChild ? 1 : 0, cl.parentName, cl.note),
    ...consents.map((x: ReturnType<typeof parseConsent>) => db.prepare(
      'INSERT INTO client_consents (id, coach_id, client_id, kind, method, signed_by, signer_name, text_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
    ).bind(crypto.randomUUID(), coach, id, x.kind, x.method, cl.isChild ? 'parent' : 'self', x.signerName, CLIENT_CONSENT_VERSION)),
  ]);
  return c.json(await oneClient(c, id), 201);
});

api.put('/clients/:id', async (c) => {
  const cl = parseClient(await body(c));
  const r = await c.env.DB.prepare('UPDATE clients SET name = ?, phone = ?, is_child = ?, parent_name = ?, note = ? WHERE id = ? AND coach_id = ?')
    .bind(cl.name, cl.phone, cl.isChild ? 1 : 0, cl.parentName, cl.note, c.req.param('id'), c.get('coachId')).run();
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json(await oneClient(c, c.req.param('id')));
});

api.post('/clients/:id/archive', async (c) => {
  const r = await c.env.DB.prepare('UPDATE clients SET archived_at = ? WHERE id = ? AND coach_id = ? AND archived_at IS NULL')
    .bind(now(), c.req.param('id'), c.get('coachId')).run();
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json(await oneClient(c, c.req.param('id')));
});
api.post('/clients/:id/restore', async (c) => {
  const r = await c.env.DB.prepare('UPDATE clients SET archived_at = NULL WHERE id = ? AND coach_id = ? AND archived_at IS NOT NULL')
    .bind(c.req.param('id'), c.get('coachId')).run();
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json(await oneClient(c, c.req.param('id')));
});

/** Удалить навсегда можно только из архива: вместе с согласиями, отметками, оплатами и фото чеков. */
api.delete('/clients/:id', async (c) => {
  const id = c.req.param('id'), coach = c.get('coachId'), db = c.env.DB;
  const row = await db.prepare('SELECT archived_at FROM clients WHERE id = ? AND coach_id = ?').bind(id, coach).first<{ archived_at: string | null }>();
  if (!row) return c.json({ error: 'not_found' }, 404);
  if (!row.archived_at) return c.json({ error: 'not_archived', message: 'Сначала уберите клиента в архив' }, 409);
  const { results } = await db.prepare('SELECT receipt_key FROM payments WHERE client_id = ? AND coach_id = ? AND receipt_key IS NOT NULL').bind(id, coach).all<{ receipt_key: string }>();
  const keys = results.map((r) => r.receipt_key).filter((k) => k.startsWith(`${coach}/`)); // только свою папку
  if (keys.length) await c.env.RECEIPTS.delete(keys);
  await db.prepare('DELETE FROM clients WHERE id = ? AND coach_id = ?').bind(id, coach).run();
  return c.json({ ok: true });
});

/* ---------- согласия клиента ---------- */

api.post('/clients/:id/consents', async (c) => {
  const x = parseConsent(await body(c)), id = c.req.param('id'), coach = c.get('coachId');
  const cl = await c.env.DB.prepare('SELECT is_child FROM clients WHERE id = ? AND coach_id = ?').bind(id, coach).first<{ is_child: number }>();
  if (!cl) return c.json({ error: 'not_found' }, 404);
  await c.env.DB.prepare('INSERT INTO client_consents (id, coach_id, client_id, kind, method, signed_by, signer_name, text_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .bind(crypto.randomUUID(), coach, id, x.kind, x.method, cl.is_child ? 'parent' : 'self', x.signerName, CLIENT_CONSENT_VERSION).run();
  return c.json(await oneClient(c, id), 201);
});

/** Отзыв согласия: база сама удаляет замеры/навыки (training) или пульс и ощущения (health). */
api.post('/clients/:id/consents/:cid/revoke', async (c) => {
  const r = await c.env.DB.prepare('UPDATE client_consents SET revoked_at = ? WHERE id = ? AND client_id = ? AND coach_id = ? AND revoked_at IS NULL')
    .bind(now(), c.req.param('cid'), c.req.param('id'), c.get('coachId')).run();
  if (!r.meta.changes) return c.json({ error: 'not_found' }, 404);
  return c.json(await oneClient(c, c.req.param('id')));
});
