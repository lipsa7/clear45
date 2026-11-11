import { test } from 'node:test';
import assert from 'node:assert/strict';
import { evaluate, addDays, diffDays, isDate, taxYearEnd, sectionFor } from '../lib/rules.js';

const bill = (o) => ({ mse_category: 'micro', supplier_type: 'manufacturer', udyam_number: 'UDYAM-KR-03-0012345', invoice_date: o.acceptance_date, written_agreement: false, agreed_days: null, status: 'approved', paid_date: null, ...o });

test('worked example: accepted 10 Mar 2026, 45 days agreed -> due 24 Apr 2026', () => {
  const r = evaluate(bill({ acceptance_date: '2026-03-10', written_agreement: true, agreed_days: 45 }), '2026-03-12');
  assert.equal(r.due_date, '2026-04-24');
  assert.match(r.explanation, /Section 43B\(h\)/);
});
test('worked example: accepted 10 Mar 2026, no agreement -> due 25 Mar 2026', () => {
  assert.equal(evaluate(bill({ acceptance_date: '2026-03-10' }), '2026-03-12').due_date, '2026-03-25');
});
test('worked example: accepted 1 Jul 2026, no agreement -> due 16 Jul 2026', () => {
  const r = evaluate(bill({ acceptance_date: '2026-07-01' }), '2026-07-02');
  assert.equal(r.due_date, '2026-07-16');
  assert.match(r.explanation, /Section 37\(2\)\(g\)/);
});
test('worked example: accepted 1 Jul 2026, 45 days agreed -> due 15 Aug 2026, interest from 16 Aug', () => {
  const r = evaluate(bill({ acceptance_date: '2026-07-01', written_agreement: true, agreed_days: 45 }), '2026-08-20');
  assert.equal(r.due_date, '2026-08-15');
  assert.equal(r.light, 'red');
  assert.match(r.outcome, /16 Aug 2026/);
});
test('agreement longer than 45 days is capped at 45', () => {
  const r = evaluate(bill({ acceptance_date: '2026-07-01', written_agreement: true, agreed_days: 90 }), '2026-07-02');
  assert.equal(r.days_allowed, 45);
  assert.equal(r.due_date, '2026-08-15');
  assert.match(r.explanation, /capped at 45/);
});
test('agreement shorter than 45 days is used as agreed', () => {
  assert.equal(evaluate(bill({ acceptance_date: '2026-07-01', written_agreement: true, agreed_days: 30 }), '2026-07-02').due_date, '2026-07-31');
});
test('clock starts on acceptance date, not invoice date', () => {
  const r = evaluate(bill({ invoice_date: '2026-06-20', acceptance_date: '2026-07-01' }), '2026-07-02');
  assert.equal(r.due_date, '2026-07-16');
  assert.equal(r.acceptance_assumed, false);
});
test('missing acceptance date: invoice date is used and flagged as assumed', () => {
  const r = evaluate(bill({ invoice_date: '2026-07-01', acceptance_date: null }), '2026-07-02');
  assert.equal(r.due_date, '2026-07-16');
  assert.equal(r.acceptance_assumed, true);
  assert.ok(r.flags.some((f) => f.code === 'acceptance_assumed'));
});
test('medium enterprises, non-MSMEs and traders are not covered', () => {
  for (const o of [{ mse_category: 'medium' }, { mse_category: 'not_msme' }, { supplier_type: 'trader' }]) {
    const r = evaluate(bill({ acceptance_date: '2026-07-01', ...o }), '2026-09-01');
    assert.equal(r.coverage, 'not_covered');
    assert.equal(r.light, 'grey');
  }
});
test('unknown category is treated as covered but flagged', () => {
  const r = evaluate(bill({ acceptance_date: '2026-07-01', mse_category: 'unknown' }), '2026-07-02');
  assert.equal(r.coverage, 'unconfirmed');
  assert.equal(r.due_date, '2026-07-16');
  assert.ok(r.flags.some((f) => f.code === 'category_unknown'));
});
test('traffic light: green, amber (7 days or fewer), red (past due)', () => {
  const b = bill({ acceptance_date: '2026-07-01', written_agreement: true, agreed_days: 45 }); // due 15 Aug
  assert.equal(evaluate(b, '2026-08-07').light, 'green');
  assert.equal(evaluate(b, '2026-08-08').light, 'amber');
  assert.equal(evaluate(b, '2026-08-15').light, 'amber');
  assert.equal(evaluate(b, '2026-08-15').days_left, 0);
  assert.equal(evaluate(b, '2026-08-16').light, 'red');
});
test('paid on the due date is on time; one day later is late', () => {
  const b = { acceptance_date: '2026-07-01', status: 'paid' };
  assert.equal(evaluate(bill({ ...b, paid_date: '2026-07-16' }), '2026-09-01').light, 'paid_on_time');
  assert.equal(evaluate(bill({ ...b, paid_date: '2026-07-17' }), '2026-09-01').light, 'paid_late');
});
test('paid late after 31 March moves the deduction to the next tax year', () => {
  const r = evaluate(bill({ acceptance_date: '2027-03-01', status: 'paid', paid_date: '2027-04-10' }), '2027-05-01');
  assert.equal(r.light, 'paid_late');
  assert.match(r.outcome, /moves to the tax year of payment/);
  const same = evaluate(bill({ acceptance_date: '2026-07-01', status: 'paid', paid_date: '2026-08-01' }), '2026-09-01');
  assert.match(same.outcome, /stays in this year/);
});
test('date helpers', () => {
  assert.equal(addDays('2028-02-20', 15), '2028-03-06'); // leap year
  assert.equal(addDays('2026-12-20', 15), '2027-01-04'); // year end
  assert.equal(diffDays('2026-08-15', '2026-07-01'), 45);
  assert.equal(isDate('2026-02-30'), false);
  assert.equal(isDate('2026-2-3'), false);
  assert.equal(taxYearEnd('2026-07-01'), '2027-03-31');
  assert.equal(taxYearEnd('2026-03-10'), '2026-03-31');
  assert.equal(sectionFor('2026-03-31'), 'Section 43B(h), Income-tax Act 1961');
  assert.equal(sectionFor('2026-04-01'), 'Section 37(2)(g), Income-tax Act 2025');
});
