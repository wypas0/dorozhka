import { SELF } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';
import { CONSENT, HEALTH, ORIGIN, TRAINING, coach, readyCoach } from './helpers';

describe('вход и сессии', () => {
  it('без сессии API отвечает 401', async () => {
    expect((await SELF.fetch(`${ORIGIN}/api/me`)).status).toBe(401);
  });
  it('запрос с чужого сайта отклоняется', async () => {
    const c = await readyCoach('csrf@example.test');
    const r = await SELF.fetch(`${ORIGIN}/api/programs`, {
      method: 'POST', headers: { cookie: c.cookie, origin: 'https://evil.example', 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'baby', name: 'x', dur: 30, packs: [] }),
    });
    expect(r.status).toBe(403);
    expect(await c.json('GET', '/api/programs')).toEqual([]);
  });
  it('после выхода сессия не работает', async () => {
    const c = await readyCoach('out@example.test');
    await c.call('POST', '/auth/logout');
    expect((await c.call('GET', '/api/me')).status).toBe(401);
  });
  it('cookie сессии: __Host-, HttpOnly, Secure, SameSite=Lax', async () => {
    const r = await SELF.fetch(`${ORIGIN}/auth/dev`, { method: 'POST', headers: { origin: ORIGIN }, body: '{}' });
    const sc = r.headers.get('set-cookie') || '';
    expect(sc).toMatch(/^__Host-dz=/);
    expect(sc).toMatch(/HttpOnly/i);
    expect(sc).toMatch(/Secure/i);
    expect(sc).toMatch(/SameSite=Lax/i);
  });
  it('Google: редирект с state и PKCE', async () => {
    const r = await SELF.fetch(`${ORIGIN}/auth/google`, { redirect: 'manual' });
    expect(r.status).toBe(302);
    const u = new URL(r.headers.get('location')!);
    expect(u.host).toBe('accounts.google.com');
    expect(u.searchParams.get('code_challenge_method')).toBe('S256');
    expect(u.searchParams.get('redirect_uri')).toBe(`${ORIGIN}/auth/google/callback`);
  });
  it('Google: callback без своего state не пускает', async () => {
    const r = await SELF.fetch(`${ORIGIN}/auth/google/callback?state=x&code=y`, { redirect: 'manual' });
    expect(r.headers.get('location')).toContain('error=state');
  });
});

describe('согласие тренера', () => {
  it('без согласия данные недоступны', async () => {
    const c = await coach('noconsent@example.test');
    expect((await c.call('GET', '/api/clients')).status).toBe(403);
    expect((await c.json('GET', '/api/me')).consent).toBeNull();
  });
  it('старая версия не принимается, дата ставится сервером', async () => {
    const c = await coach('consent@example.test');
    expect((await c.call('POST', '/api/consent', { version: '2020-01-01', agree: true })).status).toBe(400);
    const me = await c.json('POST', '/api/consent', { ...CONSENT, givenAt: '2000-01-01T00:00:00Z' });
    expect(me.consent.version).toBe(CONSENT.version);
    expect(me.consent.givenAt.slice(0, 4)).not.toBe('2000');
  });
});

describe('клиенты', () => {
  it('без согласия на данные для занятий клиента не добавить', async () => {
    const c = await readyCoach('cl1@example.test');
    expect((await c.call('POST', '/api/clients', { client: { name: 'Без согласия' }, consents: [] })).status).toBe(400);
    expect(await c.json('GET', '/api/clients')).toEqual([]);
  });
  it('за ребёнка подписывает родитель', async () => {
    const c = await readyCoach('cl2@example.test');
    const kid = await c.json('POST', '/api/clients', { client: { name: 'Алихан', isChild: true, parentName: 'Мама Алихана' }, consents: [TRAINING] });
    expect(kid.consents[0].signedBy).toBe('parent');
  });
  it('согласие на здоровье только вместе с согласием на занятия', async () => {
    const c = await readyCoach('cl3@example.test');
    expect((await c.call('POST', '/api/clients', { client: { name: 'X' }, consents: [HEALTH] })).status).toBe(400);
    expect(await c.json('GET', '/api/clients')).toEqual([]);
  });
  it('11-й клиент на бесплатном тарифе запрещён, архив не считается', async () => {
    const c = await readyCoach('limit@example.test');
    const ids: string[] = [];
    for (let i = 1; i <= 10; i++) ids.push((await c.json('POST', '/api/clients', { client: { name: `Клиент ${i}` }, consents: [TRAINING] })).id);
    const r = await c.call('POST', '/api/clients', { client: { name: 'Одиннадцатый' }, consents: [TRAINING] });
    expect(r.status).toBe(409);
    expect((await r.json<any>()).error).toBe('free_limit');
    await c.call('POST', `/api/clients/${ids[0]}/archive`);
    expect((await c.call('POST', '/api/clients', { client: { name: 'Одиннадцатый' }, consents: [TRAINING] })).status).toBe(201);
    expect((await c.call('POST', `/api/clients/${ids[0]}/restore`)).status).toBe(409);
    expect((await c.json('GET', '/api/me')).activeClients).toBe(10);
  });
  it('удалить навсегда можно только из архива', async () => {
    const c = await readyCoach('del@example.test');
    const x = await c.json('POST', '/api/clients', { client: { name: 'Удаляемый' }, consents: [TRAINING] });
    expect((await c.call('DELETE', `/api/clients/${x.id}`)).status).toBe(409);
    await c.call('POST', `/api/clients/${x.id}/archive`);
    expect((await c.call('DELETE', `/api/clients/${x.id}`)).status).toBe(200);
    expect(await c.json('GET', '/api/clients')).toEqual([]);
  });
  it('отзыв согласия на занятия отзывает и согласие на здоровье', async () => {
    const c = await readyCoach('revoke@example.test');
    const x = await c.json('POST', '/api/clients', { client: { name: 'Отзыв' }, consents: [TRAINING, HEALTH] });
    const tr = x.consents.find((k: any) => k.kind === 'training');
    const after = await c.json('POST', `/api/clients/${x.id}/consents/${tr.id}/revoke`);
    expect(after.consents.every((k: any) => k.revokedAt)).toBe(true);
    expect((await c.call('POST', `/api/clients/${x.id}/consents/${tr.id}/revoke`)).status).toBe(404);
  });
});

describe('программы и цены', () => {
  it('пакеты проверяются, пустая цена допустима', async () => {
    const c = await readyCoach('prog@example.test');
    const p = await c.json('POST', '/api/programs', { type: 'baby', name: 'Грудничковое', dur: 30, packs: [{ sessions: 8, price: 40000 }, { sessions: 1, price: null }] });
    expect(p.packs).toEqual([{ sessions: 1, price: null }, { sessions: 8, price: 40000 }]);
    expect((await c.call('POST', '/api/programs', { type: 'baby', name: 'x', dur: 30, packs: [{ sessions: 8, price: 1 }, { sessions: 8, price: 2 }] })).status).toBe(400);
    expect((await c.call('POST', '/api/programs', { type: 'yoga', name: 'x', dur: 30, packs: [] })).status).toBe(400);
    const upd = await c.json('PUT', `/api/programs/${p.id}`, { ...p, packs: [{ sessions: 8, price: 42000 }], archived: true });
    expect(upd.archived).toBe(true);
  });
});

describe('настройки и аккаунт', () => {
  it('настройки проверяются', async () => {
    const c = await readyCoach('set@example.test');
    const week = [null, null, null, null, null, null, null];
    expect((await c.call('PUT', '/api/settings', { week: [{ from: '21:00', to: '07:00' }, ...week.slice(1)] })).status).toBe(400);
    expect((await c.call('PUT', '/api/settings', { week: week.slice(1) })).status).toBe(400);
    const me = await c.json('PUT', '/api/settings', { breakMin: 10, pool: { name: 'Алатау', lanes: 6 }, chargeNoShow: false });
    expect(me.settings.breakMin).toBe(10);
    expect(me.settings.pool).toEqual({ name: 'Алатау', lanes: 6 });
    expect(me.settings.week[6]).toBeNull();
    expect(me.settings.chargeNoShow).toBe(false);
  });
  it('удаление аккаунта требует слово УДАЛИТЬ и стирает всё', async () => {
    const c = await readyCoach('bye@example.test');
    await c.call('POST', '/api/clients', { client: { name: 'Клиент' }, consents: [TRAINING] });
    expect((await c.call('DELETE', '/api/account', { confirm: 'да' })).status).toBe(400);
    expect((await c.call('DELETE', '/api/account', { confirm: 'УДАЛИТЬ' })).status).toBe(200);
    expect((await c.call('GET', '/api/me')).status).toBe(401);
  });
});
