// Drives the Claude connection exactly as Claude would, against the in-memory store.
import { test, before } from 'node:test';
import assert from 'node:assert/strict';

process.env.CLEAR45_TODAY = '2026-11-11';
delete process.env.DATABASE_URL;
const { handleMessage, TOOLS } = await import('../lib/mcp.js');
const svc = await import('../lib/service.js');

let n = 0;
const rpc = (method, params) => handleMessage({ jsonrpc: '2.0', id: ++n, method, params }, 'https://app.test');
const call = async (name, args) => (await rpc('tools/call', { name, arguments: args })).result;
const PERSON = { actor: 'Tester', actorType: 'person' };

before(() => svc.ready());

test('handshake: initialize, notification, ping, tools/list', async () => {
  const init = await rpc('initialize', { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } });
  assert.equal(init.result.protocolVersion, '2025-06-18');
  assert.equal(init.result.serverInfo.name, 'clear45');
  assert.equal((await rpc('initialize', { protocolVersion: '1999-01-01' })).result.protocolVersion, '2025-11-25');
  assert.equal(await handleMessage({ jsonrpc: '2.0', method: 'notifications/initialized' }, ''), null);
  assert.deepEqual((await rpc('ping')).result, {});
  const tools = (await rpc('tools/list')).result.tools;
  assert.equal(tools.length, 5);
  for (const t of tools) {
    assert.ok(t.name.startsWith('clear45_') && t.name.length <= 64);
    assert.ok(t.title && t.description && t.inputSchema.type === 'object');
    assert.equal(typeof t.annotations.readOnlyHint, 'boolean');
    assert.equal(typeof t.annotations.destructiveHint, 'boolean');
  }
  assert.equal((await rpc('nope/nothing')).error.code, -32601);
});

test('create_bill saves a bill, computes the deadline and marks it for review', async () => {
  const r = await call('clear45_create_bill', { supplier_name: 'Test Castings', invoice_number: 'TC-1', invoice_date: '2026-11-03', acceptance_date: '2026-11-05', amount: 125000, written_agreement: true, agreed_days: 45, mse_category: 'small', supplier_type: 'manufacturer', udyam_number: 'udyam-kr-03-0000001' });
  assert.equal(r.isError, false);
  assert.equal(r.structuredContent.due_date, '2026-12-20');
  assert.equal(r.structuredContent.days_left, 39);
  assert.equal(r.structuredContent.status, 'needs_review');
  assert.match(r.content[0].text, /Accepted 5 Nov 2026 \+ 45 days \(written agreement\) = due 20 Dec 2026/);
  const { bill, activity } = await svc.getBill(r.structuredContent.bill);
  assert.equal(bill.created_by, 'Claude');
  assert.equal(bill.udyam_number, 'UDYAM-KR-03-0000001');
  assert.equal(activity[0].actor_type, 'claude');
});

test('create_bill twice with the same supplier and invoice number does not duplicate', async () => {
  const before = (await svc.listBills()).length;
  const r = await call('clear45_create_bill', { supplier_name: '  test castings ', invoice_number: 'tc-1', invoice_date: '2026-11-03', amount: 125000 });
  assert.equal(r.structuredContent.created, false);
  assert.match(r.content[0].text, /Already in Clear45/);
  assert.equal((await svc.listBills()).length, before);
});

test('create_bill without acceptance date is saved with an "assumed" flag', async () => {
  const r = await call('clear45_create_bill', { supplier_name: 'Unknown Traders Co', invoice_number: 'U-9', invoice_date: '2026-11-02', amount: '48,500' });
  assert.equal(r.isError, false);
  assert.equal(r.structuredContent.acceptance_assumed, true);
  assert.equal(r.structuredContent.due_date, '2026-11-17');
  assert.equal(r.structuredContent.amount, 48500);
  assert.match(r.content[0].text, /acceptance date ASSUMED/);
});

test('errors come back as readable, fixable messages (isError: true)', async () => {
  const r = await call('clear45_create_bill', { supplier_name: 'X', invoice_number: '1', invoice_date: '03/11/2026', amount: -5, written_agreement: true });
  assert.equal(r.isError, true);
  assert.match(r.content[0].text, /YYYY-MM-DD/);
  assert.match(r.content[0].text, /amount must be a number greater than 0/);
  assert.match(r.content[0].text, /agreed_days is needed/);
  assert.equal((await call('clear45_update_bill', { bill: 'B-999', amount: 1 })).isError, true);
  assert.equal((await call('clear45_mark_paid', { bill: 'B-001', paid_date: '2030-01-01' })).isError, true);
  assert.equal((await rpc('tools/call', { name: 'nope' })).error.code, -32602);
});

test('update_bill recalculates the deadline and sends an approved bill back to review', async () => {
  const b3 = (await svc.getBill('B-003')).bill; // seeded, approved, 30 days agreed
  assert.equal(b3.status, 'approved');
  const r = await call('clear45_update_bill', { bill: 'B-003', agreed_days: 40 });
  assert.equal(r.structuredContent.changed, true);
  assert.equal(r.structuredContent.status, 'needs_review');
  assert.equal(r.structuredContent.days_left, b3.days_left + 10);
  const same = await call('clear45_update_bill', { bill: 'b-3', agreed_days: 40 });
  assert.equal(same.structuredContent.changed, false);
});

test('a person can approve only once acceptance date and category are confirmed', async () => {
  await assert.rejects(() => svc.approveBill('B-010', PERSON), /acceptance date/);
  await svc.updateBill('B-010', { acceptance_date: '2026-10-31', mse_category: 'micro', supplier_type: 'manufacturer' }, PERSON);
  const b = await svc.approveBill('B-010', PERSON);
  assert.equal(b.status, 'approved');
  assert.equal(b.due_date, '2026-11-15');
  const acts = (await svc.getBill('B-010')).activity.map((a) => `${a.actor_type}:${a.action}`);
  assert.deepEqual(acts, ['claude:created', 'person:edited', 'person:approved']);
});

test('mark_paid records on-time and late payments; reopen undoes it', async () => {
  const late = await call('clear45_mark_paid', { bill: 'B-001', paid_date: '2026-11-10' }); // due 6 Nov
  assert.equal(late.structuredContent.position, 'paid_late');
  assert.match(late.content[0].text, /4 days late/);
  const ok = await call('clear45_mark_paid', { bill: 'B-006' }); // today, due 16 Dec
  assert.equal(ok.structuredContent.position, 'paid_on_time');
  assert.equal(ok.structuredContent.paid_date, '2026-11-11');
  assert.equal((await svc.reopenBill('B-006', PERSON)).status, 'needs_review');
});

test('list_bills filters, pages and reports totals', async () => {
  const overdue = await call('clear45_list_bills', { filter: 'overdue' });
  assert.ok(overdue.structuredContent.bills.every((b) => b.position === 'red'));
  const page = await call('clear45_list_bills', { limit: 3 });
  assert.equal(page.structuredContent.returned, 3);
  assert.match(page.content[0].text, /Call again with offset 3/);
  const week = await call('clear45_list_bills', { due_within_days: 7, response_format: 'detailed' });
  assert.ok(week.structuredContent.bills.every((b) => b.days_left <= 7 && b.rule_applied));
  assert.equal((await call('clear45_list_bills', { filter: 'weird' })).isError, true);
});

test('export_register returns the MSME-1 buckets', async () => {
  const h1 = await call('clear45_export_register', { period: '2026-H1' });
  const t = h1.structuredContent.totals;
  // Seeded bills accepted Apr-Sep 2026: Sharma (accepted 22 Sep, paid 10 Nov in the test above, but unpaid as of 30 Sep),
  // Orbit (accepted 2 Sep, unpaid as of 30 Sep), Tulsi (accepted 12 Sep, unpaid as of 30 Sep).
  assert.equal(h1.structuredContent.as_of, '2026-09-30');
  assert.equal(t.outstanding_upto_45.count, 3);
  const h2 = await call('clear45_export_register', {});
  assert.equal(h2.structuredContent.period, '2026-H2');
  assert.match(h2.content[0].text, /Decision-support only/);
  assert.equal((await call('clear45_export_register', { period: 'Q3' })).isError, true);
  const csv = await svc.msme1Csv('2026-H2');
  assert.match(csv, /Outstanding more than 45 days - amount/);
  assert.match(await svc.billRegister(), /Statutory due date/);
});

test('prompt and resource are available', async () => {
  assert.equal((await rpc('prompts/list')).result.prompts[0].name, 'process_invoice');
  assert.match((await rpc('prompts/get', { name: 'process_invoice' })).result.messages[0].content.text, /clear45_create_bill/);
  const uri = (await rpc('resources/list')).result.resources[0].uri;
  assert.match((await rpc('resources/read', { uri })).result.contents[0].text, /capped at 45/);
});

test('spreadsheet export neutralises text that looks like a formula', async () => {
  await call('clear45_create_bill', { supplier_name: '=HYPERLINK("http://x","y")', invoice_number: 'F-1', invoice_date: '2026-11-01', amount: 10 });
  const csv = await svc.billRegister();
  assert.ok(csv.includes(`"'=HYPERLINK(""http://x"",""y"")"`));
  assert.ok(!/(^|,)=HYPERLINK/m.test(csv));
  assert.match(csv, /,-\d+,Overdue/); // real negative numbers (days overdue) stay as numbers
});
