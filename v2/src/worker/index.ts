import { Hono } from 'hono';
import type { AppEnv } from './env';
import { auth } from './auth';
import { api } from './api';

const app = new Hono<AppEnv>();

app.route('/auth', auth);
app.route('/api', api);
app.all('/api/*', (c) => c.json({ error: 'not_found' }, 404));
app.get('/', (c) => c.redirect('/beta/'));
app.all('*', async (c) => {
  const res = await c.env.ASSETS.fetch(c.req.raw);
  if (res.status !== 404) return res;
  return new Response('Не найдено', { status: 404, headers: { 'cache-control': 'no-store', 'content-type': 'text/plain; charset=utf-8' } });
});

export default app;
