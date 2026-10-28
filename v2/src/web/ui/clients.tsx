// «Клиенты» — основной экран журнала (холст 1.1): у кого сколько осталось и кто должен.
// Абонементы, посещения и оплаты появятся на этапах 1–2; пока ячейки показывают пустые состояния из макета.
import { useState } from 'preact/hooks';
import type { Client, ClientConsent, ConsentMethod } from '../../shared/types';
import { api, clients, coach, refreshCoach, run, upsertClient } from '../state';
import { initials } from './entry';

const MONTH = ['январе', 'феврале', 'марте', 'апреле', 'мае', 'июне', 'июле', 'августе', 'сентябре', 'октябре', 'ноябре', 'декабре'];
const METHOD: Record<string, string> = { form: 'бланк подписан', written: 'письменно в мессенджере', link: 'по ссылке' };
const active = (c: Client, kind: string) => c.consents.some((k) => k.kind === kind && !k.revokedAt);

export function ClientsPage() {
  const [filter, setFilter] = useState<'all' | 'kids' | 'archive'>('all');
  const [q, setQ] = useState('');
  const [open, setOpen] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const me = coach.value!;
  const list = clients.value.filter((c) => (filter === 'archive' ? !!c.archivedAt : !c.archivedAt && (filter === 'all' || c.isChild)))
    .filter((c) => !q || c.name.toLowerCase().includes(q.toLowerCase()));
  const act = clients.value.filter((c) => !c.archivedAt);
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
        <div class="kpi"><p class="eyebrow">Посещаемость</p><b>—</b><span class="sub">отметок пока нет</span></div>
        <div class="kpi"><p class="eyebrow">Активные клиенты</p><b class="mono">{act.length}{me.limit ? <span class="sub" style="font-family:var(--font-sans)"> из {me.limit}</span> : null}</b>
          <span class="sub">{me.limit ? 'бесплатный тариф' : 'подписка'}</span></div>
      </div>

      <div class="row" style="margin-bottom:12px">
        <button class="chip" aria-pressed={filter === 'all'} onClick={() => setFilter('all')}>Все <span class="n">{act.length}</span></button>
        <button class="chip" aria-pressed={filter === 'kids'} onClick={() => setFilter('kids')}>Дети <span class="n">{act.filter((c) => c.isChild).length}</span></button>
        <button class="chip" aria-pressed={filter === 'archive'} onClick={() => setFilter('archive')}>Архив <span class="n">{clients.value.length - act.length}</span></button>
      </div>

      <div class="table" role="table" aria-label="Клиенты">
        <div class="thead" role="row"><span>Клиент</span><span>Абонемент</span><span>Последние 8 занятий</span><span>Следующее</span><span>Оплата</span></div>
        {list.length === 0 && <div style="padding:40px 20px;text-align:center" class="sub">
          {filter === 'archive' ? 'В архиве пусто.' : q ? 'Никого не нашли.' : 'Клиентов пока нет. Нажмите «+ Клиент».'}</div>}
        {list.map((c) => (
          <div class="trow" role="row" tabIndex={0} onClick={() => setOpen(c.id)} onKeyDown={(e) => e.key === 'Enter' && setOpen(c.id)}>
            <div class="who"><span class="avatar">{initials(c.name)}</span>
              <span style="min-width:0"><b>{c.name}</b><span class="sub">{c.isChild ? `Ребёнок · ${c.parentName}` : 'Взрослый'}{c.archivedAt ? ' · в архиве' : ''}</span></span></div>
            <span class="c-pack empty-cell">нет абонемента</span>
            <span class="c-hist empty-cell">истории пока нет</span>
            <span class="c-next empty-cell">—</span>
            <span>{active(c, 'training') ? <span class="tag">нет оплат</span> : <span class="tag bad">нет согласия</span>}</span>
          </div>
        ))}
      </div>

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

/* ---------- карточка клиента ---------- */

function ClientSheet({ c, onClose }: { c: Client; onClose: () => void }) {
  const [tab, setTab] = useState<'visits' | 'payments' | 'notes' | 'data'>('visits');
  return (
    <Sheet onClose={onClose} head={<>
      <span class="avatar lg">{initials(c.name)}</span>
      <div><h2 class="h2" style="font-size:24px">{c.name}</h2><p class="sub" style="margin:2px 0 0">{c.isChild ? `Ребёнок · ${c.parentName}` : 'Взрослый'}{c.phone ? ` · ${c.phone}` : ''}</p></div>
    </>}>
      <div class="tabs" role="tablist">
        {([['visits', 'Посещения'], ['payments', 'Оплаты'], ['notes', 'Заметки'], ['data', 'Данные']] as const).map(([k, l]) =>
          <button role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>{l}</button>)}
      </div>
      {tab === 'visits' && <MonthGrid />}
      {tab === 'payments' && <p class="sub">Оплат пока нет. Отметка оплаты в два касания появится на этапе 2.</p>}
      {tab === 'notes' && <p style="white-space:pre-wrap;margin:0">{c.note || <span class="sub">Заметок нет. Добавьте во вкладке «Данные».</span>}</p>}
      {tab === 'data' && <ClientData c={c} onClose={onClose} />}
    </Sheet>
  );
}

function MonthGrid() {
  const d = new Date(), days = new Date(d.getFullYear(), d.getMonth() + 1, 0).getDate();
  const lead = (new Date(d.getFullYear(), d.getMonth(), 1).getDay() + 6) % 7;
  return (
    <div class="card flat">
      <p class="eyebrow" style="margin-bottom:12px">{d.toLocaleString('ru', { month: 'long' })} · занятий пока нет</p>
      <div style="display:grid;grid-template-columns:repeat(7,1fr);gap:6px;text-align:center">
        {['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'].map((w) => <span class="sub">{w}</span>)}
        {Array.from({ length: lead }, () => <span />)}
        {Array.from({ length: days }, (_, i) => <span class="mono" style={`padding:6px 0;border-radius:8px;${i + 1 === d.getDate() ? 'background:var(--prussian-tint);color:var(--prussian)' : 'color:var(--ink-4)'}`}>{i + 1}</span>)}
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
