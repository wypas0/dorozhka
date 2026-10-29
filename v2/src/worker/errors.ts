import type { Context } from 'hono';
import { FREE_LIMIT, Invalid } from '../shared/types';
import { RuleError } from '../shared/rules';

export function onApiError(err: Error, c: Context) {
  if (err instanceof Invalid || err instanceof RuleError) return c.json({ error: 'invalid', message: err.message }, 400);
  const m = String(err?.message || '');
  if (m.includes('free_limit')) return c.json({ error: 'free_limit', message: `На бесплатном тарифе до ${FREE_LIMIT} клиентов` }, 409);
  const consent = m.match(/consent_[a-z_]+/)?.[0];
  if (consent) return c.json({ error: consent }, 400);
  if (m.includes('FOREIGN KEY')) return c.json({ error: 'invalid', message: 'Ссылка на несуществующую запись' }, 400);
  console.error('api', err);
  return c.json({ error: 'server' }, 500);
}

export const body = async (c: Context) => c.req.json().catch(() => { throw new Invalid('Тело запроса — не JSON'); });
