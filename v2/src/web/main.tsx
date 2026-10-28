import './styles.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { COACH_CONSENT_VERSION } from '../shared/types';
import { ApiError } from './api';
import { api, coach, go, isDemo, loadAll, route, toast } from './state';
import { Icon, Mark } from './ui/brand';
import { ClientsPage } from './ui/clients';
import { Boot, Consent, Login, Onboarding, initials } from './ui/entry';
import { JournalPage, PaymentsPage, SettingsPage, TodayPage } from './ui/pages';

const TABS = [
  ['today', 'Сегодня', Icon.today],
  ['journal', 'Журнал', Icon.journal],
  ['clients', 'Клиенты', Icon.clients],
  ['payments', 'Оплаты', Icon.payments],
  ['settings', 'Настройки', Icon.settings],
] as const;
// На телефоне четыре вкладки: «Оплаты» и «Настройки» под «Ещё».
const PHONE = [TABS[0], TABS[1], TABS[2], ['more', 'Ещё', Icon.more]] as const;

function Shell() {
  const r = route.value.split('?')[0], me = coach.value!;
  const page = r === 'journal' ? <JournalPage /> : r === 'clients' ? <ClientsPage /> : r === 'payments' ? <PaymentsPage />
    : r === 'settings' ? <SettingsPage /> : r === 'more' ? <More /> : <TodayPage />;
  const cur = (k: string) => (k === r || (k === 'more' && ['payments', 'settings', 'more'].includes(r)) ? 'page' : undefined);
  return (
    <div class="shell">
      <aside class="side">
        <a class="logo" href="#/today"><Mark size={34} />Дорожка</a>
        <nav aria-label="Разделы">{TABS.map(([k, l, I]) => <a href={`#/${k}`} aria-current={cur(k)}><I />{l}</a>)}</nav>
        <div class="who"><span class="avatar">{initials(me.name || me.email)}</span>
          <span style="min-width:0"><b style="display:block;overflow:hidden;text-overflow:ellipsis">{me.name || 'Тренер'}</b><span class="sub">{me.settings.pool.name || me.email}</span></span></div>
      </aside>
      <main class="main" id="main">{page}</main>
      <nav class="tabbar" aria-label="Разделы">{PHONE.map(([k, l, I]) => <a href={`#/${k}`} aria-current={cur(k)}><I />{l}</a>)}</nav>
    </div>
  );
}

function More() {
  return (
    <div class="stack">
      <h1 class="display">Ещё</h1>
      <button class="card row" style="border:0;text-align:left;cursor:pointer" onClick={() => go('payments')}><Icon.payments /><b class="grow">Оплаты</b>›</button>
      <button class="card row" style="border:0;text-align:left;cursor:pointer" onClick={() => go('settings')}><Icon.settings /><b class="grow">Настройки</b>›</button>
    </div>
  );
}

function App() {
  const [state, setState] = useState<'boot' | 'login' | 'ready' | 'error'>('boot');
  useEffect(() => {
    api.me().then(async (me) => {
      coach.value = me;
      if (me.consent?.version === COACH_CONSENT_VERSION) await loadAll();
      setState('ready');
    }).catch((e) => setState(e instanceof ApiError && e.status === 401 ? 'login' : 'error'));
  }, []);
  const me = coach.value;
  // После согласия подгрузить программы и клиентов.
  useEffect(() => { if (state === 'ready' && me?.consent) loadAll().catch(() => {}); }, [me?.consent?.version]);

  let body;
  if (state === 'boot') body = <Boot />;
  else if (state === 'login') body = <Login />;
  else if (state === 'error' || !me) body = <div class="solo-body"><h1 class="h2">Нет связи с сервером</h1><button class="btn" onClick={() => location.reload()}>Обновить</button></div>;
  else if (me.consent?.version !== COACH_CONSENT_VERSION) body = <Consent />;
  else if (!me.settings.onboarded) body = <Onboarding />;
  else body = <Shell />;
  return <>
    {isDemo && <div class="demo-bar">Демо: данные выдуманы и живут только в этой вкладке</div>}
    {body}
    {toast.value && <div class="toast" role="status">{toast.value}</div>}
  </>;
}

render(<App />, document.getElementById('app')!);
