// Правила, которые держит сама база, даже если Worker ошибётся.
import { env } from 'cloudflare:test';
import { describe, expect, it } from 'vitest';

const db = () => env.DB;
async function seed(prefix: string) {
  const coach = `${prefix}-coach`, client = `${prefix}-client`;
  await db().batch([
    db().prepare('INSERT INTO coaches (id, email) VALUES (?, ?)').bind(coach, `${prefix}@x.test`),
    db().prepare('INSERT INTO clients (id, coach_id, name) VALUES (?, ?, ?)').bind(client, coach, 'Клиент'),
  ]);
  return { coach, client };
}
const consent = (id: string, coach: string, client: string, kind: string) => db().prepare(
  "INSERT INTO client_consents (id, coach_id, client_id, kind, method, signed_by, signer_name, text_version) VALUES (?, ?, ?, ?, 'form', 'self', 'Кто-то', 'v')",
).bind(id, coach, client, kind);
const measure = (id: string, coach: string, client: string, hr: number | null) => db().prepare(
  "INSERT INTO measurements (id, coach_id, client_id, distance, stroke, time_ms, hr) VALUES (?, ?, ?, 50, 'free', 40000, ?)",
).bind(id, coach, client, hr);

describe('схема D1', () => {
  it('строка тренера не может сослаться на клиента другого тренера', async () => {
    const a = await seed('fa'), b = await seed('fb');
    await expect(consent('fx', b.coach, a.client, 'training').run()).rejects.toThrow(/FOREIGN KEY/);
  });
  it('замер без согласия запрещён, пульс — только с согласием на здоровье', async () => {
    const s = await seed('m');
    await expect(measure('m1', s.coach, s.client, null).run()).rejects.toThrow(/consent_training_required/);
    await consent('mc1', s.coach, s.client, 'training').run();
    await measure('m2', s.coach, s.client, null).run();
    await expect(measure('m3', s.coach, s.client, 150).run()).rejects.toThrow(/consent_health_required/);
    await consent('mc2', s.coach, s.client, 'health').run();
    await measure('m4', s.coach, s.client, 150).run();
  });
  it('согласие нельзя изменить, только отозвать; отзыв удаляет данные', async () => {
    const s = await seed('r');
    await consent('rc1', s.coach, s.client, 'training').run();
    await consent('rc2', s.coach, s.client, 'health').run();
    await measure('rm', s.coach, s.client, 140).run();
    await expect(db().prepare("UPDATE client_consents SET signer_name = 'Другой' WHERE id = 'rc1'").run()).rejects.toThrow(/consent_immutable/);
    await db().prepare("UPDATE client_consents SET revoked_at = 'now' WHERE id = 'rc2'").run();
    expect((await db().prepare("SELECT hr FROM measurements WHERE id = 'rm'").first<any>()).hr).toBeNull();
    await expect(db().prepare("UPDATE client_consents SET revoked_at = NULL WHERE id = 'rc2'").run()).rejects.toThrow(/consent_immutable/);
    await db().prepare("UPDATE client_consents SET revoked_at = 'now' WHERE id = 'rc1'").run();
    expect(await db().prepare("SELECT 1 FROM measurements WHERE id = 'rm'").first()).toBeNull();
  });
  it('удаление тренера стирает все его данные', async () => {
    const s = await seed('d');
    await consent('dc', s.coach, s.client, 'training').run();
    await db().prepare('DELETE FROM coaches WHERE id = ?').bind(s.coach).run();
    expect(await db().prepare('SELECT 1 FROM clients WHERE coach_id = ?').bind(s.coach).first()).toBeNull();
    expect(await db().prepare('SELECT 1 FROM client_consents WHERE coach_id = ?').bind(s.coach).first()).toBeNull();
  });
});
