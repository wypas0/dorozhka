// Главный тест этапа 0: тренер B ничего не может сделать с данными тренера A — ни прочитать, ни изменить, ни удалить.
// Список ниже обязан покрывать каждый адрес API: тест в конце сверяет его с маршрутами приложения.
import { describe, expect, it } from 'vitest';
import { api } from '../src/worker/api';
import { HEALTH, TRAINING, readyCoach } from './helpers';

describe('изоляция тренеров', async () => {
  const a = await readyCoach('a@example.test');
  const b = await readyCoach('b@example.test');
  const prog = await a.json('POST', '/api/programs', { type: 'individual', name: 'Индивидуальное', dur: 45, packs: [{ sessions: 8, price: 40000 }] });
  const cl = await a.json('POST', '/api/clients', { client: { name: 'Даня' }, consents: [TRAINING, HEALTH] });
  const archived = await a.json('POST', '/api/clients', { client: { name: 'Архивный' }, consents: [TRAINING] });
  await a.call('POST', `/api/clients/${archived.id}/archive`);
  const consentId = cl.consents[0].id;
  const [lesson] = await a.json('POST', '/api/lessons', { date: '2026-11-02', start: '10:00', type: 'individual', clientIds: [cl.id] });
  const pause = await a.json('POST', `/api/clients/${cl.id}/pauses`, { from: '2026-12-01', to: '2026-12-10' });
  const vac = await a.json('POST', '/api/vacations', { from: '2026-12-20', to: '2026-12-31' });
  const group = await a.json('POST', '/api/groups', { name: 'Дельфины', type: 'group', memberIds: [cl.id] });

  // [метод, шаблон маршрута, адрес с id тренера A, тело]
  const attacks: [string, string, string, unknown?][] = [
    ['GET', '/clients/:id', `/api/clients/${cl.id}`],
    ['PUT', '/clients/:id', `/api/clients/${cl.id}`, { name: 'Взлом' }],
    ['POST', '/clients/:id/archive', `/api/clients/${cl.id}/archive`],
    ['POST', '/clients/:id/restore', `/api/clients/${archived.id}/restore`],
    ['DELETE', '/clients/:id', `/api/clients/${archived.id}`],
    ['POST', '/clients/:id/consents', `/api/clients/${cl.id}/consents`, TRAINING],
    ['POST', '/clients/:id/consents/:cid/revoke', `/api/clients/${cl.id}/consents/${consentId}/revoke`],
    ['PUT', '/programs/:id', `/api/programs/${prog.id}`, { type: 'baby', name: 'Взлом', dur: 30, packs: [] }],
    ['PUT', '/lessons/:id', `/api/lessons/${lesson.id}`, { cancelled: true }],
    ['PUT', '/lessons/:id/marks/:clientId', `/api/lessons/${lesson.id}/marks/${cl.id}`, { mark: 'present' }],
    ['DELETE', '/lessons/:id', `/api/lessons/${lesson.id}`],
    ['POST', '/clients/:id/plan', `/api/clients/${cl.id}/plan`, { type: 'individual', total: 2, startsOn: '2026-11-03', slots: { 1: '12:00' } }],
    ['POST', '/clients/:id/pauses', `/api/clients/${cl.id}/pauses`, { from: '2026-11-01', to: '2026-11-02' }],
    ['DELETE', '/clients/:id/pauses/:pid', `/api/clients/${cl.id}/pauses/${pause.id}`],
    ['DELETE', '/vacations/:id', `/api/vacations/${vac.id}`],
    ['PUT', '/groups/:id', `/api/groups/${group.id}`, { name: 'Взлом', type: 'group', memberIds: [cl.id] }],
  ];
  // Адреса без id: у B они работают, но видят и меняют только его собственные данные.
  const own = ['GET /me', 'POST /consent', 'GET /export', 'DELETE /account', 'PUT /settings',
    'GET /programs', 'POST /programs', 'GET /clients', 'POST /clients',
    'GET /lessons', 'POST /lessons', 'POST /plan/suggest', 'GET /vacations', 'POST /vacations', 'GET /groups', 'POST /groups'];

  it('чужие id в теле запроса не проходят', async () => {
    expect((await b.call('POST', '/api/lessons', { date: '2026-11-02', start: '12:00', type: 'individual', clientIds: [cl.id] })).status).toBe(400);
    expect((await b.call('POST', '/api/lessons', { date: '2026-11-02', start: '12:00', type: 'group', groupId: group.id })).status).toBe(400);
    expect((await b.call('POST', '/api/groups', { name: 'x', type: 'group', memberIds: [cl.id] })).status).toBe(400);
    expect((await b.call('POST', '/api/plan/suggest', { clientId: cl.id, type: 'individual', total: 2, startsOn: '2026-11-03', slots: {} })).status).toBe(404);
    expect((await b.call('POST', '/api/plan/suggest', { programId: prog.id, total: 2, startsOn: '2026-11-03', slots: {} })).status).toBe(400);
  });

  it.each(attacks)('%s %s → 404 для чужого тренера', async (method, _route, path, body) => {
    const r = await b.call(method, path, body);
    expect(r.status).toBe(404);
  });

  it('списки и выгрузка B не содержат данных A', async () => {
    expect(await b.json('GET', '/api/clients')).toEqual([]);
    expect(await b.json('GET', '/api/programs')).toEqual([]);
    const exp = JSON.stringify(await b.json('GET', '/api/export'));
    expect(exp).not.toContain(cl.id);
    expect(exp).not.toContain(prog.id);
    expect(exp).not.toContain('Даня');
  });

  it('данные A не изменились после всех попыток', async () => {
    const list = await a.json('GET', '/api/clients');
    const dan = list.find((x: any) => x.id === cl.id);
    expect(dan.name).toBe('Даня');
    expect(dan.archivedAt).toBeNull();
    expect(dan.consents).toHaveLength(2);
    expect(dan.consents.every((x: any) => x.revokedAt === null)).toBe(true);
    expect(list.find((x: any) => x.id === archived.id)?.archivedAt).toBeTruthy();
    expect((await a.json('GET', '/api/programs'))[0].name).toBe('Индивидуальное');
    const { lessons } = await a.json('GET', '/api/lessons?from=2026-11-01&to=2026-11-30');
    const l = lessons.find((x: any) => x.id === lesson.id);
    expect(l).toMatchObject({ cancelled: false, att: {} });
    expect(lessons.filter((x: any) => x.clientIds.includes(cl.id))).toHaveLength(1);
    expect((await a.json('GET', '/api/vacations'))).toHaveLength(1);
    expect((await a.json('GET', '/api/groups'))[0].name).toBe('Дельфины');
    expect(list.find((x: any) => x.id === cl.id).pauses).toHaveLength(1);
    expect(await b.json('GET', '/api/lessons?from=2026-11-01&to=2026-11-30')).toMatchObject({ lessons: [] });
  });

  it('удаление аккаунта B не трогает A', async () => {
    expect((await b.call('DELETE', '/api/account', { confirm: 'УДАЛИТЬ' })).status).toBe(200);
    expect(await a.json('GET', '/api/clients')).toHaveLength(2);
  });

  it('тест покрывает каждый адрес API', () => {
    const routes = new Set(api.routes.filter((r) => r.method !== 'ALL').map((r) => `${r.method} ${r.path}`));
    const covered = new Set([...attacks.map(([m, route]) => `${m} ${route}`), ...own]);
    expect([...routes].filter((r) => !covered.has(r))).toEqual([]);
  });
});
