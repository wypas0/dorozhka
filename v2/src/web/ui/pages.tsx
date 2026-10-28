// Сегодня (лента дня), Журнал (вид времени), Оплаты, Настройки.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_DUR, DEFAULT_PACKS, LESSON_TYPES, TYPE_LABEL, WEEKDAYS, type Hours, type LessonType, type Pack, type Program, type Settings,
} from '../../shared/types';
import { api, coach, isDemo, programs, run } from '../state';
import { Water } from './brand';
import { WeekEditor } from './entry';

const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const greet = (h: number) => (h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер');
const firstName = () => (coach.value?.name || '').split(' ')[0];
const weekStart = (d = new Date()) => { const x = new Date(d); x.setHours(0, 0, 0, 0); x.setDate(x.getDate() - ((x.getDay() + 6) % 7)); return x; };

/* ---------- Сегодня: лента дня ---------- */

export function TodayPage() {
  const now = new Date(), ws = weekStart(now), name = firstName();
  return (
    <div class="stack" style="gap:20px">
      <div>
        <p class="eyebrow">{DAYS[now.getDay()]}, {now.getDate()} {MONTHS[now.getMonth()]}</p>
        <h1 class="display">{greet(now.getHours())}{name ? <>, <em>{name}</em></> : null}</h1>
      </div>
      <Water />
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;max-width:520px">
        {Array.from({ length: 7 }, (_, i) => {
          const d = new Date(ws); d.setDate(ws.getDate() + i);
          const today = d.toDateString() === now.toDateString();
          return <div class="card flat" style={`padding:8px 0;text-align:center;border-radius:14px;${today ? 'background:var(--prussian);color:#fff' : ''}`}>
            <div style="font-size:12px;opacity:.8">{today ? 'сег.' : WEEKDAYS[i]}</div><b class="mono">{d.getDate()}</b></div>;
        })}
      </div>
      <div class="row"><span class="tag">0 занятий</span><span class="tag">осталось 0</span></div>
      <div class="card stack" style="gap:8px;max-width:520px">
        <h2 class="h3">Сегодня занятий нет</h2>
        <p class="sub" style="margin:0">Когда клиенту оформлен абонемент («8 занятий, пн и чт 18:00»), занятия сами встанут в расписание. Здесь будет: что идёт сейчас, что дальше, отметка одним касанием.</p>
      </div>
    </div>
  );
}

/* ---------- Журнал: вид времени ---------- */

const MARKS: [string, string, string, string][] = [
  ['present', '✓', 'был', 'списано'], ['absent', 'Н', 'не предупредил', 'списано'], ['excused', 'П', 'предупредил', 'не списано'],
  ['trial', 'Пр', 'пробное', 'не списано'], ['pause', '', 'пауза, отпуск', 'не списано'], ['cancelled', '✕', 'отменено', 'не списано'],
  ['unmarked', '?', 'не отмечено', 'ждёт'], ['late', '…', 'опаздывает', 'ждём'], ['ahead', '', 'впереди', 'ещё не было'], ['moved', '→', 'перенесено', 'на другой день'],
];

export function JournalPage() {
  const [view, setView] = useState<'week' | 'lanes' | 'day'>('week');
  const s = coach.value!.settings, ws = weekStart();
  const open = s.week.filter(Boolean) as { from: string; to: string }[];
  const h0 = open.length ? Math.min(...open.map((h) => +h.from.slice(0, 2))) : 8;
  const h1 = open.length ? Math.max(...open.map((h) => Math.ceil(+h.to.slice(0, 2) + +h.to.slice(3) / 60))) : 20;
  const hours = Array.from({ length: Math.max(1, h1 - h0) }, (_, i) => h0 + i);
  const working = (d: Hours, h: number) => !!d && +d.from.slice(0, 2) <= h && h < +d.to.slice(0, 2) + (+d.to.slice(3) > 0 ? 1 : 0);
  return (
    <div class="stack" style="gap:20px">
      <div class="page-head" style="margin:0">
        <div><p class="eyebrow">Журнал · Время</p><h1 class="display">Неделя <em>{ws.getDate()}–{new Date(ws.getTime() + 6 * 864e5).getDate()} {MONTHS[new Date(ws.getTime() + 6 * 864e5).getMonth()]}</em></h1></div>
        <div class="seg" role="group" aria-label="Вид">
          <button aria-pressed={view === 'week'} onClick={() => setView('week')}>Неделя</button>
          <button aria-pressed={view === 'lanes'} onClick={() => setView('lanes')}>Дорожки</button>
          <button aria-pressed={view === 'day'} onClick={() => setView('day')}>День</button>
        </div>
      </div>
      {view === 'week' ? (
        <div class="table" style="overflow-x:auto">
          <div style={`display:grid;grid-template-columns:52px repeat(7,minmax(96px,1fr));min-width:740px`}>
            <span />
            {WEEKDAYS.map((w, i) => { const d = new Date(ws.getTime() + i * 864e5); return <div style="padding:12px 10px;border-bottom:1px solid var(--line);font-weight:600">{w} <span class="sub">{d.getDate()}</span><div class="sub" style="font-weight:400">{s.week[i] ? `${s.week[i]!.from}–${s.week[i]!.to}` : 'выходной'}</div></div>; })}
            {hours.map((h) => <>
              <span class="mono sub" style="padding:6px 8px;border-top:1px solid var(--fog)">{String(h).padStart(2, '0')}:00</span>
              {s.week.map((d) => <span style={`height:44px;border-top:1px solid var(--fog);border-left:1px solid var(--fog);${working(d, h) ? '' : 'background:repeating-linear-gradient(135deg,var(--gesso) 0 4px,var(--white) 4px 8px)'}`} />)}
            </>)}
          </div>
        </div>
      ) : (
        <div class="card stack" style="gap:8px">
          <h2 class="h3">{view === 'lanes' ? `Дорожки: ${s.pool.lanes}${s.pool.name ? ` · ${s.pool.name}` : ''}` : 'Лента дня'}</h2>
          <p class="sub" style="margin:0">{view === 'lanes' ? 'День по дорожкам бассейна и строка «вы, тренер».' : 'Сейчас, дальше и отметка касанием — то же, что на экране «Сегодня».'} Какой вид времени главный, решает владелец; занятия появятся на этапе 1.</p>
        </div>
      )}
      <div class="card">
        <p class="eyebrow" style="margin-bottom:14px">Отметки: буква + цвет. Закрашено = списано</p>
        <div class="legend">{MARKS.map(([k, ch, l, s2]) => <div><span class={`mark ${k}`}>{ch}</span><span>{l}<br /><span class="sub">{s2}</span></span></div>)}</div>
      </div>
    </div>
  );
}

/* ---------- Оплаты ---------- */

export function PaymentsPage() {
  return (
    <div class="stack" style="gap:20px">
      <div><p class="eyebrow">Оплаты</p><h1 class="display">Кто <em>оплатил</em></h1></div>
      <div class="kpis">
        <div class="kpi"><p class="eyebrow">Оплачено в этом месяце</p><b class="mono">0 ₸</b></div>
        <div class="kpi"><p class="eyebrow">Нужна оплата</p><b class="mono">0</b></div>
        <div class="kpi"><p class="eyebrow">Скоро оплата</p><b class="mono">0</b></div>
        <div class="kpi"><p class="eyebrow">Чеки Kaspi</p><b class="mono">0</b><span class="sub">хранятся год</span></div>
      </div>
      <div class="card stack" style="gap:8px">
        <h2 class="h3">Пришли чеки</h2>
        <p class="sub" style="margin:0">Деньги идут клиент → ваш Kaspi, «Дорожка» их не касается и счетов не выставляет. Здесь вы засчитываете оплату в два касания, новый абонемент продолжает расписание.</p>
      </div>
    </div>
  );
}

/* ---------- Настройки (сохраняются сами) ---------- */

type Section = 'programs' | 'hours' | 'remind' | 'account';
export function SettingsPage() {
  const [sec, setSec] = useState<Section>('programs');
  const SECTIONS: [Section, string][] = [['programs', 'Программы и цены'], ['hours', 'Рабочее время'], ['remind', 'Напоминания и учёт'], ['account', 'Аккаунт']];
  return (
    <div class="stack" style="gap:20px">
      <div><p class="eyebrow">Настройки · сохраняются сами</p><h1 class="display">{SECTIONS.find(([k]) => k === sec)![1]}</h1></div>
      <div class="seg" role="tablist" style="flex-wrap:wrap;align-self:flex-start">
        {SECTIONS.map(([k, l]) => <button aria-pressed={sec === k} onClick={() => setSec(k)}>{l}</button>)}
      </div>
      {sec === 'programs' && <ProgramsSection />}
      {sec === 'hours' && <HoursSection />}
      {sec === 'remind' && <RemindSection />}
      {sec === 'account' && <AccountSection />}
    </div>
  );
}

/** Сохраняет настройки через 600 мс после последнего изменения. */
function useAutosave() {
  const t = useRef(0);
  return (patch: Partial<Settings>) => {
    coach.value = { ...coach.value!, settings: { ...coach.value!.settings, ...patch } };
    clearTimeout(t.current);
    t.current = window.setTimeout(async () => {
      const r = await run(() => api.saveSettings(coach.value!.settings));
      if (r) coach.value = r;
    }, 600);
  };
}

const packOf = (p: Program, n: number) => p.packs.find((x) => x.sessions === n);
const money = (n: number | null | undefined) => (n == null ? '— ₸' : `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, ' ')} ₸`);

function ProgramsSection() {
  const [edit, setEdit] = useState<string | null>(null);
  const add = async (type: LessonType) => {
    const p = await run(() => api.addProgram({ type, name: TYPE_LABEL[type], dur: DEFAULT_DUR[type], packs: DEFAULT_PACKS() }));
    if (p) { programs.value = [...programs.value, p]; setEdit(p.id); }
  };
  const list = programs.value.filter((p) => !p.archived);
  return (
    <div class="card" style="padding:8px 24px 20px">
      <div class="prog-row prog-head eyebrow" style="border:0"><i /><span>Программа</span><div class="p-nums"><span>Мин</span><span>Разовое</span><span>8 занятий</span><span>10 занятий</span></div><span /></div>
      {list.length === 0 && <p class="sub">Программ пока нет.</p>}
      {list.map((p) => edit === p.id ? <ProgramEdit p={p} onDone={() => setEdit(null)} /> : (
        <div class="prog-row">
          <i class="typebar" style={`background:var(--t-${p.type})`} />
          <span><b>{p.name}</b><br /><span class="sub">{TYPE_LABEL[p.type]}</span></span>
          <div class="p-nums">
            <span class="mono"><span class="p-l">мин </span>{p.dur}</span>
            {[1, 8, 10].map((n) => <span class="mono"><span class="p-l">{n === 1 ? 'разовое ' : `${n} зан. `}</span>{money(packOf(p, n)?.price)}</span>)}
          </div>
          <button class="btn ghost sm" onClick={() => setEdit(p.id)}>Изменить</button>
        </div>
      ))}
      <div class="row" style="margin-top:16px">
        <span class="sub">+ Новая программа:</span>
        {LESSON_TYPES.map((t) => <button class="btn tint sm" onClick={() => add(t)}>{TYPE_LABEL[t]}</button>)}
      </div>
    </div>
  );
}

function ProgramEdit({ p, onDone }: { p: Program; onDone: () => void }) {
  const [f, setF] = useState({ name: p.name, dur: p.dur, packs: [1, 8, 10].map((n) => packOf(p, n) || { sessions: n, price: null }) as Pack[] });
  const setPrice = (n: number, v: string) => setF({ ...f, packs: f.packs.map((x) => (x.sessions === n ? { ...x, price: v === '' ? null : Math.max(0, Math.round(+v)) } : x)) });
  const save = async (archived = false) => {
    const r = await run(() => api.saveProgram({ ...p, name: f.name, dur: f.dur, packs: f.packs, archived }), archived ? 'Программа скрыта' : 'Сохранено');
    if (r) { programs.value = programs.value.map((x) => (x.id === r.id ? r : x)); onDone(); }
  };
  const changed = f.packs.find((x) => x.price !== (packOf(p, x.sessions)?.price ?? null) && packOf(p, x.sessions)?.price != null);
  return (
    <div class="card flat stack" style="background:var(--gesso);margin:8px 0;gap:12px">
      <div class="row">
        <label class="field grow"><span>Название</span><input class="input" value={f.name} maxLength={80} onInput={(e) => setF({ ...f, name: (e.target as HTMLInputElement).value })} /></label>
        <label class="field" style="width:96px"><span>Мин</span><input class="input mono" type="number" min={5} max={240} value={f.dur} onInput={(e) => setF({ ...f, dur: +(e.target as HTMLInputElement).value })} /></label>
      </div>
      <div class="row">
        {f.packs.map((x) => <label class="field grow"><span>{x.sessions === 1 ? 'Разовое' : `${x.sessions} занятий`}, ₸</span>
          <input class="input mono" type="number" min={0} value={x.price ?? ''} onInput={(e) => setPrice(x.sessions, (e.target as HTMLInputElement).value)} /></label>)}
      </div>
      {changed && <p class="sub" style="margin:0">Было {money(packOf(p, changed.sessions)?.price)} → станет {money(changed.price)} для новых оплат. Оплаченные абонементы не меняются.</p>}
      <div class="row">
        <button class="btn" onClick={() => save()}>Сохранить</button>
        <button class="btn ghost" onClick={onDone}>Отмена</button>
        <button class="btn ghost" style="margin-left:auto;color:var(--muted)" onClick={() => save(true)}>Скрыть программу</button>
      </div>
    </div>
  );
}

function HoursSection() {
  const save = useAutosave(), s = coach.value!.settings;
  return (
    <div class="stack" style="max-width:640px">
      <WeekEditor week={s.week} onChange={(i, h) => save({ week: s.week.map((x, j) => (j === i ? h : x)) })} />
      <label class="field"><span>Перерыв между занятиями, мин</span>
        <input class="input mono" type="number" min={0} max={120} value={s.breakMin} onInput={(e) => save({ breakMin: +(e.target as HTMLInputElement).value })} /></label>
      <p class="sub">По этим часам подбирается свободное время. Отпуск и больничный («Я не работаю») — на этапе 1, вместе с расписанием.</p>
      <div class="card flat row">
        <span class="grow"><b>Бассейн</b><br /><span class="sub">{s.pool.name || 'не указан'} · дорожек: {s.pool.lanes}</span></span>
        <div class="stepper">
          <button aria-label="Меньше" onClick={() => save({ pool: { ...s.pool, lanes: Math.max(1, s.pool.lanes - 1) } })}>−</button>
          <b>{s.pool.lanes}</b>
          <button aria-label="Больше" onClick={() => save({ pool: { ...s.pool, lanes: Math.min(12, s.pool.lanes + 1) } })}>+</button>
        </div>
      </div>
    </div>
  );
}

function RemindSection() {
  const save = useAutosave(), s = coach.value!.settings;
  return (
    <div class="stack" style="max-width:640px">
      <div class="card flat stack" style="gap:12px">
        <label class="field"><span>Напоминать о занятии за</span>
          <select class="input" value={s.remindLead} onChange={(e) => save({ remindLead: (e.target as HTMLSelectElement).value as Settings['remindLead'] })}>
            <option value="15m">15 минут</option><option value="30m">30 минут</option><option value="1h">1 час</option><option value="2h">2 часа</option>
          </select></label>
        <div class="row"><span class="grow"><b>Telegram</b><br /><span class="sub">напоминания, сводка утром, кнопки отметки · подключение на этапе 3</span></span><span class="tag">не подключён</span></div>
      </div>
      <label class="card flat check">
        <input type="checkbox" checked={s.chargeNoShow} onChange={(e) => save({ chargeNoShow: (e.target as HTMLInputElement).checked })} />
        <span><b>Списывать неявку без предупреждения</b><br /><span class="sub">Если клиент не пришёл и не предупредил, занятие списывается с абонемента. Предупредил, пробное, пауза — не списываются никогда.</span></span>
      </label>
    </div>
  );
}

function AccountSection() {
  const me = coach.value!;
  const [name, setName] = useState(me.name);
  const [del, setDel] = useState('');
  const [busy, setBusy] = useState(false);
  useEffect(() => setName(me.name), [me.name]);
  const saveName = async () => { const r = await run(() => api.saveSettings({ name }), 'Сохранено'); if (r) coach.value = r; };
  const remove = async () => {
    setBusy(true);
    const ok = await run(() => api.deleteAccount(del).then(() => true));
    setBusy(false);
    if (ok) location.replace('/beta/');
  };
  return (
    <div class="stack" style="max-width:640px">
      <div class="card flat stack" style="gap:12px">
        <label class="field"><span>Как к вам обращаться</span>
          <div class="row"><input class="input grow" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} /><button class="btn tint" onClick={saveName}>Сохранить</button></div></label>
        <p class="sub" style="margin:0">Вход: {me.email} (Google)</p>
        <p class="sub" style="margin:0">Тариф: {me.limit ? `бесплатный, ${me.activeClients} из ${me.limit} клиентов` : 'подписка'}{me.paidUntil ? ` · оплачено до ${me.paidUntil}` : ''}</p>
      </div>
      <div class="card flat stack" style="gap:12px">
        <p class="eyebrow">Ваши данные</p>
        <a class="btn tint" href={api.exportUrl()} download={`dorozhka-${new Date().toISOString().slice(0, 10)}.json`}>Скачать все данные (JSON)</a>
        <p class="sub" style="margin:0">Отозвать согласие = удалить аккаунт: клиенты, расписание, оплаты и фото чеков удалятся навсегда.</p>
        <label class="field"><span>Чтобы удалить, введите УДАЛИТЬ</span><input class="input" value={del} onInput={(e) => setDel((e.target as HTMLInputElement).value)} /></label>
        <button class="btn danger" disabled={del !== 'УДАЛИТЬ' || busy || isDemo} onClick={remove}>Отозвать согласие и удалить аккаунт</button>
      </div>
      <button class="btn ghost" onClick={() => api.logout().then(() => location.replace('/beta/'))}>Выйти</button>
    </div>
  );
}
