// Правила учёта. Первая часть — тесты старого журнала (test/schedule.test.mjs), перенесённые один к одному;
// вторая — расписание по абонементу, подбор времени, отметки и сводка клиента.
import { describe, expect, it } from 'vitest';
import {
  applyPlan, balance, charged, createLessons, planDates, remaining, setMark, suggestSets, summary, syncGroup, syncMakeup,
  type JLesson, type JPayment, type Journal,
} from '../src/shared/rules';
import { DEFAULT_SETTINGS } from '../src/shared/types';

let n = 0;
const sess = (o: Partial<JLesson> = {}): JLesson => ({
  id: `s${++n}`, date: '2026-10-19', start: '10:00', dur: 45, type: 'individual', kind: 'regular', groupId: null, planId: null, extOf: null,
  place: 'Дорожка 5', lane: null, log: '', nextNote: '', cancelled: false, clientIds: ['c1'], att: {}, reasons: {}, ...o,
});
const state = (o: Partial<Journal> = {}): Journal => ({
  clients: [
    { id: 'c1', name: 'Аня Петрова', archived: false, pauses: [], plan: { id: 'p1', slots: { 0: '10:00', 2: '10:00' }, total: 8, startsOn: '2026-10-01', programId: null } },
    { id: 'c2', name: 'Борис', archived: false, pauses: [], plan: null },
  ],
  groups: [], lessons: [], payments: [], vacations: [],
  settings: { chargeNoShow: true, breakMin: 10, stepMin: 15, week: DEFAULT_SETTINGS.week },
  ...o,
});
const pay = (o: Partial<JPayment> = {}): JPayment => ({ id: `p${++n}`, clientId: 'c1', withId: null, date: '2026-10-01', sessions: 8, amount: 50000, until: null, ...o });
const NOW = { date: '2026-10-18', min: 9 * 60 };

describe('остаток (из старого журнала)', () => {
  it('оплачено минус списанные занятия', () => {
    const J = state({
      payments: [pay({ sessions: 8 }), pay({ sessions: 1, clientId: 'c2', withId: 'c1' })],
      lessons: [
        sess({ att: { c1: 'present' } }), sess({ att: { c1: 'absent' } }), sess({ att: { c1: 'excused' } }),
        sess({ att: { c1: 'present' }, kind: 'trial' }), sess({ att: { c1: 'present' }, cancelled: true }), sess(),
      ],
    });
    // 9 оплачено (8 + общая оплата пары), «был» и «не предупредил» списаны, остальное нет.
    expect(remaining(J, 'c1')).toBe(7);
  });
  it('«не предупредил» не списывается, если chargeNoShow выключен', () => {
    const J = state({ payments: [pay({ sessions: 2 })], lessons: [sess({ att: { c1: 'absent' } })] });
    expect(remaining(J, 'c1')).toBe(1);
    J.settings.chargeNoShow = false;
    expect(remaining(J, 'c1')).toBe(2);
  });
  it('charged: пробное не списывается никогда, предупредил — тоже', () => {
    const J = state();
    expect(charged(J, sess({ att: { c1: 'absent' } }), 'c1')).toBe(true);
    expect(charged(J, sess({ att: { c1: 'excused' } }), 'c1')).toBe(false);
    expect(charged(J, sess({ att: { c1: 'present' }, kind: 'trial' }), 'c1')).toBe(false);
  });
  it('срок старой оплаты: занятия после даты не списываются с неё, остаток сгорает', () => {
    const J = state({
      payments: [pay({ date: '2026-09-01', sessions: 4, until: '2026-09-30' }), pay({ date: '2026-10-01', sessions: 8 })],
      lessons: [sess({ date: '2026-09-10', att: { c1: 'present' } }), sess({ date: '2026-10-05', att: { c1: 'present' } })],
    });
    const b = balance(J, 'c1', '2026-10-19');
    expect([b.remaining, b.burned, b.paid, b.aPaid, b.until]).toEqual([7, 3, 12, 8, null]);
    const early = balance(J, 'c1', '2026-09-20');
    expect([early.remaining, early.until]).toEqual([10, '2026-09-30']);
  });
  it('долг уходит в минус', () => {
    expect(remaining(state({ lessons: [sess({ att: { c1: 'present' } })] }), 'c1')).toBe(-1);
  });
});

describe('отработка (из старого журнала)', () => {
  it('все предупредили — отработка в ближайший свободный день плана после серии', () => {
    const s = sess({ date: '2026-10-19', att: { c1: 'excused' } });
    const J = state({ lessons: [s, sess({ date: '2026-10-21' }), sess({ date: '2026-10-26', clientIds: ['c2'] })] });
    const { add } = syncMakeup(J, s);
    // Понедельник 26-го занят другим клиентом в то же время, следующий день плана — среда 28-го.
    expect(add).toMatchObject({ date: '2026-10-28', start: '10:00', kind: 'makeup', extOf: s.id });
    expect(syncMakeup(J, s).add).toBe(add);
    expect(J.lessons.filter((x) => x.extOf === s.id)).toHaveLength(1);
  });
  it('снятие отметки убирает неотмеченную отработку', () => {
    const s = sess({ att: { c1: 'excused' } });
    const J = state({ lessons: [s] });
    const { add } = syncMakeup(J, s);
    s.att = {};
    const r = syncMakeup(J, s);
    expect(r.add).toBeNull();
    expect(r.ch.remove).toEqual([add!.id]);
    expect(J.lessons).toHaveLength(1);
  });
  it('отмеченная отработка остаётся', () => {
    const s = sess({ att: { c1: 'excused' } });
    const J = state({ lessons: [s] });
    const { add } = syncMakeup(J, s);
    add!.att = { c1: 'present' };
    s.att = { c1: 'present' };
    syncMakeup(J, s);
    expect(J.lessons).toContain(add);
  });
  it('группы и пробные не продлеваются', () => {
    const g = sess({ groupId: 'g1', type: 'group', att: { c1: 'excused' } });
    const t = sess({ kind: 'trial', att: { c1: 'excused' } });
    const J = state({ lessons: [g, t] });
    expect(syncMakeup(J, g).add).toBeNull();
    expect(syncMakeup(J, t).add).toBeNull();
    expect(J.lessons).toHaveLength(2);
  });
  it('клиент на паузе не мешает отработке, если остальные предупредили', () => {
    const J = state();
    J.clients[1].pauses = [{ id: 'x', from: '2026-10-01', to: '2026-10-31' }];
    const s = sess({ type: 'split', clientIds: ['c1', 'c2'], att: { c1: 'excused' } });
    J.lessons.push(s);
    expect(syncMakeup(J, s).add).toBeTruthy();
  });
  it('не все предупредили — отработки нет', () => {
    const s = sess({ type: 'split', clientIds: ['c1', 'c2'], att: { c1: 'excused', c2: 'present' } });
    expect(syncMakeup(state({ lessons: [s] }), s).add).toBeNull();
  });
  it('дни отпуска тренера пропускаются', () => {
    const s = sess({ date: '2026-10-19', att: { c1: 'excused' } });
    const J = state({ lessons: [s], vacations: [{ id: 'v', from: '2026-10-20', to: '2026-10-27' }] });
    expect(syncMakeup(J, s).add!.date).toBe('2026-10-28');
  });
});

describe('отметка', () => {
  it('ставит, меняет и снимает; «предупредил» добавляет отработку, снятие убирает', () => {
    const s = sess();
    const J = state({ lessons: [s] });
    setMark(J, s.id, 'c1', 'present', null);
    expect(s.att.c1).toBe('present');
    const r = setMark(J, s.id, 'c1', 'excused', 'болеет');
    expect(r.makeup).toBeTruthy();
    expect(s.reasons.c1).toBe('болеет');
    const off = setMark(J, s.id, 'c1', null, null);
    expect(s.att.c1).toBeUndefined();
    expect(off.changes.remove).toEqual([r.makeup!.id]);
  });
  it('чужой клиент или занятие отклоняются', () => {
    const s = sess();
    const J = state({ lessons: [s] });
    expect(() => setMark(J, s.id, 'c2', 'present', null)).toThrow();
    expect(() => setMark(J, 'nope', 'c1', 'present', null)).toThrow();
  });
});

describe('расписание по абонементу', () => {
  it('ровно n занятий по дням плана, отпуск пропускается', () => {
    const J = state({ vacations: [{ id: 'v', from: '2026-10-21', to: '2026-10-21' }] });
    // С понедельника 19-го, по пн и ср: 19, (21 — отпуск), 26, 28.
    expect(planDates(J, '2026-10-19', [0, 2], 3)).toEqual(['2026-10-19', '2026-10-26', '2026-10-28']);
    expect(planDates(J, '2026-10-19', [], 3)).toEqual([]);
  });
  it('applyPlan ставит занятия и заменяет старые неотмеченные', () => {
    const old = sess({ date: '2026-10-20', clientIds: ['c1'] });
    const shared = sess({ date: '2026-10-22', type: 'split', clientIds: ['c1', 'c2'] });
    const marked = sess({ date: '2026-10-23', att: { c1: 'present' } });
    const J = state({ lessons: [old, shared, marked] });
    const r = applyPlan(J, 'c1', { total: 4, perWeek: 2, startsOn: '2026-10-19', slots: { 1: '18:00', 3: '18:30' }, dur: 45, type: 'individual', place: '', lane: '1', programId: null, replace: true }, NOW);
    expect(r.created).toBe(4);
    expect(r.changes.remove).toEqual([old.id]);
    expect(shared.clientIds).toEqual(['c2']);
    expect(J.lessons).toContain(marked);
    const mine = J.lessons.filter((l) => l.planId === r.plan.id).map((l) => `${l.date} ${l.start}`);
    expect(mine).toEqual(['2026-10-20 18:00', '2026-10-22 18:30', '2026-10-27 18:00', '2026-10-29 18:30']);
  });
  it('группы по абонементу не планируются', () => {
    expect(() => applyPlan(state(), 'c1', { total: 4, perWeek: 1, startsOn: '2026-10-19', slots: { 0: '10:00' }, dur: 45, type: 'group', place: '', lane: null, programId: null, replace: false }, NOW)).toThrow();
  });
  it('подбор времени: свободно на все даты, одно время во все дни первым', () => {
    // Пн занят 18:00–18:45 весь месяц: подбор обходит его с перерывом.
    const busy = ['2026-10-19', '2026-10-26', '2026-11-02', '2026-11-09'].map((date) => sess({ date, start: '18:00', clientIds: ['c2'] }));
    const J = state({ lessons: busy });
    const sets = suggestSets(J, { total: 8, perWeek: 2, startsOn: '2026-10-19', slots: { 0: '18:00' }, dur: 45 }, new Set(), NOW);
    expect(sets.length).toBeGreaterThan(0);
    const [first] = sets;
    expect(Object.keys(first)).toHaveLength(2);
    expect(new Set(Object.values(first)).size).toBe(1);
    for (const [d, t] of Object.entries(first)) if (d === '0') expect(['17:45', '18:00', '18:15', '18:30', '18:45'].includes(t)).toBe(false);
  });
  it('подбор учитывает выходные: в воскресенье не предлагает', () => {
    const sets = suggestSets(state(), { total: 6, perWeek: 3, startsOn: '2026-10-19', slots: {}, dur: 45 }, new Set(), NOW);
    for (const s of sets) expect(Object.keys(s)).not.toContain('6');
  });
});

describe('занятия и группы', () => {
  it('сплит — не больше двоих, нужен хотя бы один клиент', () => {
    const J = state();
    const base = { date: '2026-10-19', start: '10:00', dur: 45, kind: 'regular' as const, groupId: null, place: '', lane: null, repeat: null };
    expect(() => createLessons(J, { ...base, type: 'split', clientIds: ['c1', 'c2', 'c3'] })).toThrow('Сплит — это двое');
    expect(() => createLessons(J, { ...base, type: 'individual', clientIds: [] })).toThrow();
    expect(createLessons(J, { ...base, type: 'split', clientIds: ['c1'] }).upsert).toHaveLength(1);
  });
  it('повтор: n занятий по выбранным дням', () => {
    const ch = createLessons(state(), { date: '2026-10-19', start: '10:00', dur: 45, type: 'individual', kind: 'regular', clientIds: ['c1'], groupId: null, place: '', lane: null, repeat: { n: 3, days: [3] } });
    expect(ch.upsert.map((l) => l.date)).toEqual(['2026-10-19', '2026-10-22', '2026-10-26']);
  });
  it('новый состав группы попадает в будущие занятия, отметки ушедших снимаются', () => {
    const J = state({ groups: [{ id: 'g', type: 'group', name: 'Дельфины', memberIds: ['c1', 'c2'], archived: false }] });
    const past = sess({ date: '2026-10-10', groupId: 'g', type: 'group', clientIds: ['c1', 'c2'], att: { c2: 'present' } });
    const fut = sess({ date: '2026-10-20', groupId: 'g', type: 'group', clientIds: ['c1', 'c2'], att: { c2: 'excused' } });
    J.lessons.push(past, fut);
    J.groups[0].memberIds = ['c1'];
    syncGroup(J, J.groups[0], NOW);
    expect(fut.clientIds).toEqual(['c1']);
    expect(fut.att).toEqual({});
    expect(past.clientIds).toEqual(['c1', 'c2']);
  });
});

describe('сводка клиента', () => {
  it('последние 8, следующее, неотмеченные', () => {
    const J = state({ payments: [pay({ sessions: 8 })] });
    J.clients[0].pauses = [{ id: 'x', from: '2026-10-12', to: '2026-10-12' }];
    J.lessons.push(
      sess({ date: '2026-10-05', att: { c1: 'present' } }),
      sess({ date: '2026-10-07', att: { c1: 'excused' } }),
      sess({ date: '2026-10-12' }),
      sess({ date: '2026-10-14' }),
      sess({ date: '2026-10-19' }),
    );
    const s = summary(J, 'c1', NOW);
    expect(s.last).toEqual(['present', 'excused', 'pause', 'unmarked']);
    expect(s.next).toMatchObject({ date: '2026-10-19', start: '10:00' });
    expect(s.unmarked).toBe(1);
    expect(s.remaining).toBe(7);
  });
});
