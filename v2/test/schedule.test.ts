// Этап 1 через API: абонемент → расписание, отметки с отработкой, паузы, отпуск, группы, сводка в «Клиентах».
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { TRAINING, readyCoach } from './helpers';

const addClient = async (c: Awaited<ReturnType<typeof readyCoach>>, name: string) =>
  (await c.json('POST', '/api/clients', { client: { name }, consents: [TRAINING] })).id as string;
const lessonsOf = async (c: Awaited<ReturnType<typeof readyCoach>>, from: string, to: string) =>
  (await c.json('GET', `/api/lessons?from=${from}&to=${to}`)).lessons as any[];

describe('абонемент → расписание', () => {
  it('ставит ровно n занятий по программе, отпуск пропускает', async () => {
    const c = await readyCoach('plan@example.test');
    const prog = await c.json('POST', '/api/programs', { type: 'baby', name: 'Грудничковое', dur: 30, packs: [] });
    const cid = await addClient(c, 'София');
    await c.json('POST', '/api/vacations', { from: '2030-01-09', to: '2030-01-09' });
    const r = await c.json('POST', `/api/clients/${cid}/plan`, { programId: prog.id, total: 4, startsOn: '2030-01-07', slots: { 0: '09:30', 2: '10:00' } });
    expect(r.created).toBe(4);
    const ls = await lessonsOf(c, '2030-01-01', '2030-02-28');
    // 7 (пн), 9 (ср) — отпуск, 14 (пн), 16 (ср), 21 (пн).
    expect(ls.map((l) => `${l.date} ${l.start} ${l.dur} ${l.type}`)).toEqual([
      '2030-01-07 09:30 30 baby', '2030-01-14 09:30 30 baby', '2030-01-16 10:00 30 baby', '2030-01-21 09:30 30 baby',
    ]);
    const [cl] = await c.json('GET', '/api/clients');
    expect(cl.summary.plan.total).toBe(4);
    expect(cl.summary.next).toMatchObject({ date: '2030-01-07', start: '09:30' });
  });
  it('новый абонемент заменяет запланированные неотмеченные занятия', async () => {
    const c = await readyCoach('replan@example.test');
    const cid = await addClient(c, 'Олжас');
    const ask = { type: 'individual', total: 3, startsOn: '2030-02-04', slots: { 0: '18:00' } };
    await c.json('POST', `/api/clients/${cid}/plan`, ask);
    const r = await c.json('POST', `/api/clients/${cid}/plan`, { ...ask, slots: { 1: '19:00' } });
    expect(r.removed).toBe(3);
    const ls = await lessonsOf(c, '2030-02-01', '2030-03-31');
    expect(ls.map((l) => `${l.date} ${l.start}`)).toEqual(['2030-02-05 19:00', '2030-02-12 19:00', '2030-02-19 19:00']);
  });
  it('подбор времени обходит занятые часы', async () => {
    const c = await readyCoach('suggest@example.test');
    const a = await addClient(c, 'Занятый'), b = await addClient(c, 'Новый');
    await c.json('PUT', '/api/settings', { week: [{ from: '09:00', to: '11:00' }, null, null, null, null, null, null] });
    await c.json('POST', `/api/clients/${a}/plan`, { type: 'individual', total: 2, startsOn: '2030-03-04', slots: { 0: '09:00' } });
    const sets = await c.json('POST', '/api/plan/suggest', { clientId: b, type: 'individual', total: 2, perWeek: 1, startsOn: '2030-03-04', slots: { 0: '09:00' } });
    // 09:00–09:45 занято, перерыв 15 мин: первое свободное начало — 10:00, последнее, что влезает до 11:00, — 10:15.
    expect(sets).toEqual([{ 0: '10:00' }]);
  });
});

describe('отметки', () => {
  it('все предупредили → отработка; снятие отметки её убирает', async () => {
    const c = await readyCoach('marks@example.test');
    const cid = await addClient(c, 'Аружан');
    await c.json('POST', `/api/clients/${cid}/plan`, { type: 'individual', total: 2, startsOn: '2030-04-01', slots: { 0: '18:00' } });
    const [first] = await lessonsOf(c, '2030-04-01', '2030-04-01');
    const r = await c.json('PUT', `/api/lessons/${first.id}/marks/${cid}`, { mark: 'excused', reason: 'болеет' });
    expect(r.makeup).toMatchObject({ date: '2030-04-15', start: '18:00', kind: 'makeup', extOf: first.id });
    expect(r.lesson.reasons[cid]).toBe('болеет');
    expect(await lessonsOf(c, '2030-04-01', '2030-04-30')).toHaveLength(3);
    const off = await c.json('PUT', `/api/lessons/${first.id}/marks/${cid}`, { mark: null });
    expect(off.removed).toEqual([r.makeup.id]);
    expect(await lessonsOf(c, '2030-04-01', '2030-04-30')).toHaveLength(2);
  });
  it('отмеченные занятия видны в сводке; долг без оплат', async () => {
    const c = await readyCoach('sum@example.test');
    const cid = await addClient(c, 'Тимур');
    const [l] = await c.json('POST', '/api/lessons', { date: '2020-01-06', start: '10:00', type: 'individual', clientIds: [cid] });
    await c.json('PUT', `/api/lessons/${l.id}/marks/${cid}`, { mark: 'present' });
    const [cl] = await c.json('GET', '/api/clients');
    expect(cl.summary.last).toEqual(['present']);
    expect(cl.summary.remaining).toBe(-1);
  });
  it('неверная отметка и клиент не с этого занятия отклоняются', async () => {
    const c = await readyCoach('badmark@example.test');
    const a = await addClient(c, 'А'), b = await addClient(c, 'Б');
    const [l] = await c.json('POST', '/api/lessons', { date: '2030-05-06', start: '10:00', type: 'individual', clientIds: [a] });
    expect((await c.call('PUT', `/api/lessons/${l.id}/marks/${a}`, { mark: 'maybe' })).status).toBe(400);
    expect((await c.call('PUT', `/api/lessons/${l.id}/marks/${b}`, { mark: 'present' })).status).toBe(400);
  });
});

describe('занятия, группы, паузы', () => {
  it('перенос, отмена, удаление занятия', async () => {
    const c = await readyCoach('move@example.test');
    const cid = await addClient(c, 'Карина');
    const [l] = await c.json('POST', '/api/lessons', { date: '2030-06-03', start: '16:00', type: 'individual', kind: 'trial', clientIds: [cid], lane: '1' });
    expect(l).toMatchObject({ kind: 'trial', lane: '1', dur: 45 });
    const moved = await c.json('PUT', `/api/lessons/${l.id}`, { date: '2030-06-04', start: '17:00', nextNote: 'кроль на спине' });
    expect(moved).toMatchObject({ date: '2030-06-04', start: '17:00', nextNote: 'кроль на спине' });
    expect((await c.json('PUT', `/api/lessons/${l.id}`, { cancelled: true })).cancelled).toBe(true);
    expect((await c.call('DELETE', `/api/lessons/${l.id}`)).status).toBe(200);
    expect(await lessonsOf(c, '2030-06-01', '2030-06-30')).toEqual([]);
  });
  it('удаление занятия с отработкой не ломает отработку', async () => {
    const c = await readyCoach('delext@example.test');
    const cid = await addClient(c, 'Миша');
    await c.json('POST', `/api/clients/${cid}/plan`, { type: 'individual', total: 1, startsOn: '2030-06-03', slots: { 0: '10:00' } });
    const [l] = await lessonsOf(c, '2030-06-03', '2030-06-03');
    const { makeup } = await c.json('PUT', `/api/lessons/${l.id}/marks/${cid}`, { mark: 'excused' });
    expect((await c.call('DELETE', `/api/lessons/${l.id}`)).status).toBe(200);
    const left = await lessonsOf(c, '2030-06-01', '2030-07-31');
    expect(left.map((x) => [x.id, x.extOf])).toEqual([[makeup.id, null]]);
  });
  it('группа: занятия на всех участников, новый состав в будущих занятиях', async () => {
    const c = await readyCoach('group@example.test');
    const a = await addClient(c, 'Миша'), b = await addClient(c, 'Даня');
    const g = await c.json('POST', '/api/groups', { name: 'Дельфины', type: 'group', memberIds: [a, b] });
    const ls = await c.json('POST', '/api/lessons', { date: '2030-07-01', start: '18:00', type: 'group', groupId: g.id, repeat: { n: 2, days: [2] } });
    expect(ls.map((l: any) => [l.date, l.clientIds.length])).toEqual([['2030-07-01', 2], ['2030-07-03', 2]]);
    await c.json('PUT', `/api/groups/${g.id}`, { name: 'Дельфины', type: 'group', memberIds: [a] });
    expect((await lessonsOf(c, '2030-07-01', '2030-07-31')).every((l) => l.clientIds.length === 1)).toBe(true);
    expect((await c.call('POST', '/api/groups', { name: 'Пустая', type: 'group', memberIds: [] })).status).toBe(400);
  });
  it('пауза: занятия на паузе не ждут клиента', async () => {
    const c = await readyCoach('pause@example.test');
    const cid = await addClient(c, 'Ева');
    await c.json('POST', `/api/clients/${cid}/plan`, { type: 'individual', total: 3, startsOn: '2030-08-05', slots: { 0: '10:00' } });
    await c.json('POST', `/api/clients/${cid}/pauses`, { from: '2030-08-05', to: '2030-08-12' });
    const [cl] = await c.json('GET', '/api/clients');
    expect(cl.summary.next).toMatchObject({ date: '2030-08-19' });
    expect((await c.call('POST', `/api/clients/${cid}/pauses`, { from: '2030-08-12', to: '2030-08-05' })).status).toBe(400);
  });
});

describe('схема: необязательные ссылки', () => {
  it('удаление клиента с планом и группы не ломает занятия', async () => {
    const c = await readyCoach('unlink@example.test');
    const a = await addClient(c, 'А'), b = await addClient(c, 'Б');
    await c.json('POST', `/api/clients/${a}/plan`, { type: 'split', total: 1, startsOn: '2030-09-02', slots: { 0: '10:00' } });
    const [l] = await lessonsOf(c, '2030-09-02', '2030-09-02');
    // Второй клиент сплита в том же занятии.
    await env.DB.prepare('INSERT INTO attendance (lesson_id, client_id, coach_id) SELECT ?, ?, coach_id FROM lessons WHERE id = ?').bind(l.id, b, l.id).run();
    await c.call('POST', `/api/clients/${a}/archive`);
    expect((await c.call('DELETE', `/api/clients/${a}`)).status).toBe(200);
    const [after] = await lessonsOf(c, '2030-09-02', '2030-09-02');
    expect(after).toMatchObject({ planId: null, clientIds: [b] });
  });
});
