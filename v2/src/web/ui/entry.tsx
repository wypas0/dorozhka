// Вход, согласие тренера и «Первый вход» за 5 шагов (холст, раздел 3.3).
import { useState } from 'preact/hooks';
import {
  COACH_CONSENT_VERSION, DEFAULT_DUR, DEFAULT_PACKS, LESSON_TYPES, TYPE_LABEL, WEEKDAYS, type Hours, type LessonType,
} from '../../shared/types';
import { api, clients, coach, programs, run } from '../state';
import { Mark, PaintedMark, Water } from './brand';
import { AddClientSheet } from './clients';

const LOGIN_ERR: Record<string, string> = {
  state: 'Вход прервался. Попробуйте ещё раз.',
  google: 'Google не подтвердил вход. Попробуйте ещё раз или выберите другой аккаунт.',
};

export function Boot() {
  return (
    <div class="solo"><div class="solo-body" style="align-items:center;justify-content:center;min-height:100dvh">
      <PaintedMark size={96} />
      <p class="sub" role="status">Наполняем бассейн…</p>
    </div></div>
  );
}

export function Login() {
  const err = new URLSearchParams(location.hash.split('?')[1] || '').get('error');
  const local = ['localhost', '127.0.0.1'].includes(location.hostname);
  const dev = async () => { await fetch('/auth/dev', { method: 'POST', body: '{}' }); location.replace('/beta/'); };
  return (
    <div class="solo split">
      <Water tall rope />
      <div class="solo-body">
        <PaintedMark size={96} />
        <div>
          <p class="eyebrow">Журнал тренера по плаванию</p>
          <h1 class="display">Вечером ничего <em>не надо пересчитывать</em></h1>
        </div>
        <p class="sub" style="font-size:15px;line-height:22px">Расписание, отметки, абонементы и оплаты Kaspi в одном месте. Остатки и долги считаются сами, напоминания приходят вам в Telegram.</p>
        {err && <p class="err" role="alert">{LOGIN_ERR[err] || LOGIN_ERR.google}</p>}
        <a class="btn lg block" href="/auth/google">Войти через Google</a>
        <a class="btn tint block" href="/beta/?demo">Посмотреть демо</a>
        {local && <button class="btn ghost block" onClick={dev}>Войти как тестовый тренер (локально)</button>}
        <p class="sub">Бесплатно до 10 клиентов. Клиенты сервисом не пользуются и сообщений не получают.</p>
      </div>
    </div>
  );
}

export function Consent() {
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    const me = await run(() => api.consent());
    setBusy(false);
    if (me) coach.value = me;
  };
  return (
    <div class="solo">
      <header class="row" style="padding:20px 16px 0;max-width:520px;margin:0 auto;width:100%"><Mark size={30} /><b style="font-family:var(--font-display);font-weight:400;font-size:20px">Дорожка</b></header>
      <div class="solo-body">
        <div>
          <p class="eyebrow">Перед началом</p>
          <h1 class="h2" style="margin-top:6px">Ваши данные и данные клиентов</h1>
        </div>
        <div class="card stack" style="gap:12px">
          <p style="margin:0">«Дорожка» хранит то, что вы вносите: клиентов, расписание, отметки, оплаты и фото чеков (год после оплаты).</p>
          <p style="margin:0">Данные хранятся в облаке Cloudflare за пределами Казахстана. Мы не продаём их и не передаём третьим лицам, кроме хостинга.</p>
          <p style="margin:0">Замеры, пульс и самочувствие клиента — только с его письменного согласия (за ребёнка — родителя). Согласие вы отмечаете в карточке клиента.</p>
          <p style="margin:0">Вы можете в любой момент скачать все данные или удалить аккаунт в «Настройках».</p>
        </div>
        <label class="check">
          <input type="checkbox" checked={agree} onChange={(e) => setAgree((e.target as HTMLInputElement).checked)} />
          <span>Я принимаю <a href="./legal/soglasie.html" target="_blank">условия и согласие на обработку данных</a> и <a href="./legal/privacy.html" target="_blank">политику конфиденциальности</a> (версия {COACH_CONSENT_VERSION}).</span>
        </label>
        <button class="btn lg block" disabled={!agree || busy} onClick={submit}>Продолжить</button>
        <button class="btn ghost" onClick={() => api.logout().then(() => location.replace('/beta/'))}>Выйти</button>
      </div>
    </div>
  );
}

/* ---------- первый вход ---------- */

export function Onboarding() {
  const me = coach.value!;
  const [step, setStep] = useState(0);
  const [pool, setPool] = useState(me.settings.pool);
  const [types, setTypes] = useState<LessonType[]>(['individual', 'baby', 'group']);
  const [week, setWeek] = useState<Hours[]>(me.settings.week);
  const [breakMin, setBreak] = useState(me.settings.breakMin);
  const [adding, setAdding] = useState(false);

  const saveSettings = async (patch: object) => { const r = await run(() => api.saveSettings(patch)); if (r) coach.value = r; return !!r; };
  const next = async () => {
    if (step === 0 && !(await saveSettings({ pool }))) return;
    if (step === 1 && !programs.value.length) {
      for (const t of types) {
        const p = await run(() => api.addProgram({ type: t, name: TYPE_LABEL[t], dur: DEFAULT_DUR[t], packs: DEFAULT_PACKS() }));
        if (p) programs.value = [...programs.value, p];
      }
    }
    if (step === 3 && !(await saveSettings({ week, breakMin }))) return;
    setStep(step + 1);
  };
  const finish = () => saveSettings({ onboarded: true });
  const toggle = (t: LessonType) => setTypes(types.includes(t) ? types.filter((x) => x !== t) : [...types, t]);
  const setDay = (i: number, h: Hours) => setWeek(week.map((x, j) => (j === i ? h : x)));

  const STEPS = ['Бассейн', 'Программы', 'Клиенты', 'Неделя', 'Готово'];
  return (
    <div class="solo">
      <header style="padding:20px 16px 0;max-width:520px;margin:0 auto;width:100%" class="stack">
        <div class="row">
          <button class="btn ghost sm" disabled={step === 0} onClick={() => setStep(step - 1)} aria-label="Назад">‹</button>
          <div class="steps grow">{STEPS.map((_, i) => <i class={i <= step ? 'on' : ''} />)}</div>
          {step < 4 && <button class="btn ghost sm" onClick={() => setStep(step + 1)}>Пропустить</button>}
        </div>
        <p class="eyebrow">{step + 1} из 5 · {STEPS[step]}</p>
      </header>
      <div class="solo-body">
        {step === 0 && <>
          <h1 class="h2">Где вы тренируете?</h1>
          <p class="sub">Нарисуем ваш бассейн: в расписании занятия встанут по дорожкам.</p>
          <label class="field"><span>Бассейн</span>
            <input class="input" value={pool.name} placeholder="Алатау, малая чаша" maxLength={80} onInput={(e) => setPool({ ...pool, name: (e.target as HTMLInputElement).value })} /></label>
          <div class="row" style="justify-content:space-between">
            <span>Дорожек</span>
            <div class="stepper">
              <button aria-label="Меньше" onClick={() => setPool({ ...pool, lanes: Math.max(1, pool.lanes - 1) })}>−</button>
              <b>{pool.lanes}</b>
              <button aria-label="Больше" onClick={() => setPool({ ...pool, lanes: Math.min(12, pool.lanes + 1) })}>+</button>
            </div>
          </div>
          <div class="lanes" aria-hidden="true">{Array.from({ length: pool.lanes }, () => <i />)}</div>
        </>}

        {step === 1 && <>
          <h1 class="h2">Что вы ведёте и сколько стоит</h1>
          <p class="sub">Оставьте нужные. Цены можно вписать позже в «Настройки → Программы и цены».</p>
          {programs.value.length > 0
            ? <p class="tag info">Программы уже есть: {programs.value.length}</p>
            : <div class="card flat stack" style="padding:8px 20px;gap:0">
              {LESSON_TYPES.map((t) => (
                <label class="check" style="padding:14px 0;border-bottom:1px solid var(--fog);align-items:center">
                  <input type="checkbox" checked={types.includes(t)} onChange={() => toggle(t)} />
                  <i class="typebar" style={`background:var(--t-${t});height:20px;align-self:center`} />
                  <span class="grow">{TYPE_LABEL[t]}</span>
                  <span class="sub mono">{DEFAULT_DUR[t]} мин · — ₸</span>
                </label>))}
            </div>}
        </>}

        {step === 2 && <>
          <h1 class="h2">Кого вы тренируете?</h1>
          <p class="sub">Клиенты сервисом не пользуются и сообщений не получают. Это ваш личный список.</p>
          <button class="card row" style="border:0;cursor:pointer;text-align:left" onClick={() => setAdding(true)}>
            <span class="avatar">+</span><span class="grow"><b>Добавить по одному</b><br /><span class="sub">имя, телефон и согласие клиента</span></span><span>›</span>
          </button>
          {clients.value.length > 0 && <div class="card flat stack" style="gap:8px">
            <p class="eyebrow">Добавлено {clients.value.length}</p>
            {clients.value.map((c) => <div class="row"><span class="avatar">{initials(c.name)}</span><span>{c.name}</span></div>)}
          </div>}
          {adding && <AddClientSheet onClose={() => setAdding(false)} />}
        </>}

        {step === 3 && <>
          <h1 class="h2">Когда вы работаете?</h1>
          <p class="sub">Свободное время для новых занятий ищется только в этих часах.</p>
          <WeekEditor week={week} onChange={setDay} />
          <label class="field"><span>Перерыв между занятиями, мин</span>
            <input class="input mono" type="number" min={0} max={120} value={breakMin} onInput={(e) => setBreak(+(e.target as HTMLInputElement).value)} /></label>
        </>}

        {step === 4 && <>
          <PaintedMark size={96} />
          <h1 class="h2">Журнал готов</h1>
          <p class="sub">Бассейн, программы и рабочие часы на месте. Расписание клиентов появится, когда вы оформите им абонементы.</p>
          <div class="card row" style="opacity:.7">
            <span class="grow"><b>Подключить Telegram</b><br /><span class="sub">напоминания о занятиях и оплатах · скоро</span></span>
          </div>
          <button class="btn lg block" onClick={finish}>Открыть журнал</button>
        </>}

        {step < 4 && <button class="btn lg block" onClick={next}>Дальше</button>}
      </div>
    </div>
  );
}

export function WeekEditor({ week, onChange }: { week: Hours[]; onChange: (i: number, h: Hours) => void }) {
  return (
    <div class="card flat" style="padding:8px 20px">
      {week.map((h, i) => (
        <div class="week-row">
          <b>{WEEKDAYS[i]}</b>
          {h ? <div class="row" style="gap:6px">
            <input class="input mono" type="time" value={h.from} style="width:110px" aria-label={`${WEEKDAYS[i]}: с`} onInput={(e) => onChange(i, { ...h, from: (e.target as HTMLInputElement).value })} />
            <span>–</span>
            <input class="input mono" type="time" value={h.to} style="width:110px" aria-label={`${WEEKDAYS[i]}: до`} onInput={(e) => onChange(i, { ...h, to: (e.target as HTMLInputElement).value })} />
          </div> : <span class="sub">выходной</span>}
          <label class="check" style="align-items:center"><input type="checkbox" checked={!!h} onChange={() => onChange(i, h ? null : { from: '09:00', to: '20:00' })} /><span class="sub">работаю</span></label>
        </div>
      ))}
    </div>
  );
}

export const initials = (name: string) => name.split(/\s+/).filter(Boolean).slice(0, 2).map((w) => w[0]).join('').toUpperCase();
