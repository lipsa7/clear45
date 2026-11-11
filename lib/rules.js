// Clear45 rule pack: India, MSMED Act 2006 sections 15-16, read with
// Section 43B(h) of the Income-tax Act 1961 (up to 31 Mar 2026) and
// Section 37(2)(g) of the Income-tax Act 2025 (from 1 Apr 2026).
// Fixed rules only. Nothing in this file guesses.

const MS_DAY = 86400000;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export const JURISDICTION = 'india_msmed';
export const NO_AGREEMENT_DAYS = 15;
export const MAX_AGREED_DAYS = 45;
export const AMBER_WINDOW_DAYS = 7;

export function isDate(s) {
  if (typeof s !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}
const toMs = (s) => Date.parse(s + 'T00:00:00Z');
export const addDays = (s, n) => new Date(toMs(s) + n * MS_DAY).toISOString().slice(0, 10);
/** a minus b, in whole days */
export const diffDays = (a, b) => Math.round((toMs(a) - toMs(b)) / MS_DAY);
export function fmtDate(s) {
  if (!isDate(s)) return '';
  const [y, m, d] = s.split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}
/** Today's date in India (UTC+5:30). CLEAR45_TODAY overrides it for tests. */
export function todayIST() {
  if (isDate(process.env.CLEAR45_TODAY || '')) return process.env.CLEAR45_TODAY;
  return new Date(Date.now() + 5.5 * 3600000).toISOString().slice(0, 10);
}
/** Last day (31 March) of the Indian tax year that contains the date. */
export function taxYearEnd(s) {
  const [y, m] = s.split('-').map(Number);
  return `${m >= 4 ? y + 1 : y}-03-31`;
}
export function sectionFor(baseDate) {
  return baseDate >= '2026-04-01'
    ? 'Section 37(2)(g), Income-tax Act 2025'
    : 'Section 43B(h), Income-tax Act 1961';
}

/**
 * Work out the legal payment deadline and status for one bill.
 * @param bill  stored bill fields
 * @param today YYYY-MM-DD
 */
export function evaluate(bill, today) {
  const cat = bill.mse_category || 'unknown';
  const type = bill.supplier_type || 'unknown';
  const assumed = !bill.acceptance_date;
  const base = bill.acceptance_date || bill.invoice_date;
  const flags = [];

  let coverage;
  let coverageNote = '';
  if (cat === 'medium') {
    coverage = 'not_covered';
    coverageNote = 'Medium enterprise: the 15/45-day rule covers only micro and small suppliers.';
  } else if (cat === 'not_msme') {
    coverage = 'not_covered';
    coverageNote = 'Supplier is not a registered micro or small enterprise, so the 15/45-day rule does not apply.';
  } else if (type === 'trader') {
    coverage = 'not_covered';
    coverageNote = 'Retail and wholesale traders are generally treated as outside the rule (MSME Office Memorandum, 2 July 2021).';
  } else if (cat === 'unknown') {
    coverage = 'unconfirmed';
  } else {
    coverage = 'covered';
  }

  if (assumed) flags.push({ code: 'acceptance_assumed', message: 'Acceptance date not given. The invoice date is used for now. The clock legally starts on the day the goods or services were accepted.' });
  if (cat === 'unknown') flags.push({ code: 'category_unknown', message: 'MSME category not confirmed. Treated as covered until someone checks the supplier’s Udyam registration.' });
  if (coverage === 'covered' && type === 'unknown') flags.push({ code: 'type_unknown', message: 'Supplier type not confirmed. Traders are generally outside the rule.' });
  if (coverage === 'covered' && !bill.udyam_number) flags.push({ code: 'udyam_missing', message: 'No Udyam registration number on file for this supplier.' });
  if (bill.acceptance_date && bill.invoice_date && bill.acceptance_date < bill.invoice_date) flags.push({ code: 'accepted_before_invoice', message: 'Acceptance date is earlier than the invoice date. Please double-check it.' });

  const agreed = bill.written_agreement ? Number(bill.agreed_days) : null;
  let days = null;
  let dayReason = '';
  if (coverage === 'not_covered') {
    if (agreed) { days = agreed; dayReason = `${agreed} days agreed in writing`; }
  } else if (bill.written_agreement) {
    days = Math.min(agreed, MAX_AGREED_DAYS);
    dayReason = agreed > MAX_AGREED_DAYS
      ? `written agreement of ${agreed} days, capped at ${MAX_AGREED_DAYS} by law`
      : 'written agreement';
  } else {
    days = NO_AGREEMENT_DAYS;
    dayReason = 'no written agreement';
  }

  const due = days != null && base ? addDays(base, days) : null;
  const startWord = assumed ? 'Invoice dated' : 'Accepted';
  let explanation;
  if (coverage === 'not_covered') {
    explanation = coverageNote + (due ? ` Contract due date: ${startWord.toLowerCase()} ${fmtDate(base)} + ${days} days (${dayReason}) = ${fmtDate(due)}.` : ' No statutory deadline is tracked.') + ' Tracked for information only.';
  } else {
    explanation = `${startWord} ${fmtDate(base)} + ${days} days (${dayReason}) = due ${fmtDate(due)} · ${sectionFor(base)} · MSMED Act section 15`;
    if (assumed) explanation += ' · acceptance date ASSUMED';
    if (coverage === 'unconfirmed') explanation += ' · MSME category NOT CONFIRMED';
  }

  const paid = bill.status === 'paid' && !!bill.paid_date;
  let light;
  let daysLeft = null;
  let outcome = '';
  if (paid) {
    if (coverage === 'not_covered' || !due) {
      light = 'paid';
      outcome = `Paid ${fmtDate(bill.paid_date)}.`;
    } else if (bill.paid_date <= due) {
      light = 'paid_on_time';
      outcome = `Paid ${fmtDate(bill.paid_date)}, within the deadline. Deduction is safe.`;
    } else {
      light = 'paid_late';
      const late = diffDays(bill.paid_date, due);
      const sameYear = bill.paid_date <= taxYearEnd(base);
      outcome = `Paid ${fmtDate(bill.paid_date)}, ${late} day${late === 1 ? '' : 's'} late. ` + (sameYear
        ? 'Paid in the same tax year, so the deduction stays in this year; interest for the late days may be payable to the supplier.'
        : `Paid after ${fmtDate(taxYearEnd(base))}, so the deduction moves to the tax year of payment; interest for the late days may be payable to the supplier.`);
    }
  } else if (due) {
    daysLeft = diffDays(due, today);
    if (coverage === 'not_covered') light = 'grey';
    else if (daysLeft < 0) light = 'red';
    else if (daysLeft <= AMBER_WINDOW_DAYS) light = 'amber';
    else light = 'green';
    if (light === 'red') outcome = `Overdue by ${-daysLeft} day${daysLeft === -1 ? '' : 's'}. If still unpaid on ${fmtDate(taxYearEnd(base))}, this amount cannot be deducted in that tax year. Interest at three times the RBI bank rate runs from ${fmtDate(addDays(due, 1))}.`;
    else if (light !== 'grey') outcome = daysLeft === 0 ? 'Due today.' : `${daysLeft} day${daysLeft === 1 ? '' : 's'} left to pay.`;
  } else {
    light = 'grey';
  }

  return {
    jurisdiction: JURISDICTION,
    coverage,
    base_date: base || null,
    acceptance_assumed: assumed,
    days_allowed: days,
    due_date: due,
    days_left: daysLeft,
    light,
    explanation,
    outcome,
    flags,
  };
}
