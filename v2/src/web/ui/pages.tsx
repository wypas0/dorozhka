// Сегодня (лента дня), Журнал (вид времени), Оплаты, Настройки.
import { useEffect, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_DUR, DEFAULT_PACKS, LESSON_TYPES, TYPE_LABEL, WEEKDAYS, type LessonType, type Pack, type Program, type Settings,
} from '../../shared/types';
import { api, clientName, coach, isDemo, lessons, loadLessons, now, programs, run, weekOf } from '../state';
import { addDays, byStart, endMin, fromMin, toMin, weekday, type JLesson, type Vacation } from '../../shared/rules';
import { LessonSheet, MarkChip, NewLessonSheet, cellIn, lessonTitle, status } from './lesson';
import { Water } from './brand';
import { WeekEditor } from './entry';

const DAYS = ['воскресенье', 'понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
const greet = (h: number) => (h < 5 ? 'Доброй ночи' : h < 12 ? 'Доброе утро' : h < 18 ? 'Добрый день' : 'Добрый вечер');
const firstName = () => (coach.value?.name || '').split(' ')[0];
const dObj = (iso: string) => new Date(`${iso}T00:00:00`);
const typeColor = (t: string) => `var(--t-${t})`;
const lessonsN = (n: number) => `${n} ${n % 10 === 1 && n % 100 !== 11 ? 'занятие' : [2, 3, 4].includes(n % 10) && ![12, 13, 14].includes(n % 100) ? 'занятия' : 'занятий'}`;

function WeekNav() {
  const go = (iso: string) => { weekOf.value = iso; loadLessons(); };
  return <div class="row" style="gap:6px">
    <button class="btn tint sm" aria-label="Прошлая неделя" onClick={() => go(addDays(weekOf.value, -7))}>‹</button>
    <button class="btn tint sm" onClick={() => go(addDays(now.value.date, -weekday(now.value.date)))}>Сегодня</button>
    <button class="btn tint sm" aria-label="Следующая неделя" onClick={() => go(addDays(weekOf.value, 7))}>›</button>
  </div>;
}

/* ---------- Сегодня: лента дня ---------- */

export function TodayPage() {
  const n = now.value, name = firstName();
  const [day, setDay] = useState(n.date);
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  useEffect(() => {
    if (day < weekOf.value || day > addDays(weekOf.value, 6)) { weekOf.value = addDays(day, -weekday(day)); loadLessons(); }
  }, [day]);
  const list = lessons.value.filter((l) => l.date === day).sort(byStart);
  const waiting = (l: JLesson) => !l.cancelled && status(l).cls === 'wait';
  const cur = lessons.value.find((l) => l.id === open);
  const d = dObj(n.date);
  const ahead = list.filter((l) => !l.cancelled && `${l.date}T${l.start}` > `${n.date}T${fromMin(n.min)}`).length;
  return (
    <div class="stack" style="gap:20px">
      <div>
        <p class="eyebrow">{DAYS[d.getDay()]}, {d.getDate()} {MONTHS[d.getMonth()]}</p>
        <h1 class="display">{greet(Math.floor(n.min / 60))}{name ? <>, <em>{name}</em></> : null}</h1>
      </div>
      <Water />
      <div class="daystrip" role="group" aria-label="День недели">
        {Array.from({ length: 7 }, (_, i) => {
          const iso = addDays(weekOf.value, i), has = lessons.value.filter((l) => l.date === iso && !l.cancelled);
          return <button aria-pressed={iso === day} onClick={() => setDay(iso)}>
            <span style="font-size:12px;opacity:.8">{iso === n.date ? 'сег.' : WEEKDAYS[i]}</span><b class="mono">{dObj(iso).getDate()}</b>
            <i class={has.some(waiting) ? 'on' : ''} style={has.length ? '' : 'visibility:hidden'} /></button>;
        })}
      </div>
      <div class="row">
        <span class="tag">{lessonsN(list.filter((l) => !l.cancelled).length)}</span>
        <span class="tag">впереди {ahead}</span>
        {list.some(waiting) && <span class="tag wait">отметить {list.filter(waiting).length}</span>}
        <button class="btn sm" style="margin-left:auto" onClick={() => setAdding(true)}>+ Занятие</button>
      </div>
      {list.length === 0 ? (
        <div class="card stack" style="gap:8px;max-width:560px">
          <h2 class="h3">{day === n.date ? 'Сегодня занятий нет' : 'В этот день занятий нет'}</h2>
          <p class="sub" style="margin:0">Оформите клиенту абонемент в его карточке («8 занятий, пн и чт 18:00»), и занятия сами встанут в расписание.</p>
        </div>
      ) : (
        <div class="feed">
          {list.map((l) => {
            const st = status(l);
            return <>
              <div class="t" style={`border-color:${typeColor(l.type)}`}>{l.start}<small>{fromMin(endMin(l))}</small></div>
              <button class={`lcard${st.cls.includes('solid') ? ' now' : ''}${l.cancelled ? ' cancel' : ''}`} onClick={() => setOpen(l.id)}>
                <div class="row" style="gap:8px"><b class="grow" style="font-size:16px">{lessonTitle(l)}</b>{st.text && <span class={`tag ${st.cls}`}>{st.text}</span>}</div>
                <span class="sub">{TYPE_LABEL[l.type]}{l.lane ? ` · дорожка ${l.lane}` : ''}</span>
                <div class="who">{l.clientIds.map((id) => <span><MarkChip cell={cellIn(l, id)} />{clientName(id).split(' ')[0]}</span>)}</div>
              </button>
            </>;
          })}
        </div>
      )}
      {cur && <LessonSheet key={cur.id} lesson={cur} onClose={() => setOpen(null)} />}
      {adding && <NewLessonSheet date={day} onClose={() => setAdding(false)} />}
    </div>
  );
}

/* ---------- Журнал: неделя ---------- */

const MARKS: [string, string, string, string][] = [
  ['present', '✓', 'был', 'списано'], ['absent', 'Н', 'не предупредил', 'списано'], ['excused', 'П', 'предупредил', 'не списано'],
  ['trial', 'Пр', 'пробное', 'не списано'], ['pause', '', 'пауза, отпуск', 'не списано'], ['cancelled', '✕', 'отменено', 'не списано'],
  ['unmarked', '?', 'не отмечено', 'ждёт'], ['ahead', '', 'впереди', 'ещё не было'],
];
const PX = 56 / 60; // пикселей на минуту

/** Занятия, которые идут одновременно, встают рядом: номер колонки и сколько колонок в дне. */
function sideBySide(day: JLesson[]) {
  const cols: JLesson[][] = [];
  const at = new Map<string, number>();
  for (const l of day) {
    let k = cols.findIndex((c) => c.every((o) => endMin(o) <= toMin(l.start) || endMin(l) <= toMin(o.start)));
    if (k < 0) { cols.push([]); k = cols.length - 1; }
    cols[k].push(l);
    at.set(l.id, k);
  }
  return { at, n: Math.max(1, cols.length) };
}

export function JournalPage() {
  const [view, setView] = useState<'week' | 'lanes'>('week');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState<{ date: string; start: string } | null>(null);
  const s = coach.value!.settings, ws = weekOf.value, n = now.value, week = lessons.value;
  const work = s.week.filter(Boolean) as { from: string; to: string }[];
  const starts = [...work.map((h) => toMin(h.from)), ...week.map((l) => toMin(l.start))];
  const ends = [...work.map((h) => toMin(h.to)), ...week.map(endMin)];
  const m0 = Math.floor((starts.length ? Math.min(...starts) : 480) / 60) * 60;
  const m1 = Math.ceil((ends.length ? Math.max(...ends) : 1200) / 60) * 60;
  const height = (m1 - m0) * PX, hours = (m1 - m0) / 60;
  const end = addDays(ws, 6), d0 = dObj(ws), d1 = dObj(end);
  const cur = week.find((l) => l.id === open);
  return (
    <div class="stack" style="gap:20px">
      <div class="page-head" style="margin:0">
        <div><p class="eyebrow">Журнал · Время</p>
          <h1 class="display">Неделя <em>{d0.getDate()}{d0.getMonth() !== d1.getMonth() ? ` ${MONTHS[d0.getMonth()]}` : ''}–{d1.getDate()} {MONTHS[d1.getMonth()]}</em></h1></div>
        <div class="row">
          <WeekNav />
          <div class="seg" role="group" aria-label="Вид">
            <button aria-pressed={view === 'week'} onClick={() => setView('week')}>Неделя</button>
            <button aria-pressed={view === 'lanes'} onClick={() => setView('lanes')}>Дорожки</button>
          </div>
          <button class="btn" onClick={() => setAdding({ date: n.date >= ws && n.date <= end ? n.date : ws, start: '18:00' })}>+ Занятие</button>
        </div>
      </div>
      {view === 'week' ? (
        <div class="table" style="overflow-x:auto">
          <div class="week">
            <div class="head" />
            {WEEKDAYS.map((w, i) => {
              const iso = addDays(ws, i), h = s.week[i], cnt = week.filter((l) => l.date === iso && !l.cancelled).length;
              return <div class={`head${iso === n.date ? ' today' : ''}`}>{iso === n.date ? 'Сегодня' : w} <span class="sub">{dObj(iso).getDate()}</span>
                <div class="sub" style="font-weight:400">{h ? `${cnt} зан. · до ${h.to}` : 'выходной'}</div></div>;
            })}
            <div class="col" style={`height:${height}px;border:0`}>
              {Array.from({ length: hours }, (_, i) => <span class="mono sub" style={`position:absolute;top:${i * 60 * PX + 2}px;right:8px;font-size:11px`}>{fromMin(m0 + i * 60)}</span>)}
            </div>
            {WEEKDAYS.map((_, i) => {
              const iso = addDays(ws, i), h = s.week[i];
              const off: [number, number][] = h ? [[m0, toMin(h.from)], [toMin(h.to), m1]] : [[m0, m1]];
              const day = week.filter((l) => l.date === iso).sort(byStart);
              const { at, n: cols } = sideBySide(day), w = 100 / cols;
              return (
                <div class="col" style={`height:${height}px`} onDblClick={(e) => {
                  if (!(e.target as HTMLElement).classList.contains('col')) return;
                  const m = Math.round((m0 + (e as MouseEvent).offsetY / PX) / 15) * 15;
                  setAdding({ date: iso, start: fromMin(m) });
                }}>
                  {off.filter(([a, b]) => b > a).map(([a, b]) => <div class="off" style={`top:${(a - m0) * PX}px;height:${(b - a) * PX}px`} />)}
                  {Array.from({ length: hours }, (_, k) => <div class="hour" style={`top:${k * 60 * PX}px`} />)}
                  {iso === n.date && n.min >= m0 && n.min <= m1 && <div class="nowline" style={`top:${(n.min - m0) * PX}px`} />}
                  {day.map((l) => {
                    const st = status(l), k = at.get(l.id)!;
                    return <button class={`wblock${l.cancelled ? ' cancel' : ''}${st.cls === 'wait' ? ' wait' : ''}`}
                      style={`--bar:${typeColor(l.type)};top:${(toMin(l.start) - m0) * PX + 1}px;height:${Math.max(22, l.dur * PX - 2)}px;left:calc(${k * w}% + 3px);right:auto;width:calc(${w}% - 6px)`}
                      onClick={() => setOpen(l.id)} title={`${l.start} ${lessonTitle(l)}`}>
                      <b><span class="mono" style="font-weight:500">{l.start}</span> {lessonTitle(l)}</b>
                      {l.dur >= 40 && <span class="ms">{l.clientIds.slice(0, 6).map((id) => <MarkChip cell={cellIn(l, id)} />)}</span>}
                    </button>;
                  })}
                </div>
              );
            })}
          </div>
        </div>
      ) : (
        <div class="card stack" style="gap:8px">
          <h2 class="h3">Дорожки: {s.pool.lanes}{s.pool.name ? ` · ${s.pool.name}` : ''}</h2>
          <p class="sub" style="margin:0">День по дорожкам бассейна и строка «вы, тренер». У занятий уже есть поле «дорожка»; сам вид рисуем, если владелец выберет его главным.</p>
        </div>
      )}
      <div class="card">
        <p class="eyebrow" style="margin-bottom:14px">Отметки: буква + цвет. Закрашено = списано</p>
        <div class="legend">{MARKS.map(([k, ch, l, s2]) => <div><span class={`mark ${k}`}>{ch}</span><span>{l}<br /><span class="sub">{s2}</span></span></div>)}</div>
        <p class="sub" style="margin:12px 0 0">Двойной щелчок по пустому месту в неделе — новое занятие на это время.</p>
      </div>
      {cur && <LessonSheet key={cur.id} lesson={cur} onClose={() => setOpen(null)} />}
      {adding && <NewLessonSheet date={adding.date} start={adding.start} onClose={() => setAdding(null)} />}
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
      <p class="sub">По этим часам подбирается свободное время.</p>
      <Vacations />
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

/** «Я не работаю»: отпуск или больничный. Новые абонементы и отработки пропускают эти дни. */
function Vacations() {
  const [list, setList] = useState<Vacation[] | null>(null);
  const [f, setF] = useState({ from: now.value.date, to: addDays(now.value.date, 6) });
  useEffect(() => { api.vacations().then(setList).catch(() => setList([])); }, []);
  const add = async () => { const v = await run(() => api.addVacation(f.from, f.to), 'Дни добавлены'); if (v) setList([...(list || []), v]); };
  const del = async (id: string) => { if (await run(() => api.deleteVacation(id).then(() => true))) setList((list || []).filter((v) => v.id !== id)); };
  return (
    <div class="card flat stack" style="gap:10px">
      <b>Я не работаю</b>
      <p class="sub" style="margin:0">Отпуск или больничный: новые абонементы и отработки пропустят эти дни. Уже стоящие занятия не двигаются — перенесите или отмените их в журнале.</p>
      {(list || []).map((v) => <div class="row"><span class="grow mono">{v.from} — {v.to}</span><button class="btn ghost sm" onClick={() => del(v.id)}>Убрать</button></div>)}
      <div class="row">
        <input class="input" type="date" value={f.from} style="width:auto" aria-label="С" onInput={(e) => setF({ ...f, from: (e.target as HTMLInputElement).value })} />
        <span>—</span>
        <input class="input" type="date" value={f.to} style="width:auto" aria-label="По" onInput={(e) => setF({ ...f, to: (e.target as HTMLInputElement).value })} />
        <button class="btn tint" onClick={add}>Добавить дни</button>
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
