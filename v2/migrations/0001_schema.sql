-- «Дорожка 2.0»: схема базы на Cloudflare D1 (SQLite).
-- В D1 нет RLS, поэтому изоляция тренеров держится на двух вещах:
--   1) каждый запрос Worker'а фильтрует по coach_id из сессии (src/worker/db.ts);
--   2) составные внешние ключи (id, coach_id): строка тренера A не может сослаться на клиента тренера B.
-- Остатки абонементов и долги не хранятся, а считаются из занятий, отметок и оплат.
-- Даты — 'YYYY-MM-DD', время — 'HH:MM' по часовому поясу тренера, метки времени — ISO UTC.

CREATE TABLE coaches (
  id          TEXT PRIMARY KEY,
  google_sub  TEXT UNIQUE,
  email       TEXT NOT NULL,
  name        TEXT NOT NULL DEFAULT '',
  tz          TEXT NOT NULL DEFAULT 'Asia/Almaty',
  settings    TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(settings)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Подписка тренера на «Дорожку». Нет строки или tier = 'free' — бесплатный тариф до 10 клиентов.
CREATE TABLE subscriptions (
  coach_id    TEXT PRIMARY KEY REFERENCES coaches(id) ON DELETE CASCADE,
  tier        TEXT NOT NULL DEFAULT 'free' CHECK (tier IN ('free', 'beta', 'month', 'year')),
  paid_until  TEXT,
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- Сессии входа. В базе только SHA-256 токена: утечка таблицы не даёт войти.
CREATE TABLE auth_sessions (
  token_hash  TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at  TEXT NOT NULL,
  ua          TEXT
);
CREATE INDEX auth_sessions_coach ON auth_sessions(coach_id);

-- Согласие тренера с условиями и политикой. Дата ставится только базой.
CREATE TABLE coach_consents (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  version     TEXT NOT NULL,
  given_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX coach_consents_coach ON coach_consents(coach_id);

-- Программы и цены: вид занятия, длительность и цены пакетов («разовое», «8 занятий», «10 занятий»).
-- packs — [{"sessions": 8, "price": 40000}], цена может быть пустой (null). Новая цена действует для новых оплат:
-- оплата хранит свою сумму и число занятий.
CREATE TABLE programs (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  type        TEXT NOT NULL CHECK (type IN ('individual', 'baby', 'split', 'minigroup', 'group')),
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  dur         INTEGER NOT NULL CHECK (dur BETWEEN 5 AND 240),
  packs       TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(packs) AND json_type(packs) = 'array'),
  archived    INTEGER NOT NULL DEFAULT 0 CHECK (archived IN (0, 1)),
  UNIQUE (id, coach_id)
);
CREATE INDEX programs_coach ON programs(coach_id);

CREATE TABLE clients (
  id           TEXT PRIMARY KEY,
  coach_id     TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  phone        TEXT CHECK (phone IS NULL OR length(phone) <= 32),
  is_child     INTEGER NOT NULL DEFAULT 0 CHECK (is_child IN (0, 1)),
  parent_name  TEXT CHECK (parent_name IS NULL OR length(parent_name) <= 80),
  note         TEXT CHECK (note IS NULL OR length(note) <= 2000),
  created_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  archived_at  TEXT,
  UNIQUE (id, coach_id)
);
CREATE INDEX clients_coach ON clients(coach_id, archived_at);

-- Согласия клиента на обработку данных. Изменить нельзя, только отозвать.
--   training — данные для занятий (посещения, оплаты, замеры, навыки);
--   health   — пульс и самочувствие, отдельно.
-- За ребёнка подписывает родитель.
CREATE TABLE client_consents (
  id            TEXT PRIMARY KEY,
  coach_id      TEXT NOT NULL,
  client_id     TEXT NOT NULL,
  kind          TEXT NOT NULL CHECK (kind IN ('training', 'health')),
  method        TEXT NOT NULL CHECK (method IN ('form', 'written', 'link')),
  signed_by     TEXT NOT NULL CHECK (signed_by IN ('self', 'parent')),
  signer_name   TEXT NOT NULL CHECK (length(signer_name) BETWEEN 1 AND 80),
  text_version  TEXT NOT NULL,
  given_at      TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  revoked_at    TEXT,
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE
);
CREATE INDEX client_consents_client ON client_consents(coach_id, client_id);

CREATE TRIGGER client_consents_parent BEFORE INSERT ON client_consents
WHEN NEW.signed_by <> 'parent' AND (SELECT is_child FROM clients WHERE id = NEW.client_id) = 1
BEGIN SELECT RAISE(ABORT, 'consent_parent_required'); END;

CREATE TRIGGER client_consents_health_needs_training BEFORE INSERT ON client_consents
WHEN NEW.kind = 'health' AND NOT EXISTS (
  SELECT 1 FROM client_consents WHERE client_id = NEW.client_id AND kind = 'training' AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_training_required'); END;

CREATE TRIGGER client_consents_immutable BEFORE UPDATE ON client_consents
WHEN OLD.revoked_at IS NOT NULL OR NEW.revoked_at IS NULL
  OR NEW.kind IS NOT OLD.kind OR NEW.method IS NOT OLD.method OR NEW.signed_by IS NOT OLD.signed_by
  OR NEW.signer_name IS NOT OLD.signer_name OR NEW.text_version IS NOT OLD.text_version
  OR NEW.given_at IS NOT OLD.given_at OR NEW.client_id IS NOT OLD.client_id OR NEW.coach_id IS NOT OLD.coach_id
BEGIN SELECT RAISE(ABORT, 'consent_immutable'); END;

-- Бесплатный тариф: не больше 10 активных клиентов (и при добавлении, и при возврате из архива).
CREATE TRIGGER clients_free_limit BEFORE INSERT ON clients
WHEN NEW.archived_at IS NULL
  AND COALESCE((SELECT tier <> 'free' AND (paid_until IS NULL OR paid_until >= date('now'))
                FROM subscriptions WHERE coach_id = NEW.coach_id), 0) = 0
  AND (SELECT count(*) FROM clients WHERE coach_id = NEW.coach_id AND archived_at IS NULL) >= 10
BEGIN SELECT RAISE(ABORT, 'free_limit'); END;

CREATE TRIGGER clients_free_limit_restore BEFORE UPDATE OF archived_at ON clients
WHEN OLD.archived_at IS NOT NULL AND NEW.archived_at IS NULL
  AND COALESCE((SELECT tier <> 'free' AND (paid_until IS NULL OR paid_until >= date('now'))
                FROM subscriptions WHERE coach_id = NEW.coach_id), 0) = 0
  AND (SELECT count(*) FROM clients WHERE coach_id = NEW.coach_id AND archived_at IS NULL) >= 10
BEGIN SELECT RAISE(ABORT, 'free_limit'); END;

-- План занятий клиента по абонементу: какие дни и во сколько, сколько занятий всего.
CREATE TABLE client_plans (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  program_id  TEXT,
  starts_on   TEXT NOT NULL,
  total       INTEGER NOT NULL CHECK (total BETWEEN 1 AND 100),
  slots       TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(slots)), -- {"0": "18:00", "3": "18:00"}, 0 = понедельник
  place       TEXT NOT NULL DEFAULT '',
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%f', 'now')),
  UNIQUE (id, coach_id),
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE,
  FOREIGN KEY (program_id, coach_id) REFERENCES programs(id, coach_id)
);
CREATE INDEX client_plans_client ON client_plans(coach_id, client_id);

CREATE TABLE client_pauses (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  from_date   TEXT NOT NULL,
  to_date     TEXT NOT NULL CHECK (to_date >= from_date),
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE
);
CREATE INDEX client_pauses_client ON client_pauses(coach_id, client_id);

-- Группы, мини-группы и постоянные пары сплита. Сплит — это всегда пара.
CREATE TABLE client_groups (
  id           TEXT PRIMARY KEY,
  coach_id     TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  type         TEXT NOT NULL CHECK (type IN ('split', 'minigroup', 'group')),
  name         TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  slots        TEXT NOT NULL DEFAULT '{}' CHECK (json_valid(slots)),
  place        TEXT NOT NULL DEFAULT '',
  archived_at  TEXT,
  UNIQUE (id, coach_id)
);
CREATE INDEX client_groups_coach ON client_groups(coach_id);

CREATE TABLE group_members (
  group_id   TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  coach_id   TEXT NOT NULL,
  PRIMARY KEY (group_id, client_id),
  FOREIGN KEY (group_id, coach_id) REFERENCES client_groups(id, coach_id) ON DELETE CASCADE,
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE
);

-- Занятия. lane — дорожка бассейна (для вида «Дорожки»), ext_of — отработка за занятие, где все предупредили.
CREATE TABLE lessons (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  date        TEXT NOT NULL,
  start       TEXT NOT NULL,
  dur         INTEGER NOT NULL CHECK (dur BETWEEN 5 AND 240),
  type        TEXT NOT NULL CHECK (type IN ('individual', 'baby', 'split', 'minigroup', 'group')),
  kind        TEXT NOT NULL DEFAULT 'regular' CHECK (kind IN ('regular', 'trial', 'makeup')),
  group_id    TEXT,
  plan_id     TEXT,
  ext_of      TEXT,
  place       TEXT NOT NULL DEFAULT '',
  lane        TEXT,
  log         TEXT NOT NULL DEFAULT '',
  next_note   TEXT NOT NULL DEFAULT '',
  cancelled   INTEGER NOT NULL DEFAULT 0 CHECK (cancelled IN (0, 1)),
  UNIQUE (id, coach_id),
  FOREIGN KEY (group_id, coach_id) REFERENCES client_groups(id, coach_id),
  FOREIGN KEY (plan_id, coach_id) REFERENCES client_plans(id, coach_id),
  FOREIGN KEY (ext_of, coach_id) REFERENCES lessons(id, coach_id)
);
CREATE INDEX lessons_coach_date ON lessons(coach_id, date);

-- Отметки — сердце приложения: кто ожидается на занятии и что с ним (пусто — не отмечено).
CREATE TABLE attendance (
  lesson_id  TEXT NOT NULL,
  client_id  TEXT NOT NULL,
  coach_id   TEXT NOT NULL,
  mark       TEXT CHECK (mark IS NULL OR mark IN ('present', 'absent', 'excused')),
  reason     TEXT,
  marked_at  TEXT,
  PRIMARY KEY (lesson_id, client_id),
  FOREIGN KEY (lesson_id, coach_id) REFERENCES lessons(id, coach_id) ON DELETE CASCADE,
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE
);
CREATE INDEX attendance_client ON attendance(coach_id, client_id);

-- Оплаты. «Дорожка» денег не касается: тренер только отмечает, что оплата пришла.
-- until — срок старых абонементов (новые без срока). receipt_key — фото чека в R2, хранится год.
CREATE TABLE payments (
  id               TEXT PRIMARY KEY,
  coach_id         TEXT NOT NULL,
  client_id        TEXT NOT NULL,
  with_client_id   TEXT,
  program_id       TEXT,
  date             TEXT NOT NULL,
  amount           INTEGER NOT NULL CHECK (amount >= 0),
  sessions         INTEGER NOT NULL CHECK (sessions BETWEEN 1 AND 100),
  method           TEXT NOT NULL DEFAULT 'kaspi' CHECK (method IN ('kaspi', 'cash', 'card', 'other')),
  until            TEXT,
  receipt_key      TEXT,
  note             TEXT NOT NULL DEFAULT '',
  created_at       TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE,
  FOREIGN KEY (with_client_id, coach_id) REFERENCES clients(id, coach_id),
  FOREIGN KEY (program_id, coach_id) REFERENCES programs(id, coach_id)
);
CREATE INDEX payments_client ON payments(coach_id, client_id);
CREATE INDEX payments_date ON payments(coach_id, date);

-- Отпуск тренера: дни пропускаются в расписании.
CREATE TABLE vacations (
  id         TEXT PRIMARY KEY,
  coach_id   TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  from_date  TEXT NOT NULL,
  to_date    TEXT NOT NULL CHECK (to_date >= from_date)
);
CREATE INDEX vacations_coach ON vacations(coach_id);

-- Модуль метрик. Замер без согласия на данные для занятий запрещён, пульс и ощущения — только с согласием на здоровье.
CREATE TABLE measurements (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  lesson_id   TEXT,
  taken_at    TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  distance    INTEGER NOT NULL CHECK (distance BETWEEN 10 AND 10000),
  stroke      TEXT NOT NULL CHECK (stroke IN ('free', 'back', 'breast', 'fly', 'im')),
  time_ms     INTEGER NOT NULL CHECK (time_ms > 0),
  splits      TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(splits)),
  hr          INTEGER CHECK (hr IS NULL OR hr BETWEEN 30 AND 250),
  rpe         INTEGER CHECK (rpe IS NULL OR rpe BETWEEN 1 AND 10),
  note        TEXT NOT NULL DEFAULT '',
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE,
  FOREIGN KEY (lesson_id, coach_id) REFERENCES lessons(id, coach_id)
);
CREATE INDEX measurements_client ON measurements(coach_id, client_id);

CREATE TRIGGER measurements_need_consent BEFORE INSERT ON measurements
WHEN NOT EXISTS (SELECT 1 FROM client_consents WHERE client_id = NEW.client_id AND kind = 'training' AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_training_required'); END;

CREATE TRIGGER measurements_health_need_consent BEFORE INSERT ON measurements
WHEN (NEW.hr IS NOT NULL OR NEW.rpe IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM client_consents WHERE client_id = NEW.client_id AND kind = 'health' AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_health_required'); END;

CREATE TRIGGER measurements_health_need_consent_upd BEFORE UPDATE OF hr, rpe ON measurements
WHEN (NEW.hr IS NOT NULL OR NEW.rpe IS NOT NULL)
  AND NOT EXISTS (SELECT 1 FROM client_consents WHERE client_id = NEW.client_id AND kind = 'health' AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_health_required'); END;

CREATE TABLE skills (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  skill       TEXT NOT NULL CHECK (length(skill) BETWEEN 1 AND 80),
  done        INTEGER NOT NULL DEFAULT 0 CHECK (done IN (0, 1)),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  UNIQUE (client_id, skill),
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE
);

CREATE TRIGGER skills_need_consent BEFORE INSERT ON skills
WHEN NOT EXISTS (SELECT 1 FROM client_consents WHERE client_id = NEW.client_id AND kind = 'training' AND revoked_at IS NULL)
BEGIN SELECT RAISE(ABORT, 'consent_training_required'); END;

-- Отзыв согласия удаляет данные, на которые оно давалось.
CREATE TRIGGER client_consents_revoke AFTER UPDATE OF revoked_at ON client_consents
WHEN NEW.revoked_at IS NOT NULL
BEGIN
  UPDATE measurements SET hr = NULL, rpe = NULL WHERE client_id = NEW.client_id AND NEW.kind = 'health';
  DELETE FROM measurements WHERE client_id = NEW.client_id AND NEW.kind = 'training';
  DELETE FROM skills WHERE client_id = NEW.client_id AND NEW.kind = 'training';
  UPDATE client_consents SET revoked_at = NEW.revoked_at
    WHERE client_id = NEW.client_id AND kind = 'health' AND revoked_at IS NULL AND NEW.kind = 'training';
END;

CREATE TABLE plan_templates (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL REFERENCES coaches(id) ON DELETE CASCADE,
  name        TEXT NOT NULL CHECK (length(name) BETWEEN 1 AND 80),
  body        TEXT NOT NULL DEFAULT '[]' CHECK (json_valid(body)),
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);
CREATE INDEX plan_templates_coach ON plan_templates(coach_id);

-- Telegram подключается из настроек одноразовой ссылкой с кодом.
CREATE TABLE telegram_links (
  coach_id    TEXT PRIMARY KEY REFERENCES coaches(id) ON DELETE CASCADE,
  chat_id     INTEGER NOT NULL UNIQUE,
  linked_at   TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  blocked_at  TEXT
);

-- Доступ клиентов по приглашению (после беты).
CREATE TABLE client_invites (
  id          TEXT PRIMARY KEY,
  coach_id    TEXT NOT NULL,
  client_id   TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at  TEXT NOT NULL,
  used_at     TEXT,
  FOREIGN KEY (client_id, coach_id) REFERENCES clients(id, coach_id) ON DELETE CASCADE
);

-- Ссылки «занятие → группа / план / отработка», «оплата → второй клиент», «замер → занятие» необязательные.
-- ON DELETE SET NULL на составном ключе (id, coach_id) обнулил бы и coach_id, поэтому при удалении
-- родителя обнуляем только саму ссылку триггером.
CREATE TRIGGER lessons_unlink BEFORE DELETE ON lessons BEGIN
  UPDATE lessons SET ext_of = NULL WHERE ext_of = OLD.id;
  UPDATE measurements SET lesson_id = NULL WHERE lesson_id = OLD.id;
END;
CREATE TRIGGER client_groups_unlink BEFORE DELETE ON client_groups BEGIN
  UPDATE lessons SET group_id = NULL WHERE group_id = OLD.id;
END;
CREATE TRIGGER client_plans_unlink BEFORE DELETE ON client_plans BEGIN
  UPDATE lessons SET plan_id = NULL WHERE plan_id = OLD.id;
END;
CREATE TRIGGER clients_unlink BEFORE DELETE ON clients BEGIN
  UPDATE payments SET with_client_id = NULL WHERE with_client_id = OLD.id;
END;
