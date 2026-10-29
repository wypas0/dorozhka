// Занятие: метки отметок, панель отметки (одна на всех экранах), новое занятие.
import { useState } from 'preact/hooks';
import { DEFAULT_DUR, LESSON_TYPES, TYPE_LABEL, WEEKDAYS, type LessonType } from '../../shared/types';
import {
  SPLIT_N, cellOf, endMin, fromMin, isGroupish, isPaused, toMin, weekday, type Cell, type JLesson, type Mark,
} from '../../shared/rules';
import { api, clientName, clients, groups, now, programs, refresh, run, weekOf } from '../state';
import { Sheet } from './clients';

const CELL: Record<Cell, [string, string]> = {
  present: ['present', '✓'], absent: ['absent', 'Н'], excused: ['excused', 'П'], trial: ['trial', 'Пр'],
  pause: ['pause', ''], unmarked: ['unmarked', '?'], cancelled: ['cancelled', '✕'],
};
export const MarkChip = ({ cell, title }: { cell: Cell | 'ahead'; title?: string }) => {
  const [cls, ch] = cell === 'ahead' ? ['ahead', ''] : CELL[cell];
  return <span class={`mark ${cls}`} title={title}>{ch}</span>;
};

const DAYS = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MONTHS = ['января', 'февраля', 'марта', 'апреля', 'мая', 'июня', 'июля', 'августа', 'сентября', 'октября', 'ноября', 'декабря'];
export const fdate = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${DAYS[d.getDay()]}, ${d.getDate()} ${MONTHS[d.getMonth()]}`; };
export const lessonTitle = (l: JLesson) => {
  const g = l.groupId && groups.value.find((x) => x.id === l.groupId);
  const name = g ? g.name : l.clientIds.map((id) => clientName(id).split(' ')[0]).join(' и ') || '—';
  return (l.kind === 'trial' ? 'Пробное · ' : l.kind === 'makeup' ? 'Отработка · ' : '') + name;
};
const isPast = (l: JLesson) => `${l.date}T${l.start}` <= `${now.value.date}T${fromMin(now.value.min)}`;
const pausedIn = (l: JLesson, id: string) => isPaused({ id, name: '', archived: false, pauses: clients.value.find((c) => c.id === id)?.pauses ?? [], plan: null }, l.date);
export const cellIn = (l: JLesson, id: string): Cell | 'ahead' => {
  if (l.cancelled) return 'cancelled';
  if (!l.att[id] && pausedIn(l, id)) return 'pause';
  if (!l.att[id] && !isPast(l)) return 'ahead';
  return cellOf({ clients: [], groups: [], lessons: [], payments: [], vacations: [], settings: {} as any }, l, id);
};
/** Статус занятия для ленты и недели. */
export function status(l: JLesson): { text: string; cls: string } {
  if (l.cancelled) return { text: 'отменено', cls: '' };
  const n = now.value, s = toMin(l.start), e = endMin(l);
  if (l.date === n.date && s <= n.min && n.min < e) return { text: 'идёт сейчас', cls: 'ok solid' };
  const waiting = l.clientIds.filter((id) => !l.att[id] && !pausedIn(l, id)).length;
  if (isPast(l)) return waiting ? { text: `отметить ${waiting}`, cls: 'wait' } : { text: 'отмечено', cls: 'ok' };
  if (l.date === n.date && s - n.min <= 15) return { text: `через ${s - n.min} мин`, cls: 'bad' };
  if (l.date === n.date && s - n.min < 120) return { text: `через ${s - n.min} мин`, cls: '' };
  return { text: l.kind === 'trial' ? 'пробное' : l.kind === 'makeup' ? 'отработка' : '', cls: 'info' };
}

/* ---------- панель занятия: отметка, перенос, отмена ---------- */

const REASONS = ['болеет', 'уехал', 'соревнования'];
const willCharge = (l: JLesson, m: Mark) => l.kind !== 'trial' && (m === 'present' || m === 'absent');

export function LessonSheet({ lesson, onClose }: { lesson: JLesson; onClose: () => void }) {
  const [l, setL] = useState(lesson);
  const [edit, setEdit] = useState(false);
  const [f, setF] = useState({ date: l.date, start: l.start, dur: l.dur, lane: l.lane || '', log: l.log, nextNote: l.nextNote });
  const [confirmDel, setConfirmDel] = useState(false);
  const mark = async (cid: string, m: Mark | null, reason: string | null = null) => {
    const r = await run(() => api.mark(l.id, cid, l.att[cid] === m && !reason ? null : m, reason));
    if (!r) return;
    setL(r.lesson);
    if (r.makeup) run(async () => {}, `Все предупредили: отработка ${fdate(r.makeup.date)}, ${r.makeup.start}`);
    else if (r.removed.length) run(async () => {}, 'Отработка убрана');
    refresh();
  };
  const save = async (patch: Partial<JLesson>, msg: string) => {
    const r = await run(() => api.saveLesson(l.id, patch), msg);
    if (r) { setL(r); setEdit(false); refresh(); }
  };
  const del = async () => { if (await run(() => api.deleteLesson(l.id).then(() => true), 'Занятие удалено')) { refresh(); onClose(); } };
  const st = status(l);
  const shown = [...l.clientIds];
  return (
    <Sheet onClose={onClose} title={lessonTitle(l)} head={<div>
      <p class="eyebrow">{TYPE_LABEL[l.type]}{l.groupId ? ' · группа' : ''}</p>
      <h2 class="h2" style="font-size:24px;margin-top:4px">{lessonTitle(l)}</h2>
      <p class="sub" style="margin:4px 0 0">{fdate(l.date)} · <span class="mono">{l.start}–{fromMin(endMin(l))}</span>{l.lane ? ` · дорожка ${l.lane}` : ''}</p>
      {st.text && <span class={`tag ${st.cls}`} style="margin-top:8px">{st.text}</span>}
    </div>}>
      {l.cancelled && <p class="tag" style="align-self:flex-start">Занятие отменено, ничего не списывается</p>}
      {!l.cancelled && shown.map((cid) => {
        const cur = l.att[cid], paused = !cur && pausedIn(l, cid);
        return (
          <div class="card flat stack" style="gap:10px;padding:16px">
            <div class="row"><MarkChip cell={cellIn(l, cid)} /><b class="grow">{clientName(cid)}</b>
              <span class="sub">{cur ? (cur === 'present' ? 'был' : cur === 'absent' ? 'не предупредил' : `предупредил${l.reasons[cid] ? `, ${l.reasons[cid]}` : ''}`) : paused ? 'на паузе' : 'не отмечено'}</span></div>
            <div class="markpad">
              {([['present', '✓ Был'], ['excused', 'Предупредил'], ['absent', 'Не пришёл']] as [Mark, string][]).map(([m, label]) =>
                <button aria-pressed={cur === m} onClick={() => mark(cid, m)}>{label}<small>{willCharge(l, m) ? 'спишется' : 'не спишется'}</small></button>)}
            </div>
            {cur === 'excused' && <div class="row" style="gap:6px">{REASONS.map((r) =>
              <button class="chip" style="height:30px" aria-pressed={l.reasons[cid] === r} onClick={() => mark(cid, 'excused', r)}>{r}</button>)}</div>}
            {cur && <button class="btn ghost sm" style="align-self:flex-start" onClick={() => mark(cid, null)}>Снять отметку</button>}
          </div>
        );
      })}
      {l.type === 'split' && l.clientIds.length === 1 && <p class="sub">Сплит на одного: считается как пара ({SPLIT_N} места).</p>}

      {!edit ? <>
        {(l.log || l.nextNote) && <div class="card flat stack" style="gap:6px">
          {l.log && <p style="margin:0"><b>Конспект:</b> {l.log}</p>}
          {l.nextNote && <p style="margin:0"><b>На следующий раз:</b> {l.nextNote}</p>}
        </div>}
        <div class="row">
          <button class="btn tint" onClick={() => setEdit(true)}>Перенести или записать</button>
          <button class="btn ghost" onClick={() => save({ cancelled: !l.cancelled }, l.cancelled ? 'Занятие вернулось' : 'Занятие отменено')}>{l.cancelled ? 'Вернуть занятие' : 'Отменить занятие'}</button>
          {!confirmDel ? <button class="btn ghost" style="color:var(--bad)" onClick={() => setConfirmDel(true)}>Удалить</button>
            : <button class="btn danger" onClick={del}>Да, удалить занятие</button>}
        </div>
      </> : <div class="card flat stack" style="gap:12px">
        <div class="row">
          <label class="field grow"><span>Дата</span><input class="input" type="date" value={f.date} onInput={(e) => setF({ ...f, date: (e.target as HTMLInputElement).value })} /></label>
          <label class="field" style="width:120px"><span>Начало</span><input class="input mono" type="time" value={f.start} onInput={(e) => setF({ ...f, start: (e.target as HTMLInputElement).value })} /></label>
        </div>
        <div class="row">
          <label class="field" style="width:120px"><span>Минут</span><input class="input mono" type="number" min={5} max={240} value={f.dur} onInput={(e) => setF({ ...f, dur: +(e.target as HTMLInputElement).value })} /></label>
          <label class="field grow"><span>Дорожка</span><input class="input" value={f.lane} maxLength={20} onInput={(e) => setF({ ...f, lane: (e.target as HTMLInputElement).value })} /></label>
        </div>
        <label class="field"><span>Конспект</span><textarea class="input" value={f.log} maxLength={4000} onInput={(e) => setF({ ...f, log: (e.target as HTMLTextAreaElement).value })} /></label>
        <label class="field"><span>На следующий раз</span><input class="input" value={f.nextNote} maxLength={1000} onInput={(e) => setF({ ...f, nextNote: (e.target as HTMLInputElement).value })} /></label>
        <div class="row">
          <button class="btn" onClick={() => save({ ...f, lane: f.lane || null }, 'Сохранено')}>Сохранить</button>
          <button class="btn ghost" onClick={() => setEdit(false)}>Отмена</button>
        </div>
      </div>}
    </Sheet>
  );
}

/* ---------- новое занятие ---------- */

export function NewLessonSheet({ date, start, onClose }: { date?: string; start?: string; onClose: () => void }) {
  const [type, setType] = useState<LessonType>('individual');
  const [kind, setKind] = useState<'regular' | 'trial'>('regular');
  const [ids, setIds] = useState<string[]>([]);
  const [groupId, setGroup] = useState('');
  const [f, setF] = useState({ date: date || now.value.date, start: start || '18:00', dur: 0, lane: '', n: 1, days: [] as number[] });
  const [q, setQ] = useState('');
  const dur = f.dur || programs.value.find((p) => p.type === type && !p.archived)?.dur || DEFAULT_DUR[type];
  const groupish = isGroupish(type);
  const myGroups = groups.value.filter((g) => !g.archived && g.type === type);
  const list = clients.value.filter((c) => !c.archivedAt && (!q || c.name.toLowerCase().includes(q.toLowerCase())));
  const toggle = (id: string) => setIds(ids.includes(id) ? ids.filter((x) => x !== id) : type === 'individual' || type === 'baby' ? [id] : [...ids, id]);
  const ok = groupish ? !!groupId : ids.length > 0 && (type !== 'split' || ids.length <= SPLIT_N);
  const save = async () => {
    const r = await run(() => api.addLessons({
      date: f.date, start: f.start, dur, type, kind, clientIds: groupish ? [] : ids, groupId: groupish ? groupId : null, lane: f.lane || null,
      repeat: f.n > 1 ? { n: f.n, days: f.days } : null,
    }), f.n > 1 ? `Создано занятий: ${f.n}` : 'Занятие создано');
    if (r) { weekOf.value = r[0] ? addMonday(r[0].date) : weekOf.value; await refresh(); onClose(); }
  };
  return (
    <Sheet title="Новое занятие" onClose={onClose}>
      <label class="field"><span>Вид</span>
        <select class="input" value={type} onChange={(e) => { setType((e.target as HTMLSelectElement).value as LessonType); setIds([]); setGroup(''); }}>
          {LESSON_TYPES.map((t) => <option value={t}>{TYPE_LABEL[t]}</option>)}
        </select></label>
      {!groupish && <label class="check"><input type="checkbox" checked={kind === 'trial'} onChange={(e) => setKind((e.target as HTMLInputElement).checked ? 'trial' : 'regular')} /><span>Пробное — не списывается</span></label>}
      {groupish ? (myGroups.length
        ? <label class="field"><span>Группа</span><select class="input" value={groupId} onChange={(e) => setGroup((e.target as HTMLSelectElement).value)}>
            <option value="">Выберите</option>{myGroups.map((g) => <option value={g.id}>{g.name} · {g.memberIds.length} чел.</option>)}</select></label>
        : <p class="sub">Групп этого вида нет. Создайте группу в «Клиенты → Группы».</p>)
        : <div class="field"><span>Кто придёт{type === 'split' ? ' (один на сплит или двое)' : ''}</span>
          <input class="input" type="search" placeholder="Найти" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} />
          <div class="card flat" style="padding:4px 16px;max-height:220px;overflow:auto">
            {list.map((c) => <label class="check" style="padding:8px 0">{type === 'individual' || type === 'baby'
              ? <input type="radio" name="who" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />
              : <input type="checkbox" checked={ids.includes(c.id)} onChange={() => toggle(c.id)} />}<span>{c.name}</span></label>)}
          </div></div>}
      <div class="row">
        <label class="field grow"><span>Дата</span><input class="input" type="date" value={f.date} onInput={(e) => setF({ ...f, date: (e.target as HTMLInputElement).value })} /></label>
        <label class="field" style="width:120px"><span>Начало</span><input class="input mono" type="time" value={f.start} onInput={(e) => setF({ ...f, start: (e.target as HTMLInputElement).value })} /></label>
      </div>
      <div class="row">
        <label class="field" style="width:120px"><span>Минут</span><input class="input mono" type="number" min={5} max={240} value={dur} onInput={(e) => setF({ ...f, dur: +(e.target as HTMLInputElement).value })} /></label>
        <label class="field grow"><span>Дорожка</span><input class="input" value={f.lane} maxLength={20} onInput={(e) => setF({ ...f, lane: (e.target as HTMLInputElement).value })} /></label>
        <label class="field" style="width:120px"><span>Повторить, раз</span><input class="input mono" type="number" min={1} max={60} value={f.n} onInput={(e) => setF({ ...f, n: Math.max(1, +(e.target as HTMLInputElement).value || 1) })} /></label>
      </div>
      {f.n > 1 && <div class="row" style="gap:6px">
        <span class="sub">Ещё по дням:</span>
        {WEEKDAYS.map((w, i) => <button class="chip" style="height:32px" aria-pressed={f.days.includes(i) || i === weekday(f.date)}
          onClick={() => setF({ ...f, days: f.days.includes(i) ? f.days.filter((x) => x !== i) : [...f.days, i] })}>{w}</button>)}
      </div>}
      <button class="btn lg block" disabled={!ok} onClick={save}>Создать</button>
    </Sheet>
  );
}
const addMonday = (iso: string) => { const d = new Date(`${iso}T00:00:00Z`); d.setUTCDate(d.getUTCDate() - weekday(iso)); return d.toISOString().slice(0, 10); };
