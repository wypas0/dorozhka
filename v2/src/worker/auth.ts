// Вход через Google (OAuth 2.0 code + PKCE) и сессии в защищённой cookie.
// Токен сессии — 32 случайных байта; в базе лежит только его SHA-256.
import { Hono, type MiddlewareHandler } from 'hono';
import { getCookie, setCookie, deleteCookie } from 'hono/cookie';
import type { AppEnv, Env } from './env';

export const SESSION_COOKIE = '__Host-dz';
const OAUTH_COOKIE = '__Host-dz-oauth';
const SESSION_DAYS = 30;

const b64url = (bytes: Uint8Array) => btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const randomToken = (n = 32) => b64url(crypto.getRandomValues(new Uint8Array(n)));
export async function sha256(s: string) {
  const d = new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s)));
  return [...d].map((b) => b.toString(16).padStart(2, '0')).join('');
}
const sha256url = async (s: string) => b64url(new Uint8Array(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(s))));

const cookieOpts = { path: '/', secure: true, httpOnly: true, sameSite: 'Lax' as const };

/** Находит или создаёт тренера по аккаунту Google и открывает сессию. */
async function signIn(c: { env: Env; req: { header(n: string): string | undefined } }, g: { sub: string; email: string; name: string }) {
  const db = c.env.DB;
  let row = await db.prepare('SELECT id FROM coaches WHERE google_sub = ?').bind(g.sub).first<{ id: string }>();
  if (!row) {
    const id = crypto.randomUUID();
    await db.prepare('INSERT INTO coaches (id, google_sub, email, name) VALUES (?, ?, ?, ?)').bind(id, g.sub, g.email, g.name).run();
    row = { id };
  } else {
    await db.prepare('UPDATE coaches SET email = ?, name = CASE WHEN name = \'\' THEN ? ELSE name END WHERE id = ?').bind(g.email, g.name, row.id).run();
  }
  const token = randomToken();
  const expires = new Date(Date.now() + SESSION_DAYS * 864e5);
  await db.batch([
    db.prepare('DELETE FROM auth_sessions WHERE coach_id = ? AND expires_at < ?').bind(row.id, new Date().toISOString()),
    db.prepare('INSERT INTO auth_sessions (token_hash, coach_id, expires_at, ua) VALUES (?, ?, ?, ?)')
      .bind(await sha256(token), row.id, expires.toISOString(), (c.req.header('user-agent') || '').slice(0, 300)),
  ]);
  return { token, expires };
}

export const auth = new Hono<AppEnv>();

auth.get('/google', async (c) => {
  if (!c.env.GOOGLE_CLIENT_ID) return c.text('Вход через Google ещё не настроен: нет GOOGLE_CLIENT_ID.', 503);
  const state = randomToken(16), verifier = randomToken(48);
  setCookie(c, OAUTH_COOKIE, `${state}.${verifier}`, { ...cookieOpts, maxAge: 600 });
  const origin = new URL(c.req.url).origin;
  const q = new URLSearchParams({
    client_id: c.env.GOOGLE_CLIENT_ID,
    redirect_uri: `${origin}/auth/google/callback`,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    code_challenge: await sha256url(verifier),
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return c.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${q}`);
});

auth.get('/google/callback', async (c) => {
  const [state, verifier] = (getCookie(c, OAUTH_COOKIE) || '').split('.');
  deleteCookie(c, OAUTH_COOKIE, cookieOpts);
  const back = (err: string) => c.redirect(`/beta/#/login?error=${err}`);
  if (!state || state !== c.req.query('state') || !c.req.query('code')) return back('state');
  const origin = new URL(c.req.url).origin;
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code: c.req.query('code')!, client_id: c.env.GOOGLE_CLIENT_ID, client_secret: c.env.GOOGLE_CLIENT_SECRET || '',
      redirect_uri: `${origin}/auth/google/callback`, grant_type: 'authorization_code', code_verifier: verifier,
    }),
  });
  if (!res.ok) return back('google');
  const { id_token } = await res.json<{ id_token?: string }>();
  // id_token пришёл напрямую от Google по TLS в ответ на наш запрос с секретом — подпись можно не проверять
  // (OpenID Connect Core 3.1.3.7), но поля проверяем.
  let p: any;
  try { p = JSON.parse(atob(String(id_token).split('.')[1].replace(/-/g, '+').replace(/_/g, '/'))); } catch { return back('google'); }
  const issOk = p.iss === 'https://accounts.google.com' || p.iss === 'accounts.google.com';
  if (!issOk || p.aud !== c.env.GOOGLE_CLIENT_ID || !p.sub || !p.email || p.email_verified !== true || p.exp * 1000 < Date.now()) return back('google');
  const { token, expires } = await signIn(c, { sub: `google:${p.sub}`, email: p.email, name: String(p.name || '').slice(0, 80) });
  setCookie(c, SESSION_COOKIE, token, { ...cookieOpts, expires });
  return c.redirect('/beta/');
});

/** Только для локальной разработки и тестов: вход без Google. Включается DEV_LOGIN=1. */
auth.post('/dev', async (c) => {
  if (c.env.DEV_LOGIN !== '1') return c.notFound();
  const b = await c.req.json<{ email?: string; name?: string }>().catch(() => ({} as { email?: string; name?: string }));
  const email = String(b.email || 'coach@example.test').slice(0, 120);
  const { token, expires } = await signIn(c, { sub: `dev:${email}`, email, name: String(b.name || 'Тестовый тренер').slice(0, 80) });
  setCookie(c, SESSION_COOKIE, token, { ...cookieOpts, expires });
  return c.json({ ok: true });
});

auth.post('/logout', async (c) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) await c.env.DB.prepare('DELETE FROM auth_sessions WHERE token_hash = ?').bind(await sha256(token)).run();
  deleteCookie(c, SESSION_COOKIE, cookieOpts);
  return c.json({ ok: true });
});

/** Кто вошёл: coach_id берётся только из сессии, никогда из запроса. */
export const requireCoach: MiddlewareHandler<AppEnv> = async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (!token) return c.json({ error: 'unauthorized' }, 401);
  const row = await c.env.DB.prepare('SELECT coach_id FROM auth_sessions WHERE token_hash = ? AND expires_at > ?')
    .bind(await sha256(token), new Date().toISOString()).first<{ coach_id: string }>();
  if (!row) return c.json({ error: 'unauthorized' }, 401);
  c.set('coachId', row.coach_id);
  await next();
};

/**
 * Защита от CSRF поверх SameSite=Lax: запрос, меняющий данные, должен прийти с нашего же сайта.
 * Браузеры всегда ставят Origin на POST/PUT/DELETE из fetch.
 */
export const sameOrigin: MiddlewareHandler<AppEnv> = async (c, next) => {
  if (!['GET', 'HEAD', 'OPTIONS'].includes(c.req.method)) {
    const origin = c.req.header('origin');
    if (!origin || origin !== new URL(c.req.url).origin) return c.json({ error: 'bad_origin' }, 403);
  }
  await next();
};
