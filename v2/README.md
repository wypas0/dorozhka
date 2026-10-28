# «Дорожка 2.0» — каркас на Cloudflare

Новое приложение тренера на `dorozhka.app/beta`. Старая «Дорожка» (`dorozhka.html`, Supabase) не трогается и служит шаблоном правил учёта.

## Стек

| Слой | Что | Почему |
|---|---|---|
| API | Cloudflare Worker + [Hono](https://hono.dev) 4 | один Worker отдаёт и API, и сайт; Hono — маленький роутер под Workers |
| База | Cloudflare D1 (SQLite) | 16+ таблиц вместо одного JSON `S`; правила согласий и лимит тарифа — триггерами в самой базе |
| Файлы | Cloudflare R2 | фото чеков, папка `<coach_id>/`, хранятся год |
| Сайт | Workers Static Assets (`dist/beta`) | Cloudflare советует Workers вместо Pages для новых проектов; один деплой вместо двух |
| Вход | свой Google OAuth (code + PKCE), сессия в cookie `__Host-dz` | без Supabase Auth; в базе только SHA-256 токена |
| Фронт | Vite 8 + Preact 11 + Signals, TypeScript | 3 КБ вместо React, компоненты вместо 1500 строк в одном файле; типы общие с Worker'ом (`src/shared`) |
| Дизайн | токены Stroke + решения холста «Дорожка × Stroke» | шрифты Literata / Geologica / JetBrains Mono локально (без Google Fonts — строгий CSP и меньше передачи данных) |
| Тесты | Vitest 4 + `@cloudflare/vitest-pool-workers` | тесты идут в настоящем рантайме Workers с локальной D1 |

## Изоляция тренеров

В D1 нет RLS, поэтому:

1. `coach_id` берётся только из сессии (`requireCoach`), каждый запрос фильтрует по нему; чужое — всегда 404.
2. Составные внешние ключи `(id, coach_id)`: строка тренера A физически не может сослаться на клиента тренера B.
3. `test/isolation.test.ts` пробует каждый адрес API с id чужого тренера и сам проверяет, что ни один маршрут не забыт.

Защита от CSRF: cookie `SameSite=Lax` + проверка `Origin` на всех запросах, меняющих данные. Строгий CSP для `/beta` (`dist/_headers`).

## Что есть в каркасе

- Вход через Google, выход; локально — кнопка «тестовый тренер» (`DEV_LOGIN=1`).
- Согласие тренера (версия текста, дата ставится сервером) → «Первый вход» за 5 шагов: бассейн и дорожки, программы, клиенты, рабочая неделя, готово.
- Сегодня (лента дня), Журнал (неделя с рабочими часами, легенда отметок), Клиенты, Оплаты, Настройки; на телефоне 4 вкладки снизу, на компьютере меню слева.
- Клиенты: добавление только с согласием на данные для занятий (за ребёнка — родитель), отдельное согласие на пульс и самочувствие, отзыв (данные удаляются базой), архив, «3 из 10», удаление навсегда из архива.
- Программы и цены: вид занятия, длительность, цены «разовое / 8 / 10»; новая цена — только для новых оплат.
- Настройки сохраняются сами; «Ваши данные»: скачать JSON, отозвать согласие = удалить аккаунт (с фото в R2).
- Демо без сервера: `/beta/?demo`.

Расписание, отметки, оплаты, бот и отчёт — следующие этапы плана (1–4), схема для них уже есть (`migrations/0001_schema.sql`).

## Команды

```bash
cd v2
npm ci
cp .dev.vars.example .dev.vars        # ключи вписываете сами
npm run db:local                      # миграции в локальную D1
npm start                             # сборка + wrangler dev на http://localhost:8787/beta/
npm test                              # тесты в рантайме Workers
npm run check                         # проверка типов
```

## Выкладка (делает владелец или CTO руками)

Ничего отсюда в прод не выкладывается автоматически.

1. `npx wrangler d1 create dorozhka-v2` → вписать `database_id` в `wrangler.jsonc`.
2. `npx wrangler r2 bucket create dorozhka-receipts`.
3. Google Cloud → OAuth client: redirect `https://dorozhka.app/auth/google/callback`; `GOOGLE_CLIENT_ID` в `vars`, секрет — `npx wrangler secret put GOOGLE_CLIENT_SECRET`.
4. `npx wrangler d1 migrations apply DB --remote`.
5. `npm run build && npx wrangler deploy`.

`DEV_LOGIN` в проде не задавать.
