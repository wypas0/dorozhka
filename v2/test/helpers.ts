import { SELF } from 'cloudflare:test';

export const ORIGIN = 'https://dorozhka.test';

/** Тренер, вошедший через /auth/dev: fetch с его cookie и нашим Origin. */
export async function coach(email: string) {
  const r = await SELF.fetch(`${ORIGIN}/auth/dev`, {
    method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify({ email }),
  });
  const cookie = (r.headers.get('set-cookie') || '').split(';')[0];
  if (!cookie.startsWith('__Host-dz=')) throw new Error('нет cookie сессии');
  const call = (method: string, path: string, body?: unknown) => SELF.fetch(`${ORIGIN}${path}`, {
    method, headers: { cookie, origin: ORIGIN, 'content-type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { cookie, call, json: async (method: string, path: string, body?: unknown) => (await call(method, path, body)).json<any>() };
}
export type Coach = Awaited<ReturnType<typeof coach>>;

export const CONSENT = { version: '2026-10-28', agree: true };
export const TRAINING = { kind: 'training', method: 'form', signerName: 'Айгерим Б.' };
export const HEALTH = { kind: 'health', method: 'form', signerName: 'Айгерим Б.' };

export async function readyCoach(email: string) {
  const c = await coach(email);
  await c.call('POST', '/api/consent', CONSENT);
  return c;
}
