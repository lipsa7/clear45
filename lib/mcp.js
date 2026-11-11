// The Claude connection. This is a small MCP server (Model Context Protocol,
// "Streamable HTTP" transport, stateless JSON replies). It contains no AI:
// Claude decides which tool to call; these tools only check, save and calculate.
import * as svc from './service.js';
import { fmtDate, todayIST } from './rules.js';

const VERSIONS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const CLAUDE = { actor: 'Claude', actorType: 'claude' };

const INSTRUCTIONS = `Clear45 tracks the legal payment deadline for bills from Indian micro and small suppliers (MSMEs). The app applies fixed rules: 15 days from the acceptance date when there is no written agreement, or the agreed period capped at 45 days when there is one.
When the user shares an invoice: read it, then call clear45_create_bill. Never guess the acceptance date, the MSME category or the agreement terms. If the invoice or the user does not state them, ask the user once; if they do not know, leave acceptance_date out and use "unknown" for the category, and the app will flag the bill for a person to confirm.
Every bill Claude creates is saved as "Needs review". Only a person can approve a bill, in the Clear45 web app. Do not send bank account numbers; the app does not store them.`;

const RULES_TEXT = `Clear45 rule pack: India (MSMED Act 2006, sections 15 and 16)

Who is covered: suppliers registered (Udyam) as MICRO or SMALL enterprises that are manufacturers or service providers. Medium enterprises are not covered. Retail and wholesale traders are generally treated as not covered (MSME Office Memorandum, 2 July 2021).

Deadline: counted from the day the goods or services were ACCEPTED (not the invoice date).
- No written agreement: 15 days.
- Written agreement: the agreed number of days, but never more than 45.

If paid late:
- Tax: the buyer can deduct the amount only in the tax year it is actually paid (Section 43B(h), Income-tax Act 1961, up to 31 March 2026; Section 37(2)(g), Income-tax Act 2025, from 1 April 2026).
- Interest: compound interest at three times the RBI bank rate from the day after the deadline (MSMED Act section 16).
- Reporting: companies report payments to micro and small suppliers that crossed 45 days in the half-yearly Form MSME-1 (due 31 October and 30 April).

Worked examples:
- Accepted 10 Mar 2026, 45 days agreed in writing -> due 24 Apr 2026.
- Accepted 10 Mar 2026, no agreement -> due 25 Mar 2026.
- Accepted 1 Jul 2026, no agreement -> due 16 Jul 2026.
- Accepted 1 Jul 2026, 60 days agreed in writing -> capped at 45 -> due 15 Aug 2026.

Clear45 is a decision-support tool, not tax or legal advice.`;

const billFields = {
  supplier_name: { type: 'string', description: 'Supplier name exactly as printed on the invoice.' },
  invoice_number: { type: 'string', description: 'Invoice number printed on the invoice.' },
  invoice_date: { type: 'string', description: 'Invoice date, YYYY-MM-DD.' },
  amount: { type: 'number', description: 'Invoice total in rupees including GST, as a plain number, e.g. 482000.' },
  acceptance_date: { type: 'string', description: 'Day the goods or services were accepted, YYYY-MM-DD. The legal clock starts here. Leave out if neither the invoice nor the user states it; do not copy the invoice date.' },
  written_agreement: { type: 'boolean', description: 'True only if the user or the invoice states there is a written agreement or purchase order with payment terms. Default false.' },
  agreed_days: { type: 'integer', description: 'Credit period in the written agreement, in days. Required when written_agreement is true.' },
  mse_category: { type: 'string', enum: svc.CATEGORIES, description: 'Supplier’s MSME (Udyam) category. Use "unknown" unless the invoice or the user states it.' },
  supplier_type: { type: 'string', enum: svc.TYPES, description: 'What the supplier does. Traders (buy and resell) are generally outside the rule. Use "unknown" if unsure.' },
  udyam_number: { type: 'string', description: 'Udyam registration number if printed, e.g. UDYAM-KR-03-0012345.' },
  supplier_gstin: { type: 'string', description: 'Supplier’s 15-character GST number, if printed.' },
  supplier_pan: { type: 'string', description: 'Supplier’s 10-character PAN, if printed.' },
  delay_reason: { type: 'string', description: 'Reason payment is or was delayed, if the user gives one.' },
  notes: { type: 'string', description: 'Short note about anything unclear on the invoice.' },
};
const billRef = { type: 'string', description: 'Bill number shown by Clear45, e.g. B-012.' };

export const TOOLS = [
  {
    name: 'clear45_create_bill',
    title: 'Log a supplier bill',
    description: 'Save a supplier invoice as a bill in Clear45. The app calculates the legal payment deadline (15 days from acceptance without a written agreement, or the agreed days capped at 45) and returns the due date, days left and the rule applied. The bill is saved as "Needs review" for a person to confirm. If the same supplier and invoice number already exist, nothing new is created and the existing bill is returned.',
    inputSchema: { type: 'object', properties: billFields, required: ['supplier_name', 'invoice_number', 'invoice_date', 'amount'] },
    annotations: { title: 'Log a supplier bill', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'clear45_list_bills',
    title: 'List bills and deadlines',
    description: 'List bills with their legal due dates, most urgent first, plus totals for overdue and due-soon amounts. Use it for questions like "what is overdue?", "what must we pay this week?" or "what needs review?".',
    inputSchema: {
      type: 'object',
      properties: {
        filter: { type: 'string', enum: svc.FILTERS, description: 'all (default); unpaid; needs_review; overdue (past the legal deadline); due_soon (7 days or fewer left); paid; not_covered (outside the rule).' },
        due_within_days: { type: 'integer', description: 'Only unpaid covered bills whose deadline falls within this many days (overdue bills are included).' },
        supplier: { type: 'string', description: 'Only bills whose supplier name contains this text.' },
        limit: { type: 'integer', description: 'How many bills to return, 1 to 50. Default 20.' },
        offset: { type: 'integer', description: 'How many bills to skip, for the next page. Default 0.' },
        response_format: { type: 'string', enum: ['concise', 'detailed'], description: 'concise (default) gives one line per bill; detailed adds the rule applied and any flags.' },
      },
    },
    annotations: { title: 'List bills and deadlines', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'clear45_update_bill',
    title: 'Correct a bill',
    description: 'Change fields on an existing bill, for example to add the acceptance date or the supplier’s MSME category once the user confirms them. The deadline is recalculated. Send only the fields that change. If the bill was already approved, it goes back to "Needs review".',
    inputSchema: { type: 'object', properties: { bill: billRef, ...billFields }, required: ['bill'] },
    annotations: { title: 'Correct a bill', readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'clear45_mark_paid',
    title: 'Mark a bill as paid',
    description: 'Record that a bill has been paid and on what date. This closes the bill and fixes whether it was paid on time or late, so confirm the bill number and payment date with the user first. Clear45 does not move money.',
    inputSchema: { type: 'object', properties: { bill: billRef, paid_date: { type: 'string', description: 'Date the payment was made, YYYY-MM-DD. Cannot be in the future. Defaults to today (India time).' } }, required: ['bill'] },
    annotations: { title: 'Mark a bill as paid', readOnlyHint: false, destructiveHint: true, idempotentHint: true, openWorldHint: false },
  },
  {
    name: 'clear45_export_register',
    title: 'Compliance summary and register',
    description: 'Summarise the position for a half-year in the shape of Form MSME-1: per micro or small supplier, amounts paid within 45 days, paid after 45 days, outstanding for 45 days or less, and outstanding for more than 45 days. Also returns the amount currently past its legal deadline and where to download the spreadsheet files.',
    inputSchema: { type: 'object', properties: { period: { type: 'string', description: 'Half-year, e.g. 2026-H1 (April to September 2026) or 2026-H2 (October 2026 to March 2027). Defaults to the current half-year.' } } },
    annotations: { title: 'Compliance summary and register', readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  },
];

const LIGHT = { red: 'RED, overdue', amber: 'AMBER, due soon', green: 'GREEN, on track', grey: 'not covered by the rule', paid_on_time: 'paid on time', paid_late: 'paid late', paid: 'paid' };
const STATUS = { needs_review: 'Needs review', approved: 'Approved', paid: 'Paid' };

function slim(b) {
  return {
    bill: b.bill_no, supplier_name: b.supplier_name, invoice_number: b.invoice_number, amount: b.amount,
    invoice_date: b.invoice_date, acceptance_date: b.acceptance_date, acceptance_assumed: b.acceptance_assumed,
    mse_category: b.mse_category, supplier_type: b.supplier_type, written_agreement: b.written_agreement, agreed_days: b.agreed_days,
    status: b.status, paid_date: b.paid_date, coverage: b.coverage, due_date: b.due_date, days_left: b.days_left,
    position: b.light, rule_applied: b.explanation, flags: b.flags.map((f) => f.message),
  };
}
function line(b) {
  const when = b.status === 'paid' ? LIGHT[b.light] + (b.paid_date ? ` on ${fmtDate(b.paid_date)}` : '')
    : b.due_date ? `due ${fmtDate(b.due_date)}, ${b.days_left < 0 ? `${-b.days_left} days overdue` : `${b.days_left} days left`} (${LIGHT[b.light]})` : LIGHT[b.light];
  return `${b.bill_no} | ${b.supplier_name} | invoice ${b.invoice_number} | ${svc.money(b.amount)} | ${when} | ${STATUS[b.status]}`;
}
function full(b, appUrl) {
  const out = [line(b), `Rule applied: ${b.explanation}`];
  if (b.outcome) out.push(b.outcome);
  if (b.flags.length) out.push('To confirm: ' + b.flags.map((f) => f.message).join(' '));
  out.push(`Open in Clear45: ${appUrl}/#${b.bill_no}`);
  return out.join('\n');
}

const handlers = {
  async clear45_create_bill(args, appUrl) {
    const { duplicate, bill } = await svc.createBill(args, CLAUDE);
    const head = duplicate
      ? `Already in Clear45: this supplier and invoice number were saved earlier as ${bill.bill_no}. Nothing new was created. To change it, call clear45_update_bill with bill "${bill.bill_no}".`
      : `Saved as ${bill.bill_no}. It is marked "Needs review" until a person approves it in the app.`;
    return { text: `${head}\n${full(bill, appUrl)}`, data: { created: !duplicate, ...slim(bill), app_url: `${appUrl}/#${bill.bill_no}` } };
  },
  async clear45_list_bills(args, appUrl) {
    const all = await svc.listBills({ filter: args.filter || 'all', supplier: args.supplier, due_within_days: args.due_within_days });
    const limit = Math.min(Math.max(parseInt(args.limit, 10) || 20, 1), 50);
    const offset = Math.max(parseInt(args.offset, 10) || 0, 0);
    const page = all.slice(offset, offset + limit);
    const s = await svc.stats();
    const detailed = args.response_format === 'detailed';
    const lines = page.map((b) => (detailed ? `${line(b)}\n   Rule: ${b.explanation}${b.flags.length ? '\n   To confirm: ' + b.flags.map((f) => f.message).join(' ') : ''}` : line(b)));
    const more = offset + limit < all.length ? `\nShowing ${offset + 1} to ${offset + page.length} of ${all.length}. Call again with offset ${offset + limit} for more.` : '';
    const totals = `Whole workspace as of ${fmtDate(s.today)}: ${s.overdue.count} overdue (${svc.money(s.overdue.amount)}), ${s.due_soon.count} due within 7 days (${svc.money(s.due_soon.amount)}), ${s.needs_review.count} waiting for review.`;
    const text = (page.length ? `${all.length} bill${all.length === 1 ? '' : 's'} match.\n${lines.join('\n')}${more}` : 'No bills match.') + `\n${totals}\nApp: ${appUrl}`;
    return { text, data: { total_matching: all.length, offset, returned: page.length, bills: page.map(detailed ? slim : (b) => ({ bill: b.bill_no, supplier_name: b.supplier_name, invoice_number: b.invoice_number, amount: b.amount, status: b.status, due_date: b.due_date, days_left: b.days_left, position: b.light })), workspace_totals: s } };
  },
  async clear45_update_bill(args, appUrl) {
    const { bill: ref, ...patch } = args;
    if (!ref) throw new svc.UserError('bill is missing. Give the Clear45 bill number, e.g. B-012. Call clear45_list_bills to find it.');
    const r = await svc.updateBill(ref, patch, CLAUDE);
    if (!r.changed) return { text: `Nothing changed on ${r.bill.bill_no}: the values sent are the same as those already saved.\n${full(r.bill, appUrl)}`, data: { changed: false, ...slim(r.bill) } };
    const what = r.changes.map((c) => `${svc.LABELS[c.field]}: ${c.from ?? 'empty'} -> ${c.to ?? 'empty'}`).join('; ');
    return { text: `Updated ${r.bill.bill_no}. ${what}.${r.sentBack ? ' The bill was approved before, so it is back to "Needs review" for a person to confirm.' : ''}\n${full(r.bill, appUrl)}`, data: { changed: true, changes: r.changes, ...slim(r.bill) } };
  },
  async clear45_mark_paid(args, appUrl) {
    if (!args.bill) throw new svc.UserError('bill is missing. Give the Clear45 bill number, e.g. B-012. Call clear45_list_bills to find it.');
    const bill = await svc.markPaid(args.bill, args.paid_date, CLAUDE);
    return { text: `Marked ${bill.bill_no} as paid.\n${full(bill, appUrl)}`, data: slim(bill) };
  },
  async clear45_export_register(args, appUrl) {
    const m = await svc.msme1(args.period);
    const s = await svc.stats();
    const t = m.totals;
    const part = (label, x) => `${label}: ${x.count} invoice${x.count === 1 ? '' : 's'}, ${svc.money(x.amount)}`;
    const rows = m.suppliers.map((x) => `- ${x.supplier_name}: paid within 45 days ${svc.money(x.paid_within_45.amount)}; paid after 45 days ${svc.money(x.paid_after_45.amount)}; outstanding 45 days or less ${svc.money(x.outstanding_upto_45.amount)}; outstanding more than 45 days ${svc.money(x.outstanding_over_45.amount)}${x.reasons ? `; reason for delay: ${x.reasons}` : ''}`);
    const text = [
      `Form MSME-1 working sheet, half-year ${m.label} (${m.period}), position as of ${fmtDate(m.as_of)}. ${m.bill_count} bill${m.bill_count === 1 ? '' : 's'} from micro and small suppliers accepted in this period.`,
      [part('Paid within 45 days', t.paid_within_45), part('Paid after 45 days', t.paid_after_45), part('Outstanding 45 days or less', t.outstanding_upto_45), part('Outstanding more than 45 days', t.outstanding_over_45)].join('\n'),
      rows.length ? 'By supplier:\n' + rows.join('\n') : 'No micro or small supplier bills in this period.',
      `Across all periods today: ${s.overdue.count} bill${s.overdue.count === 1 ? '' : 's'} worth ${svc.money(s.overdue.amount)} are past the legal deadline. If still unpaid on ${fmtDate(s.tax_year_end)}, that amount cannot be deducted in this tax year.`,
      `Spreadsheet downloads (sign in to the app first): ${appUrl}/api/export?type=msme1&period=${m.period} and ${appUrl}/api/export?type=register`,
      'Decision-support only. Confirm with a chartered accountant before filing.',
    ].join('\n\n');
    return { text, data: { ...m, overdue_now: s.overdue, tax_year_end: s.tax_year_end } };
  },
};

const PROMPT = {
  name: 'process_invoice',
  title: 'Process this invoice for MSME compliance',
  description: 'Read an attached supplier invoice and log it in Clear45 with its legal payment deadline.',
  arguments: [{ name: 'acceptance_date', description: 'Day the goods or services were accepted (optional).', required: false }],
};
const RESOURCE = { uri: 'clear45://rules/india-msme', name: 'india-msme-rules', title: 'Clear45 rules: India MSME 15/45-day payment deadline', description: 'The fixed rules Clear45 applies, with worked examples.', mimeType: 'text/plain' };

const rpcError = (id, code, message) => ({ jsonrpc: '2.0', id: id ?? null, error: { code, message } });

/** Handle one JSON-RPC message. Returns a reply object, or null for notifications. */
export async function handleMessage(msg, appUrl) {
  if (!msg || msg.jsonrpc !== '2.0' || typeof msg.method !== 'string') return rpcError(msg && msg.id, -32600, 'Invalid request');
  if (msg.id === undefined || msg.id === null) return null; // a notification: nothing to answer
  const { id, method } = msg;
  const params = msg.params || {};
  const ok = (result) => ({ jsonrpc: '2.0', id, result });
  switch (method) {
    case 'initialize':
      return ok({
        protocolVersion: VERSIONS.includes(params.protocolVersion) ? params.protocolVersion : VERSIONS[0],
        capabilities: { tools: { listChanged: false }, prompts: { listChanged: false }, resources: { listChanged: false, subscribe: false } },
        serverInfo: { name: 'clear45', title: 'Clear45', version: '1.0.0' },
        instructions: INSTRUCTIONS,
      });
    case 'ping':
      return ok({});
    case 'tools/list':
      return ok({ tools: TOOLS });
    case 'tools/call': {
      const fn = handlers[params.name];
      if (!fn) return rpcError(id, -32602, `Unknown tool: ${params.name}`);
      try {
        const r = await fn(params.arguments || {}, appUrl);
        return ok({ content: [{ type: 'text', text: r.text }], structuredContent: r.data, isError: false });
      } catch (e) {
        if (!(e instanceof svc.UserError)) console.error(e);
        const text = e instanceof svc.UserError
          ? `Not saved. ${e.message}`
          : 'Clear45 could not complete this because of a temporary server problem. Nothing was changed. Please try once more.';
        return ok({ content: [{ type: 'text', text }], isError: true });
      }
    }
    case 'prompts/list':
      return ok({ prompts: [PROMPT] });
    case 'prompts/get': {
      if (params.name !== PROMPT.name) return rpcError(id, -32602, `Unknown prompt: ${params.name}`);
      const acc = params.arguments && params.arguments.acceptance_date;
      return ok({ description: PROMPT.description, messages: [{ role: 'user', content: { type: 'text', text: `Read the attached supplier invoice and log it in Clear45 with clear45_create_bill. ${acc ? `The goods or services were accepted on ${acc}.` : 'If the invoice does not show when the goods or services were accepted, ask me.'} Also ask me whether we have a written agreement with this supplier and how many days it allows, unless the invoice states it. Do not guess the supplier’s MSME category. Then tell me the due date, the days left and anything I need to confirm. Today is ${todayIST()}.` } }] });
    }
    case 'resources/list':
      return ok({ resources: [RESOURCE] });
    case 'resources/templates/list':
      return ok({ resourceTemplates: [] });
    case 'resources/read':
      if (params.uri !== RESOURCE.uri) return rpcError(id, -32002, `Unknown resource: ${params.uri}`);
      return ok({ contents: [{ uri: RESOURCE.uri, mimeType: 'text/plain', text: RULES_TEXT }] });
    default:
      return rpcError(id, -32601, `Method not found: ${method}`);
  }
}
