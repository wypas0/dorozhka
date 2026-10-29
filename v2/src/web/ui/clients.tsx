// «Клиенты» — основной экран журнала (холст 1.1): у кого сколько осталось и кто должен.
// Остаток считается по оплатам (этап 2); расписание, отметки и паузы — этап 1.
import { useEffect, useState } from 'preact/hooks';
import { LESSON_TYPES, TYPE_LABEL, WEEKDAYS, type Client, type ClientConsent, type ConsentMethod, type LessonType } from '../../shared/types';
import { addDays, isGroupish, weekday, type JGroup, type JLesson } from '../../shared/rules';
import { api, clientName, clients, coach, groups, now, programs, refresh, refreshCoach, run, upsertClient } from '../state';
import { initials } from './entry';
import { MarkChip, cellIn } from './lesson';

const MONTH = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const METHOD: Record<string, string> = { form: 'бланк подписан', written: 'письменно в мессенджере', link: 'по ссылке' };
const active = (c: Client, kind: string) => c.consents.some((k) => k.kind === kind && !k.revokedAt);

export function ClientsPage() {
  const [filter, setFilter] = useState<'all' | 'kids' | 'debt' | 'unmarked' | 'groups' | 'archive'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const me = coach.value!;
  const pass = (c: Client) => filter === 'archive' ? !!c.archivedAt : !c.archivedAt && (filter === 'all' || filter === 'groups'
    || (filter === 'kids' && c.isChild) || (filter === 'debt' && needPay(c)) || (filter === 'unmarked' && c.summary.unmarked > 0));
  const list = clients.value.filter(pass).filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const act = clients.value.filter((c) => !c.archivedAt);
  const cells = act.flatMap((c) => c.summary.last);
  const att = { present: cells.filter((x) => x === 'present' || x === 'trial').length, absent: cells.filter((x) => x === 'absent').length,
    marked: cells.filter((x) => x === 'present' || x === 'trial' || x === 'absent' || x === 'excused').length };
  const cur = clients.value.find((c) => c.id === open);

  return (
    <>
      <div class="page-head">
        <div><p class="eyebrow">Журнал · Клиенты</p><h1 class="display">У кого сколько <em>осталось</em></h1></div>
        <div class="row">
          <input class="input" type="search" placeholder="Найти клиента" value={q} onInput={(e) => setQ((e.target as HTMLInputElement).value)} style="width:220px" />
          <button class="btn" onClick={() => setAdding(true)}>+ Клиент</button>
        </div>
      </div>

      <div class="kpis" style="margin-bottom:20px">
        <div class="kpi"><p class="eyebrow">Оплачено в {MONTH[new Date().getMonth()]}</p><b class="mono">0 ₸</b><span class="sub">оплаты — на этапе 2</span></div>
        <div class="kpi"><p class="eyebrow">Ожидается</p><b class="mono">0 ₸</b><span class="sub">нет абонементов</span></div>
        <div class="kpi"><p class="eyebrow">Посещаемость</p>{att.marked ? <><b class="mono">{Math.round((att.present / att.marked) * 100)}%</b>
          <span class="sub">{att.absent ? `не предупредили: ${att.absent}` : 'по последним 8 занятиям'}</span></> : <><b>—</b><span class="sub">отметок пока нет</span></>}</div>
        <div class="kpi"><p class="eyebrow">Активные клиенты</p><b class="mono">{act.length}{me.limit ? <span class="sub" style="font-family:var(--font-sans)"> из {me.limit}</span> : null}</b>
          <span class="sub">{me.limit ? 'бесплатный тариф' : 'подписка'}</span></div>
      </div>

      <div class="row" style="margin-bottom:12px">
        <button class="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все <span class="n">{act.length}</span></button>
        <button class="chip" aria-pressed={filter === 'kids'} onClick={() => setFilter('kids')}>Дети <span class="n">{act.filter((c) => c.isChild).length}</span></button>
        <button class="chip" aria-pressed={filter === 'debt'} onClick={() => setFilter('debt')}>Нужна оплата <span class="n">{act.filter(needPay).length}</span></button>
        <button class="chip" aria-pressed={filter === 'unmarked'} onClick={() => setFilter('unmarked')}>Не отмечено <span class="n">{act.filter((c) => c.summary.unmarked > 0).length}</span></button>
        <button class="chip" aria-pressed={filter === 'groups'} onClick={() => setFilter('groups')}>Группы <span class="n">{groups.value.filter((g) => !g.archived).length}</span></button>
        <button class="chip" aria-pressed={filter === 'archive'} onClick={() => setFilter('archive')}>Архив <span class="n">{clients.value.length - act.length}</span></button>
      </div>

      {filter === 'groups' ? <GroupsList /> : (
        <div class="table" role="table" aria-label="Клиенты">
          <div class="thead" role="row"><span>Клиент</span><span>Абонемент</span><span>Последние 8 занятий</span><span>Следующее</span><span>Оплата</span></div>
          {list.length === 0 && <div style="padding:40px 20px;text-align:center" class="sub">
            {filter === 'archive' ? 'В архиве пусто.' : q ? 'Никого не нашли.' : 'Клиентов пока нет. Нажмите «+ Клиент».'}</div>}
          {byType(list).map(([t, rows]) => <>
            <div class="tgroup"><i style={`background:var(--t-${t || 'none'}, var(--line))`} />{t ? TYPE_LABEL[t as LessonType] : 'Без занятий'}<span class="sub" style="font-weight:400">{rows.length}</span></div>
            {rows.map((c) => <ClientRow c={c} onOpen={() => setOpen(c.id)} />)}
          </>)}
        </div>
      )}

      {adding && <AddClientSheet onClose={() => setAdding(false)} />}
      {cur && <ClientSheet c={cur} onClose={() => setOpen(null)} />}
    </>
  );
}

/* ---------- новый клиент ---------- */

export function AddClientSheet({ onClose }: { onClose: () => void }) {
  const [f, setF] = useState({ name: '', phone: '', isChild: false, parentName: '', note: '' });
  const [method, setMethod] = useState<ConsentMethod>('form');
  const [training, setTraining] = useState(false);
  const [health, setHealth] = useState(false);
  const [busy, setBusy] = useState(false);
  const signer = (f.isChild ? f.parentName : f.name).trim();
  const ok = f.name.trim() && (!f.isChild || f.parentName.trim()) && training;
  const set = (k: keyof typeof f) => (e: Event) => {
    const t = e.target as HTMLInputElement;
    setF({ ...f, [k]: t.type === 'checkbox' ? t.checked : t.value });
  };
  const save = async () => {
    setBusy(true);
    const ks = [{ kind: 'training' as const, method, signerName: signer }, ...(health ? [{ kind: 'health' as const, method, signerName: signer }] : [])];
    const c = await run(() => api.addClient({ name: f.name, phone: f.phone || null, isChild: f.isChild, parentName: f.parentName || null, note: f.note || null }, ks), 'Клиент добавлен');
    setBusy(false);
    if (c) { upsertClient(c); await refreshCoach(); onClose(); }
  };
  return (
    <Sheet title="Новый клиент" onClose={onClose}>
      <label class="field"><span>Имя и фамилия</span><input class="input" value={f.name} maxLength={80} onInput={set('name')} autoFocus /></label>
      <label class="field"><span>Телефон (для WhatsApp)</span><input class="input" type="tel" value={f.phone} maxLength={32} onInput={set('phone')} placeholder="+7 7__ ___ __ __" /></label>
      <label class="check"><input type="checkbox" checked={f.isChild} onChange={set('isChild')} /><span>Ребёнок до 18 лет</span></label>
      {f.isChild && <label class="field"><span>Родитель</span><input class="input" value={f.parentName} maxLength={80} onInput={set('parentName')} /></label>}
      <label class="field"><span>Заметка</span><textarea class="input" value={f.note} maxLength={2000} onInput={set('note')} /></label>

      <div class="card flat stack" style="gap:12px">
        <p class="eyebrow">Согласие {f.isChild ? 'родителя' : 'клиента'} на обработку данных</p>
        <label class="check"><input type="checkbox" checked={training} onChange={(e) => setTraining((e.target as HTMLInputElement).checked)} />
          <span><b>Данные для занятий</b><br /><span class="sub">имя, телефон, посещения, оплаты, замеры. Обязательно.</span></span></label>
        <label class="check"><input type="checkbox" checked={health} disabled={!training} onChange={(e) => setHealth((e.target as HTMLInputElement).checked)} />
          <span><b>Пульс и самочувствие</b><br /><span class="sub">отдельно, только если клиент согласен.</span></span></label>
        <label class="field"><span>Как получено</span>
          <select class="input" value={method} onChange={(e) => setMethod((e.target as HTMLSelectElement).value as ConsentMethod)}>
            <option value="form">Подписан бланк</option>
            <option value="written">Написал «согласен» в мессенджере</option>
          </select></label>
        {method === 'written' && <p class="tag wait" style="height:auto;padding:8px 12px;white-space:normal;line-height:18px">
          По закону РК (ст. 8 № 94-V) одного «согласен» в мессенджере мало. Надёжнее подписанный бланк.</p>}
        <p class="sub">Подписывает: {signer || '—'}. Дата ставится автоматически.</p>
      </div>
      <button class="btn lg block" disabled={!ok || busy} onClick={save}>Добавить клиента</button>
    </Sheet>
  );
}

/* ---------- строка клиента: абонемент, последние 8, следующее, оплата ---------- */

const DOW = ['вс', 'пн', 'вт', 'ср', 'чт', 'пт', 'сб'];
const MON = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];
const short = (iso: string) => { const d = new Date(`${iso}T00:00:00`); return `${DOW[d.getDay()]} ${d.getDate()} ${MON[d.getMonth()]}`; };
const pausedNow = (c: Client) => c.pauses.some((p) => p.from <= now.value.date && now.value.date <= p.to);
/** Нужна оплата: абонемент кончился или в долгу, а занятия есть или были. */
const needPay = (c: Client) => c.summary.remaining <= 0 && (c.summary.used > 0 || (!!c.summary.next && c.summary.next.kind !== 'trial'));

function byType(list: Client[]) {
  const order = [...LESSON_TYPES, null] as (LessonType | null)[];
  return order.map((t) => [t, list.filter((c) => (c.summary.type ?? null) === t)] as const).filter(([, rows]) => rows.length);
}

function Pack({ c }: { c: Client }) {
  const s = c.summary;
  if (s.remaining < 0) return <span style="color:var(--bad);font-weight:600;font-size:13px">долг {-s.remaining} зан.</span>;
  if (!s.paid) return <span class="empty-cell">{s.plan ? `по плану ${s.plan.total} зан. · не оплачено` : 'нет абонемента'}</span>;
  const used = s.paid - s.remaining, n = Math.min(s.paid, 12);
  return <span style={`--bar:var(--t-${s.type || 'individual'})`}>
    <span class="strip">{Array.from({ length: n }, (_, i) => <i class={i < Math.round((used / s.paid) * n) ? 'used' : ''} />)}</span>
    <span class="sub" style={s.remaining <= 1 ? 'color:var(--bad);font-weight:600' : ''}>{s.remaining ? `осталось ${s.remaining} из ${s.paid}` : 'закончился'}</span>
  </span>;
}

function PayTag({ c }: { c: Client }) {
  const s = c.summary;
  if (!active(c, 'training')) return <span class="tag bad">нет согласия</span>;
  if (pausedNow(c)) return <span class="tag">на паузе</span>;
  if (needPay(c)) return <span class="tag bad">нужна оплата</span>;
  if (s.paid && s.remaining <= 2) return <span class="tag wait">скоро оплата</span>;
  if (s.paid) return <span class="tag ok">оплачено</span>;
  if (s.next?.kind === 'trial') return <span class="tag info">пробное</span>;
  return <span class="tag">нет оплат</span>;
}

function ClientRow({ c, onOpen }: { c: Client; onOpen: () => void }) {
  const s = c.summary;
  return (
    <div class="trow" role="row" tabIndex={0} onClick={onOpen} onKeyDown={(e) => e.key === 'Enter' && onOpen()}>
      <div class="who"><span class="avatar">{initials(c.name)}</span>
        <span style="min-width:0"><b>{c.name}</b><span class="sub">{c.isChild ? `Ребёнок · ${c.parentName}` : 'Взрослый'}{c.archivedAt ? ' · в архиве' : ''}</span></span></div>
      <span class="c-pack"><Pack c={c} /></span>
      <span class="c-hist">{s.last.length ? <span class="stack" style="gap:4px">
        <span class="hist">{s.last.map((x) => <MarkChip cell={x} />)}</span>
        {s.unmarked > 0 && <span class="sub" style="color:var(--naples-deep)">не отмечено: {s.unmarked}</span>}
      </span> : <span class="empty-cell">истории пока нет</span>}</span>
      <span class="c-next">{s.next ? <span><b class="mono" style="font-size:13px">{short(s.next.date)}, {s.next.start}</b>
        {s.next.kind !== 'regular' && <span class="sub"><br />{s.next.kind === 'trial' ? 'пробное' : 'отработка'}</span>}</span> : <span class="empty-cell">—</span>}</span>
      <span><PayTag c={c} /></span>
    </div>
  );
}

/* ---------- группы ---------- */

function GroupsList() {
  const [edit, setEdit] = useState<JGroup | 'new' | null>(null);
  const list = groups.value.filter((g) => !g.archived);
  return (
    <div class="stack">
      <div class="row"><p class="sub grow" style="margin:0">Группа и мини-группа — от 1 человека. Новый состав попадает во все будущие занятия группы.</p>
        <button class="btn" onClick={() => setEdit('new')}>+ Группа</button></div>
      {list.length === 0 && <div class="card sub">Групп пока нет.</div>}
      {list.map((g) => (
        <button class="card row" style="border:0;text-align:left;cursor:pointer" onClick={() => setEdit(g)}>
          <i class="typebar" style={`background:var(--t-${g.type});height:36px`} />
          <span class="grow"><b>{g.name}</b><br /><span class="sub">{TYPE_LABEL[g.type]} · {g.memberIds.map((id) => clientName(id).split(' ')[0]).join(', ')}</span></span>
          <span class="tag">{g.memberIds.length} чел.</span>
        </button>
      ))}
      {edit && <GroupSheet g={edit === 'new' ? null : edit} onClose={() => setEdit(null)} />}
    </div>
  );
}

function GroupSheet({ g, onClose }: { g: JGroup | null; onClose: () => void }) {
  const [name, setName] = useState(g?.name || '');
  const [type, setType] = useState<LessonType>(g?.type || 'group');
  const [ids, setIds] = useState<string[]>(g?.memberIds || []);
  const save = async (archived = false) => {
    const r = await run(() => api.saveGroup({ id: g?.id, name, type, memberIds: ids, archived }), archived ? 'Группа в архиве' : 'Группа сохранена');
    if (r) { groups.value = [...groups.value.filter((x) => x.id !== r.id), r]; await refresh(); onClose(); }
  };
  return (
    <Sheet title={g ? 'Группа' : 'Новая группа'} onClose={onClose}>
      <label class="field"><span>Название</span><input class="input" value={name} maxLength={80} onInput={(e) => setName((e.target as HTMLInputElement).value)} /></label>
      <div class="seg" style="align-self:flex-start">
        <button aria-pressed={type === 'group'} onClick={() => setType('group')}>Группа</button>
        <button aria-pressed={type === 'minigroup'} onClick={() => setType('minigroup')}>Мини-группа</button>
      </div>
      <div class="card flat" style="padding:4px 16px;max-height:320px;overflow:auto">
        {clients.value.filter((c) => !c.archivedAt).map((c) => <label class="check" style="padding:8px 0">
          <input type="checkbox" checked={ids.includes(c.id)} onChange={() => setIds(ids.includes(c.id) ? ids.filter((x) => x !== c.id) : [...ids, c.id])} /><span>{c.name}</span></label>)}
      </div>
      <button class="btn lg block" disabled={!name.trim() || !ids.length} onClick={() => save()}>Сохранить · {ids.length} чел.</button>
      {g && <button class="btn ghost" onClick={() => save(true)}>Убрать в архив</button>}
    </Sheet>
  );
}

/* ---------- карточка клиента ---------- */

function ClientSheet({ c, onClose }: { c: Client; onClose: () => void }) {
  const [tab, setTab] = useState<'visits' | 'plan' | 'payments' | 'notes' | 'data'>('visits');
  return (
    <Sheet onClose={onClose} head={<>
      <span class="avatar lg">{initials(c.name)}</span>
      <div><h2 class="h2" style="font-size:24px">{c.name}</h2><p class="sub" style="margin:2px 0 0">{c.isChild ? `Ребёнок · ${c.parentName}` : 'Взрослый'}{c.phone ? ` · ${c.phone}` : ''}</p></div>
    </>}>
      <div class="row" style="gap:8px"><Pack c={c} /><PayTag c={c} /></div>
      <div class="tabs" role="tablist" style="overflow-x:auto">
        {([['visits', 'Посещения'], ['plan', 'Абонемент'], ['payments', 'Оплаты'], ['notes', 'Заметки'], ['data', 'Данные']] as const).map(([k, l]) =>
          <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'visits' && <MonthGrid c={c} />}
      {tab === 'plan' && <PlanTab c={c} />}
      {tab === 'payments' && <p class="sub">Отметка оплаты в два касания — на этапе 2. Сейчас остаток считается по оплатам, поэтому без них отмеченные занятия видны как долг.</p>}
      {tab === 'notes' && <p style="white-space:pre-wrap;margin:0">{c.note || <span class="sub">Заметок нет. Добавьте во вкладке «Данные».</span>}</p>}
      {tab === 'data' && <ClientData c={c} onClose={onClose} />}
    </Sheet>
  );
}

function MonthGrid({ c }: { c: Client }) {
  const [month, setMonth] = useState(now.value.date.slice(0, 7));
  const [list, setList] = useState<JLesson[] | null>(null);
  const first = `${month}-01`, days = new Date(+month.slice(0, 4), +month.slice(5, 7), 0).getDate(), last = `${month}-${String(days).padStart(2, '0')}`;
  useEffect(() => { setList(null); api.lessons(first, last).then((r) => setList(r.lessons.filter((l) => l.clientIds.includes(c.id)))).catch(() => setList([])); }, [month, c.id]);
  const lead = weekday(first);
  const shift = (k: number) => { const d = new Date(+month.slice(0, 4), +month.slice(5, 7) - 1 + k, 1); setMonth(`${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`); };
  const name = new Date(`${first}T00:00:00`).toLocaleString('ru', { month: 'long', year: 'numeric' });
  return (
    <div class="card flat">
      <div class="row" style="margin-bottom:12px"><button class="btn tint sm" onClick={() => shift(-1)} aria-label="Прошлый месяц">‹</button>
        <p class="eyebrow grow" style="text-align:center">{name}{list ? ` · занятий ${list.filter((l) => !l.cancelled).length}` : ''}</p>
        <button class="btn tint sm" onClick={() => shift(1)} aria-label="Следующий месяц">›</button></div>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center">
        {WEEKDAYS.map((w) => <span class="sub">{w}</span>)}
        {Array.from({ length: lead }, () => <span />)}
        {Array.from({ length: days }, (_, i) => {
          const iso = `${month}-${String(i + 1).padStart(2, '0')}`, ls = (list || []).filter((l) => l.date === iso);
          return <span class="stack" style={`gap:2px;align-items:center;padding:4px 0;border-radius:8px;${iso === now.value.date ? 'background:var(--prussian-tint)' : ''}`}>
            <span class="mono" style={`font-size:12px;color:${ls.length ? 'var(--ink)' : 'var(--ink-4)'}`}>{i + 1}</span>
            {ls.map((l) => <MarkChip cell={cellIn(l, c.id)} title={`${l.start} ${TYPE_LABEL[l.type]}`} />)}
          </span>;
        })}
      </div>
    </div>
  );
}

/* ---------- абонемент → расписание, паузы ---------- */

function PlanTab({ c }: { c: Client }) {
  const progs = programs.value.filter((p) => !p.archived && !isGroupish(p.type));
  const prev = c.summary.plan;
  const [programId, setProgram] = useState(prev?.programId || progs[0]?.id || '');
  const [total, setTotal] = useState(prev?.total || 8);
  const [startsOn, setStart] = useState(now.value.date);
  const [slots, setSlots] = useState<Record<string, string>>(prev?.slots || { 0: '18:00', 3: '18:00' });
  const [lane, setLane] = useState('');
  const [replace, setReplace] = useState(true);
  const [sets, setSets] = useState<Record<string, string>[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [pause, setPause] = useState({ from: now.value.date, to: addDays(now.value.date, 7) });
  const groupsOf = groups.value.filter((g) => !g.archived && g.memberIds.includes(c.id));
  const body = () => ({ programId: programId || null, type: programId ? undefined : 'individual' as LessonType, total, startsOn, slots, lane: lane || null, replace, clientId: c.id });
  const toggleDay = (d: number) => {
    const k = String(d), next = { ...slots };
    if (next[k]) delete next[k]; else next[k] = Object.values(slots)[0] || '18:00';
    setSlots(next); setSets(null);
  };
  const suggest = async () => { setBusy(true); setSets(await run(() => api.suggest({ ...body(), perWeek: Math.max(1, Object.keys(slots).length) }))); setBusy(false); };
  const apply = async () => {
    setBusy(true);
    const r = await run(() => api.plan(c.id, body()));
    setBusy(false);
    if (r) { await refresh(); run(async () => {}, `В расписании ${r.created} занятий${r.removed ? `, убрано старых: ${r.removed}` : ''}`); }
  };
  const addPause = async () => { if (await run(() => api.addPause(c.id, pause.from, pause.to), 'Пауза добавлена')) refresh(); };
  const delPause = async (id: string) => { if (await run(() => api.deletePause(c.id, id).then(() => true), 'Пауза убрана')) refresh(); };
  const k = Object.keys(slots).length, label = Object.keys(slots).sort().map((d) => `${WEEKDAYS[+d]} ${slots[d]}`).join(', ');
  return (
    <div class="stack">
      {groupsOf.length > 0 && <p class="tag info" style="align-self:flex-start;height:auto;padding:6px 12px">В группе: {groupsOf.map((g) => g.name).join(', ')} — дни задаёт группа</p>}
      <div class="card flat stack" style="gap:12px">
        <p class="eyebrow">Тренировки по абонементу</p>
        <p class="sub" style="margin:0">Сколько занятий и в какие дни, у каждого дня своё время. Встанут ровно столько, сколько куплено, без продления; отпуск пропускается.</p>
        <label class="field"><span>Программа</span>
          <select class="input" value={programId} onChange={(e) => { setProgram((e.target as HTMLSelectElement).value); setSets(null); }}>
            {progs.map((p) => <option value={p.id}>{p.name} · {p.dur} мин</option>)}
            {!progs.length && <option value="">Индивидуальное · 45 мин</option>}
          </select></label>
        <div class="row">
          <label class="field" style="width:120px"><span>Занятий</span><input class="input mono" type="number" min={1} max={60} value={total} onInput={(e) => { setTotal(Math.max(1, +(e.target as HTMLInputElement).value || 1)); setSets(null); }} /></label>
          <label class="field grow"><span>С какого дня</span><input class="input" type="date" value={startsOn} onInput={(e) => { setStart((e.target as HTMLInputElement).value); setSets(null); }} /></label>
          <label class="field" style="width:110px"><span>Дорожка</span><input class="input" value={lane} maxLength={20} onInput={(e) => setLane((e.target as HTMLInputElement).value)} /></label>
        </div>
        <div class="slotgrid" role="group" aria-label="Дни недели и время">
          {WEEKDAYS.map((w, i) => <div class="slot">
            <button type="button" class={`day${slots[i] ? ' on' : ''}`} aria-pressed={!!slots[i]} onClick={() => toggleDay(i)}>{w}</button>
            {slots[i] && <input class="input mono" type="time" step={600} value={slots[i]} aria-label={`Время, ${w}`}
              onInput={(e) => { setSlots({ ...slots, [i]: (e.target as HTMLInputElement).value }); setSets(null); }} />}
          </div>)}
        </div>
        <p class="sub" style="margin:0">{k ? `По ${k} в неделю: ${label}. Всего ${total} занятий, дальше не продлевается.` : 'Отметьте дни недели.'}</p>
        {c.summary.next && <label class="check"><input type="checkbox" checked={replace} onChange={(e) => setReplace((e.target as HTMLInputElement).checked)} /><span>Убрать уже запланированные неотмеченные занятия</span></label>}
        <div class="row">
          <button class="btn tint" disabled={busy || !k} onClick={suggest}>Подобрать свободное время</button>
          <button class="btn" disabled={busy || !k} onClick={apply}>Поставить в расписание</button>
        </div>
        {sets && (sets.length
          ? <div class="stack" style="gap:8px"><span class="sub">Свободно на все даты — нажмите, чтобы подставить:</span>
            <div class="row" style="gap:6px">{sets.map((s) => <button class="chip" onClick={() => { setSlots(s); setSets(null); }}>
              {Object.keys(s).sort().map((d) => `${WEEKDAYS[+d]} ${s[d]}`).join(', ')}</button>)}</div></div>
          : <p class="sub" style="margin:0">Свободного времени на все {total} занятий не нашлось. Сдвиньте начало, уменьшите дни или расширьте рабочие часы.</p>)}
      </div>

      <div class="card flat stack" style="gap:10px">
        <p class="eyebrow">Пауза</p>
        <p class="sub" style="margin:0">Занятия на паузе не списываются и не ждут клиента. Отметки до паузы остаются.</p>
        {c.pauses.map((p) => <div class="row"><span class="grow mono">{p.from} — {p.to}</span><button class="btn ghost sm" onClick={() => delPause(p.id)}>Убрать</button></div>)}
        <div class="row">
          <input class="input" type="date" value={pause.from} style="width:auto" aria-label="Пауза с" onInput={(e) => setPause({ ...pause, from: (e.target as HTMLInputElement).value })} />
          <span>—</span>
          <input class="input" type="date" value={pause.to} style="width:auto" aria-label="Пауза по" onInput={(e) => setPause({ ...pause, to: (e.target as HTMLInputElement).value })} />
          <button class="btn tint" onClick={addPause}>Добавить</button>
        </div>
      </div>
    </div>
  );
}

function ClientData({ c, onClose }: { c: Client; onClose: () => void }) {
  const [f, setF] = useState({ name: c.name, phone: c.phone || '', isChild: c.isChild, parentName: c.parentName || '', note: c.note || '' });
  const [confirmDel, setConfirmDel] = useState(false);
  const set = (k: keyof typeof f) => (e: Event) => { const t = e.target as HTMLInputElement; setF({ ...f, [k]: t.type === 'checkbox' ? t.checked : t.value }); };
  const save = async () => {
    const r = await run(() => api.saveClient(c.id, { name: f.name, phone: f.phone || null, isChild: f.isChild, parentName: f.parentName || null, note: f.note || null }), 'Сохранено');
    if (r) upsertClient(r);
  };
  const mutate = async (p: () => Promise<Client>, msg: string) => { const r = await run(p, msg); if (r) { upsertClient(r); await refreshCoach(); } };
  const del = async () => {
    const ok = await run(() => api.deleteClient(c.id).then(() => true), 'Клиент удалён навсегда');
    if (ok) { clients.value = clients.value.filter((x) => x.id !== c.id); onClose(); }
  };
  const signer = c.isChild ? c.parentName || '' : c.name;
  return (
    <div class="stack">
      <label class="field"><span>Имя и фамилия</span><input class="input" value={f.name} maxLength={80} onInput={set('name')} /></label>
      <label class="field"><span>Телефон</span><input class="input" type="tel" value={f.phone} maxLength={32} onInput={set('phone')} /></label>
      <label class="check"><input type="checkbox" checked={f.isChild} onChange={set('isChild')} /><span>Ребёнок до 18 лет</span></label>
      {f.isChild && <label class="field"><span>Родитель</span><input class="input" value={f.parentName} maxLength={80} onInput={set('parentName')} /></label>}
      <label class="field"><span>Заметка</span><textarea class="input" value={f.note} maxLength={2000} onInput={set('note')} /></label>
      <button class="btn" onClick={save}>Сохранить</button>

      <div class="card flat">
        <p class="eyebrow">Согласия</p>
        {c.consents.map((k) => <ConsentRow c={c} k={k} onRevoke={() => mutate(() => api.revokeConsent(c.id, k.id), 'Согласие отозвано, данные удалены')} />)}
        {!active(c, 'health') && active(c, 'training') && <button class="btn tint sm" style="margin-top:12px"
          onClick={() => mutate(() => api.addConsent(c.id, { kind: 'health', method: 'form', signerName: signer }), 'Согласие добавлено')}>+ Пульс и самочувствие (бланк подписан)</button>}
        {!active(c, 'training') && <button class="btn tint sm" style="margin-top:12px"
          onClick={() => mutate(() => api.addConsent(c.id, { kind: 'training', method: 'form', signerName: signer }), 'Согласие добавлено')}>+ Данные для занятий (бланк подписан)</button>}
      </div>

      {c.archivedAt
        ? <div class="row">
          <button class="btn tint" onClick={() => mutate(() => api.restore(c.id), 'Клиент вернулся из архива')}>Вернуть из архива</button>
          {!confirmDel ? <button class="btn ghost" style="color:var(--bad)" onClick={() => setConfirmDel(true)}>Удалить навсегда</button>
            : <button class="btn danger" onClick={del}>Да, удалить всё о клиенте</button>}
        </div>
        : <button class="btn ghost" onClick={() => mutate(() => api.archive(c.id), 'Клиент в архиве')}>Убрать в архив</button>}
      {confirmDel && <p class="sub">Удалятся имя, согласия, отметки, оплаты и фото чеков. Вернуть нельзя.</p>}
    </div>
  );
}

function ConsentRow({ k, onRevoke }: { c: Client; k: ClientConsent; onRevoke: () => void }) {
  const [ask, setAsk] = useState(false);
  return (
    <div class="consent">
      <div class="grow">
        <b>{k.kind === 'training' ? 'Данные для занятий' : 'Пульс и самочувствие'}</b>
        <div class="sub">{k.signerName}{k.signedBy === 'parent' ? ' (родитель)' : ''} · {METHOD[k.method]} · {new Date(k.givenAt).toLocaleDateString('ru')}</div>
        {k.revokedAt && <div class="sub" style="color:var(--bad)">отозвано {new Date(k.revokedAt).toLocaleDateString('ru')}</div>}
      </div>
      {!k.revokedAt && (ask
        ? <button class="btn danger sm" onClick={onRevoke}>Отозвать и удалить данные</button>
        : <button class="btn ghost sm" onClick={() => setAsk(true)}>Отозвать</button>)}
    </div>
  );
}

/* ---------- лист ---------- */

export function Sheet({ title, head, onClose, children }: { title?: string; head?: preact.ComponentChildren; onClose: () => void; children: preact.ComponentChildren }) {
  return (
    <div class="scrim" onClick={(e) => e.target === e.currentTarget && onClose()} onKeyDown={(e) => e.key === 'Escape' && onClose()}>
      <div class="sheet" role="dialog" aria-modal="true" aria-label={title}>
        <div class="sheet-head">{head || <h2 class="h2">{title}</h2>}<button class="close" aria-label="Закрыть" onClick={onClose}>×</button></div>
        {children}
      </div>
    </div>
  );
}
