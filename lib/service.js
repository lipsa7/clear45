// Everything the app can do to a bill. The Claude connection (MCP) and the
// web screens both call these same functions, so they always agree.
import { evaluate, isDate, todayIST, fmtDate, diffDays, taxYearEnd } from './rules.js';
import { getStore } from './store.js';
import { seedInto } from './seed.js';

export const CATEGORIES = ['micro', 'small', 'medium', 'not_msme', 'unknown'];
export const TYPES = ['manufacturer', 'service', 'trader', 'unknown'];
const TEXT_FIELDS = ['supplier_name', 'supplier_pan', 'supplier_gstin', 'udyam_number', 'invoice_number', 'delay_reason', 'notes'];
export const EDITABLE = [...TEXT_FIELDS, 'mse_category', 'supplier_type', 'invoice_date', 'acceptance_date', 'amount', 'written_agreement', 'agreed_days'];
export const LABELS = {
  supplier_name: 'Supplier name', supplier_pan: 'PAN', supplier_gstin: 'GSTIN', udyam_number: 'Udyam number',
  mse_category: 'MSME category', supplier_type: 'Supplier type', invoice_number: 'Invoice number',
  invoice_date: 'Invoice date', acceptance_date: 'Acceptance date', amount: 'Amount',
  written_agreement: 'Written agreement', agreed_days: 'Agreed credit days', delay_reason: 'Reason for delay',
  notes: 'Notes', paid_date: 'Paid date', status: 'Status',
};

export class UserError extends Error {
  constructor(message, problems) { super(message); this.problems = problems || [message]; }
}

let readyPromise;
export function ready() {
  if (!readyPromise) {
    readyPromise = (async () => {
      const store = getStore();
      await store.init();
      if (await store.claimSeed()) await seedInto(api);
    })().catch((e) => { readyPromise = null; throw e; });
  }
  return readyPromise;
}

export const billNo = (id) => `B-${String(id).padStart(3, '0')}`;
export const money = (n) => '₹' + Number(n).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const nowIso = () => new Date().toISOString();
const blank = (v) => v === undefined || v === null || (typeof v === 'string' && v.trim() === '');

function toBool(v) {
  if (typeof v === 'boolean') return v;
  if (typeof v === 'string') return ['true', 'yes', '1', 'y'].includes(v.trim().toLowerCase());
  return !!v;
}

/** Check and tidy a full set of bill fields. Returns the clean values or throws UserError. */
function clean(input) {
  const out = {};
  const problems = [];
  for (const f of TEXT_FIELDS) out[f] = blank(input[f]) ? null : String(input[f]).trim().slice(0, 500);
  if (!out.supplier_name) problems.push('supplier_name is missing. Give the supplier’s name exactly as printed on the invoice.');
  if (!out.invoice_number) problems.push('invoice_number is missing. Give the invoice number printed on the invoice.');
  for (const f of ['supplier_pan', 'supplier_gstin', 'udyam_number']) if (out[f]) out[f] = out[f].toUpperCase();

  out.mse_category = blank(input.mse_category) ? 'unknown' : String(input.mse_category).trim().toLowerCase();
  if (!CATEGORIES.includes(out.mse_category)) problems.push(`mse_category must be one of: ${CATEGORIES.join(', ')}. Use "unknown" if the invoice does not say; do not guess.`);
  out.supplier_type = blank(input.supplier_type) ? 'unknown' : String(input.supplier_type).trim().toLowerCase();
  if (!TYPES.includes(out.supplier_type)) problems.push(`supplier_type must be one of: ${TYPES.join(', ')}. Use "unknown" if unsure.`);

  out.invoice_date = blank(input.invoice_date) ? null : String(input.invoice_date).trim();
  if (!out.invoice_date) problems.push('invoice_date is missing. Use the format YYYY-MM-DD, for example 2026-11-05.');
  else if (!isDate(out.invoice_date)) problems.push(`invoice_date "${out.invoice_date}" is not a real date in YYYY-MM-DD format, for example 2026-11-05.`);
  out.acceptance_date = blank(input.acceptance_date) ? null : String(input.acceptance_date).trim();
  if (out.acceptance_date && !isDate(out.acceptance_date)) problems.push(`acceptance_date "${out.acceptance_date}" is not a real date in YYYY-MM-DD format. Leave it out if the user has not said when the goods or services were accepted.`);

  const amt = typeof input.amount === 'string' ? Number(input.amount.replace(/[,\s₹]/g, '')) : Number(input.amount);
  if (blank(input.amount) || !Number.isFinite(amt) || amt <= 0) problems.push('amount must be a number greater than 0: the invoice total in rupees, with no currency symbol or commas, for example 482000.');
  else out.amount = Math.round(amt * 100) / 100;

  out.written_agreement = toBool(input.written_agreement);
  out.agreed_days = null;
  if (out.written_agreement) {
    const d = Number(input.agreed_days);
    if (blank(input.agreed_days) || !Number.isInteger(d) || d < 1 || d > 365) problems.push('agreed_days is needed when written_agreement is true: the credit period in the written agreement, as a whole number of days between 1 and 365. If the user has not said, ask them.');
    else out.agreed_days = d;
  }
  if (problems.length) throw new UserError(problems.join(' '), problems);
  return out;
}

export function view(bill, today = todayIST()) {
  return { ...bill, bill_no: billNo(bill.id), ...evaluate(bill, today) };
}

function parseRef(ref) {
  const m = String(ref ?? '').trim().match(/^(?:B-?)?0*(\d+)$/i);
  return m ? Number(m[1]) : null;
}
async function mustGet(ref) {
  const id = parseRef(ref);
  const bill = id ? await getStore().getBill(id) : null;
  if (!bill) throw new UserError(`No bill found for "${ref}". Bill numbers look like B-012. Use the list of bills to find the right number.`);
  return bill;
}
async function log(billId, ctx, action, changes) {
  await getStore().addActivity({ bill_id: billId, actor: ctx.actor, actor_type: ctx.actorType, action, changes: changes && changes.length ? JSON.stringify(changes) : null, at: ctx.at || nowIso() });
}
const norm = (s) => String(s || '').trim().toLowerCase().replace(/\s+/g, ' ');

export async function createBill(input, ctx) {
  if (!ctx.internal) await ready();
  const values = clean(input);
  const store = getStore();
  const dup = (await store.allBills()).find((b) => norm(b.supplier_name) === norm(values.supplier_name) && norm(b.invoice_number) === norm(values.invoice_number));
  if (dup) return { duplicate: true, bill: view(dup) };
  const at = ctx.at || nowIso();
  const bill = await store.insertBill({ ...values, status: 'needs_review', paid_date: null, source: ctx.actorType, created_by: ctx.actor, created_at: at, updated_at: at });
  await log(bill.id, ctx, 'created');
  return { duplicate: false, bill: view(bill) };
}

export async function updateBill(ref, patch, ctx) {
  if (!ctx.internal) await ready();
  const bill = await mustGet(ref);
  const merged = { ...bill };
  for (const f of EDITABLE) if (f in patch && patch[f] !== undefined) merged[f] = patch[f];
  const values = clean(merged);
  const changes = [];
  for (const f of EDITABLE) if ((bill[f] ?? null) !== (values[f] ?? null)) changes.push({ field: f, from: bill[f] ?? null, to: values[f] ?? null });
  if (!changes.length) return { changed: false, bill: view(bill), changes };
  const upd = { ...values, updated_at: ctx.at || nowIso() };
  // A change made by Claude to an approved bill sends it back for a person to review.
  let sentBack = false;
  if (ctx.actorType === 'claude' && bill.status === 'approved') { upd.status = 'needs_review'; sentBack = true; }
  const saved = await getStore().updateBill(bill.id, upd);
  await log(bill.id, ctx, 'edited', changes);
  return { changed: true, bill: view(saved), changes, sentBack };
}

export async function approveBill(ref, ctx) {
  if (!ctx.internal) await ready();
  const bill = await mustGet(ref);
  if (bill.status === 'paid') throw new UserError('This bill is already marked paid.');
  if (bill.status === 'approved') return view(bill);
  const problems = [];
  if (!bill.acceptance_date) problems.push('Enter the acceptance date (the day the goods or services were accepted) before approving.');
  if (bill.mse_category === 'unknown') problems.push('Confirm the supplier’s MSME category before approving.');
  if (problems.length) throw new UserError(problems.join(' '), problems);
  const saved = await getStore().updateBill(bill.id, { status: 'approved', updated_at: ctx.at || nowIso() });
  await log(bill.id, ctx, 'approved');
  return view(saved);
}

export async function markPaid(ref, paidDate, ctx) {
  if (!ctx.internal) await ready();
  const bill = await mustGet(ref);
  const today = todayIST();
  const date = blank(paidDate) ? today : String(paidDate).trim();
  if (!isDate(date)) throw new UserError(`paid_date "${date}" is not a real date in YYYY-MM-DD format, for example ${today}.`);
  if (date > today) throw new UserError(`paid_date ${date} is in the future (today is ${today}). Record a payment only after it has been made.`);
  if (bill.status === 'paid' && bill.paid_date === date) return view(bill);
  const changes = [{ field: 'paid_date', from: bill.paid_date ?? null, to: date }];
  const saved = await getStore().updateBill(bill.id, { status: 'paid', paid_date: date, updated_at: ctx.at || nowIso() });
  await log(bill.id, ctx, 'marked_paid', changes);
  return view(saved);
}

export async function reopenBill(ref, ctx) {
  await ready();
  const bill = await mustGet(ref);
  if (bill.status !== 'paid') return view(bill);
  const saved = await getStore().updateBill(bill.id, { status: 'needs_review', paid_date: null, updated_at: nowIso() });
  await log(bill.id, ctx, 'reopened', [{ field: 'paid_date', from: bill.paid_date, to: null }]);
  return view(saved);
}

export async function getBill(ref) {
  await ready();
  const bill = await mustGet(ref);
  const activity = (await getStore().activityFor(bill.id)).map((a) => ({ ...a, changes: a.changes ? JSON.parse(a.changes) : [] }));
  return { bill: view(bill), activity };
}

/** Work out the deadline for unsaved fields (used for the live preview while editing). */
export function preview(input) {
  const values = clean(input);
  return evaluate({ ...values, status: input.status === 'paid' ? 'paid' : 'approved', paid_date: input.paid_date || null }, todayIST());
}

export const FILTERS = ['all', 'unpaid', 'needs_review', 'overdue', 'due_soon', 'paid', 'not_covered'];
const matches = {
  all: () => true,
  unpaid: (b) => b.status !== 'paid',
  needs_review: (b) => b.status === 'needs_review',
  overdue: (b) => b.light === 'red',
  due_soon: (b) => b.light === 'amber',
  paid: (b) => b.status === 'paid',
  not_covered: (b) => b.coverage === 'not_covered',
};
const ORDER = { red: 0, amber: 1, green: 2, grey: 3, paid_late: 4, paid_on_time: 5, paid: 6 };

export async function listBills({ filter = 'all', supplier, due_within_days } = {}) {
  await ready();
  if (!FILTERS.includes(filter)) throw new UserError(`filter must be one of: ${FILTERS.join(', ')}.`);
  const today = todayIST();
  let bills = (await getStore().allBills()).map((b) => view(b, today)).filter(matches[filter]);
  if (supplier) bills = bills.filter((b) => norm(b.supplier_name).includes(norm(supplier)));
  if (due_within_days !== undefined && due_within_days !== null && due_within_days !== '') {
    const n = Number(due_within_days);
    if (!Number.isFinite(n) || n < 0) throw new UserError('due_within_days must be a number of days, 0 or more.');
    bills = bills.filter((b) => b.status !== 'paid' && b.coverage !== 'not_covered' && b.days_left !== null && b.days_left <= n);
  }
  bills.sort((a, b) => (ORDER[a.light] - ORDER[b.light]) || ((a.days_left ?? 9999) - (b.days_left ?? 9999)) || (b.id - a.id));
  return bills;
}

export async function stats() {
  const bills = await listBills();
  const sum = (arr) => Math.round(arr.reduce((t, b) => t + b.amount, 0) * 100) / 100;
  const pick = (fn) => { const a = bills.filter(fn); return { count: a.length, amount: sum(a) }; };
  const today = todayIST();
  return {
    today,
    tax_year_end: taxYearEnd(today),
    total: bills.length,
    overdue: pick((b) => b.light === 'red'),
    due_soon: pick((b) => b.light === 'amber'),
    on_track: pick((b) => b.light === 'green'),
    needs_review: pick((b) => b.status === 'needs_review'),
    paid_late: pick((b) => b.light === 'paid_late'),
  };
}

// ---------- Exports ----------

// Text that starts with = + - or @ gets a leading apostrophe so a spreadsheet never runs it as a formula.
const csvCell = (v) => {
  let s = v === null || v === undefined ? '' : String(v);
  if (typeof v === 'string' && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
const csv = (rows) => '﻿' + rows.map((r) => r.map(csvCell).join(',')).join('\r\n') + '\r\n';

/** Half-year periods used by Form MSME-1: H1 = April to September, H2 = October to March. */
export function periodFor(date) {
  const [y, m] = date.split('-').map(Number);
  if (m >= 4 && m <= 9) return `${y}-H1`;
  return m >= 10 ? `${y}-H2` : `${y - 1}-H2`;
}
export function periodRange(period) {
  const m = /^(\d{4})-H([12])$/.exec(String(period || ''));
  if (!m) throw new UserError('period must look like 2026-H1 (April to September 2026) or 2026-H2 (October 2026 to March 2027).');
  const y = Number(m[1]);
  return m[2] === '1'
    ? { period, start: `${y}-04-01`, end: `${y}-09-30`, label: `April to September ${y}` }
    : { period, start: `${y}-10-01`, end: `${y + 1}-03-31`, label: `October ${y} to March ${y + 1}` };
}

export async function billRegister() {
  const bills = await listBills();
  const head = ['Bill', 'Supplier', 'PAN', 'GSTIN', 'Udyam number', 'MSME category', 'Supplier type', 'Invoice number', 'Invoice date', 'Acceptance date', 'Acceptance date assumed', 'Amount (INR)', 'Written agreement', 'Agreed days', 'Days allowed by law', 'Statutory due date', 'Rule coverage', 'Status', 'Paid date', 'Days left (minus = overdue)', 'Position', 'Rule applied', 'Reason for delay', 'Created by', 'Notes'];
  const POSITION = { red: 'Overdue', amber: 'Due within 7 days', green: 'On track', grey: 'Not covered', paid_on_time: 'Paid on time', paid_late: 'Paid late', paid: 'Paid' };
  const rows = bills.map((b) => [b.bill_no, b.supplier_name, b.supplier_pan, b.supplier_gstin, b.udyam_number, b.mse_category, b.supplier_type, b.invoice_number, b.invoice_date, b.acceptance_date, b.acceptance_assumed ? 'yes' : 'no', b.amount, b.written_agreement ? 'yes' : 'no', b.agreed_days, b.days_allowed, b.due_date, b.coverage, b.status, b.paid_date, b.days_left, POSITION[b.light], b.explanation, b.delay_reason, b.created_by, b.notes]);
  return csv([head, ...rows]);
}

/**
 * Supplier-wise working sheet in the shape of Form MSME-1 (July 2024 version):
 * amounts paid within 45 days, paid after 45 days, outstanding for 45 days or
 * less, and outstanding for more than 45 days, counted from the acceptance date.
 */
export async function msme1(period) {
  await ready();
  const today = todayIST();
  const range = periodRange(period || periodFor(today));
  const asOf = today < range.end ? today : range.end;
  const bills = (await getStore().allBills()).map((b) => view(b, today))
    .filter((b) => ['micro', 'small'].includes(b.mse_category) && b.base_date >= range.start && b.base_date <= range.end);
  const bySupplier = new Map();
  const zero = () => ({ count: 0, amount: 0 });
  for (const b of bills) {
    const key = norm(b.supplier_name);
    if (!bySupplier.has(key)) bySupplier.set(key, { supplier_name: b.supplier_name, supplier_pan: b.supplier_pan || '', paid_within_45: zero(), paid_after_45: zero(), outstanding_upto_45: zero(), outstanding_over_45: zero(), reasons: new Set(), assumed: false });
    const s = bySupplier.get(key);
    if (!s.supplier_pan && b.supplier_pan) s.supplier_pan = b.supplier_pan;
    if (b.acceptance_assumed) s.assumed = true;
    const paidByAsOf = b.status === 'paid' && b.paid_date && b.paid_date <= asOf;
    let bucket;
    if (paidByAsOf) bucket = diffDays(b.paid_date, b.base_date) <= 45 ? 'paid_within_45' : 'paid_after_45';
    else bucket = diffDays(asOf, b.base_date) <= 45 ? 'outstanding_upto_45' : 'outstanding_over_45';
    s[bucket].count += 1;
    s[bucket].amount = Math.round((s[bucket].amount + b.amount) * 100) / 100;
    if (b.delay_reason && (bucket === 'paid_after_45' || bucket === 'outstanding_over_45')) s.reasons.add(b.delay_reason);
  }
  const suppliers = [...bySupplier.values()].map((s) => ({ ...s, reasons: [...s.reasons].join('; ') })).sort((a, b) => a.supplier_name.localeCompare(b.supplier_name));
  const totals = { paid_within_45: zero(), paid_after_45: zero(), outstanding_upto_45: zero(), outstanding_over_45: zero() };
  for (const s of suppliers) for (const k of Object.keys(totals)) { totals[k].count += s[k].count; totals[k].amount = Math.round((totals[k].amount + s[k].amount) * 100) / 100; }
  return { ...range, as_of: asOf, suppliers, totals, bill_count: bills.length };
}

export async function msme1Csv(period) {
  const m = await msme1(period);
  const head = ['Supplier name', 'PAN', 'Paid within 45 days via TReDS - invoices', 'Paid within 45 days via TReDS - amount (INR)', 'Paid within 45 days other modes - invoices', 'Paid within 45 days other modes - amount (INR)', 'Paid after 45 days - invoices', 'Paid after 45 days - amount (INR)', 'Outstanding 45 days or less - invoices', 'Outstanding 45 days or less - amount (INR)', 'Outstanding more than 45 days - invoices', 'Outstanding more than 45 days - amount (INR)', 'Reason for delay', 'Includes assumed acceptance date'];
  const row = (name, pan, s, reasons, assumed) => [name, pan, 0, 0, s.paid_within_45.count, s.paid_within_45.amount, s.paid_after_45.count, s.paid_after_45.amount, s.outstanding_upto_45.count, s.outstanding_upto_45.amount, s.outstanding_over_45.count, s.outstanding_over_45.amount, reasons, assumed];
  const rows = m.suppliers.map((s) => row(s.supplier_name, s.supplier_pan, s, s.reasons, s.assumed ? 'yes' : 'no'));
  return csv([
    [`Clear45 working sheet for Form MSME-1, half-year ${m.label}, position as of ${fmtDate(m.as_of)}`],
    ['Micro and small suppliers only. Days are counted from the acceptance date. Clear45 does not record TReDS payments, so those columns are 0. Decision-support only: confirm with your chartered accountant before filing.'],
    head, ...rows, row('TOTAL', '', m.totals, '', ''),
  ]);
}

export async function resetDemo() {
  await ready();
  await getStore().reset();
  await seedInto(api);
}

const api = { createBill, updateBill, approveBill, markPaid };
