// Screen logic for Clear45. Plain browser JavaScript: no frameworks, no AI.
const $ = (s, el = document) => el.querySelector(s);
const esc = (v) => String(v ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const fmtDate = (s) => { if (!s) return ''; const [y, m, d] = s.split('-').map(Number); return `${d} ${MONTHS[m - 1]} ${y}`; };
const money = (n) => '₹' + Number(n || 0).toLocaleString('en-IN', { maximumFractionDigits: 2 });
const plural = (n, w) => `${n} ${w}${n === 1 ? '' : 's'}`;

const SAMPLES = [
  { file: 'sample-invoice-1-on-track.pdf', title: 'Invoice 1: everything stated', note: 'Acceptance date, 45-day agreement and Udyam number are all on the invoice.' },
  { file: 'sample-invoice-2-missing-details.pdf', title: 'Invoice 2: details missing', note: 'No acceptance date or payment terms. Claude should ask you, or the bill is flagged.' },
  { file: 'sample-invoice-3-overdue.pdf', title: 'Invoice 3: already overdue', note: 'Accepted in September with 30-day terms, so it lands in red.' },
];
const FILTERS = [['all', 'All'], ['needs_review', 'Needs review'], ['overdue', 'Overdue'], ['due_soon', 'Due in 7 days'], ['on_track', 'On track'], ['paid', 'Paid'], ['not_covered', 'Not covered']];
const TEST = { all: () => true, needs_review: (b) => b.status === 'needs_review', overdue: (b) => b.light === 'red', due_soon: (b) => b.light === 'amber', on_track: (b) => b.light === 'green', paid: (b) => b.status === 'paid', not_covered: (b) => b.coverage === 'not_covered' };
const STATUS = { needs_review: 'Needs review', approved: 'Approved', paid: 'Paid' };
const LABELS = { supplier_name: 'Supplier name', supplier_pan: 'PAN', supplier_gstin: 'GSTIN', udyam_number: 'Udyam number', mse_category: 'MSME category', supplier_type: 'Supplier type', invoice_number: 'Invoice number', invoice_date: 'Invoice date', acceptance_date: 'Acceptance date', amount: 'Amount', written_agreement: 'Written agreement', agreed_days: 'Agreed credit days', delay_reason: 'Reason for delay', notes: 'Notes', paid_date: 'Paid date' };
const FIELDS = Object.keys(LABELS).filter((f) => f !== 'paid_date');

const state = { me: null, bills: [], stats: null, filter: 'all', search: '', open: null, isNew: false, dirty: false, snapshot: '', known: null, timer: null };

async function api(path, body) {
  const res = await fetch(path, body ? { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {});
  const data = await res.json().catch(() => ({}));
  if (res.status === 401 && state.me && state.me.user) { location.reload(); throw new Error('Signed out'); }
  if (!res.ok) throw Object.assign(new Error(data.error || 'Something went wrong. Please try again.'), { data, status: res.status });
  return data;
}
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.hidden = false; clearTimeout(toast.t); toast.t = setTimeout(() => (t.hidden = true), 2600); }

function sampleLinks() {
  return SAMPLES.map((s) => `<a class="sample" href="/samples/${s.file}" download><div><b>${esc(s.title)}</b><span>${esc(s.note)}</span></div><em>Download PDF</em></a>`).join('');
}

// ---------- Countdown and badges ----------
function countdown(b) {
  if (b.light === 'paid_on_time') return 'Paid on time';
  if (b.light === 'paid_late') return 'Paid late';
  if (b.light === 'paid') return 'Paid';
  if (b.light === 'grey') return 'Not covered';
  if (b.days_left < 0) return `${plural(-b.days_left, 'day')} overdue`;
  if (b.days_left === 0) return 'Due today';
  return `${plural(b.days_left, 'day')} left`;
}
const catLabel = { micro: 'Micro', small: 'Small', medium: 'Medium', not_msme: 'Not an MSME', unknown: 'Category not confirmed' };
const typeLabel = { manufacturer: 'manufacturer', service: 'service provider', trader: 'trader', unknown: 'type not confirmed' };
function avatar(name, type) {
  const initial = type === 'claude' ? '✳' : (name || '?').trim().charAt(0).toUpperCase();
  return `<span class="av ${type === 'claude' ? 'claude' : ''}" aria-hidden="true">${esc(initial)}</span>`;
}

// ---------- Dashboard ----------
function renderTiles() {
  const s = state.stats;
  const tile = (cls, filter, k, v, sub) => `<button class="tile ${cls}" data-filter="${filter}"><div class="k">${k}</div><div class="v">${v}</div><div class="s">${sub}</div></button>`;
  $('#tiles').innerHTML =
    tile('red', 'overdue', 'Past the legal deadline', money(s.overdue.amount), `${plural(s.overdue.count, 'bill')}. Deduction at risk if unpaid on ${fmtDate(s.tax_year_end)}`) +
    tile('amber', 'due_soon', 'Due within 7 days', money(s.due_soon.amount), `${plural(s.due_soon.count, 'bill')} to pay this week`) +
    tile('green', 'on_track', 'On track', money(s.on_track.amount), `${plural(s.on_track.count, 'bill')} with more than 7 days left`) +
    tile('blue', 'needs_review', 'Needs review', String(s.needs_review.count), `${plural(s.needs_review.count, 'bill')} waiting for a person to check`);
}
function renderChips() {
  $('#chips').innerHTML = FILTERS.map(([k, label]) => `<button class="chip ${state.filter === k ? 'on' : ''}" data-filter="${k}">${label} <span>${state.bills.filter(TEST[k]).length}</span></button>`).join('');
}
function renderTable(flashIds = []) {
  const q = state.search.trim().toLowerCase();
  const rows = state.bills.filter(TEST[state.filter]).filter((b) => !q || `${b.supplier_name} ${b.invoice_number} ${b.bill_no}`.toLowerCase().includes(q));
  $('#bills tbody').innerHTML = rows.map((b) => `
    <tr data-id="${b.id}" tabindex="0" class="${flashIds.includes(b.id) ? 'flash' : ''}">
      <td class="c-bill muted">${b.bill_no}</td>
      <td class="c-sup sup"><b>${esc(b.supplier_name)}</b><small>${catLabel[b.mse_category]}, ${typeLabel[b.supplier_type]}</small></td>
      <td class="c-inv">${esc(b.invoice_number)}</td>
      <td class="c-acc">${b.acceptance_date ? fmtDate(b.acceptance_date) : `${fmtDate(b.invoice_date)}<span class="tag">Assumed</span>`}</td>
      <td class="c-due">${b.due_date ? fmtDate(b.due_date) : '<span class="muted">None</span>'}</td>
      <td class="c-cd"><span class="pill ${b.light}">${countdown(b)}</span></td>
      <td class="c-amt num"><b>${money(b.amount)}</b></td>
      <td class="c-st"><span class="pill ${b.status === 'paid' ? 'grey' : b.status}">${STATUS[b.status]}</span></td>
      <td class="c-by"><span class="by">${avatar(b.created_by, b.source)}${esc(b.created_by)}</span></td>
    </tr>`).join('');
  const empty = $('#empty');
  empty.hidden = rows.length > 0;
  $('#bills').hidden = rows.length === 0;
  if (!rows.length) empty.innerHTML = state.bills.length
    ? 'No bills match this view.'
    : '<b>No bills yet.</b><br>Connect Claude, drop in an invoice and type: “Log this bill in Clear45”.';
}
async function refresh({ quiet = false } = {}) {
  const data = await api('/api/bills');
  const json = JSON.stringify(data);
  if (json === state.snapshot) return;
  state.snapshot = json;
  const ids = data.bills.map((b) => b.id);
  const fresh = state.known ? ids.filter((id) => !state.known.has(id)) : [];
  state.known = new Set(ids);
  const before = state.open && state.bills.find((b) => b.id === state.open);
  state.bills = data.bills; state.stats = data.stats;
  renderTiles(); renderChips(); renderTable(fresh);
  if (fresh.length && quiet) toast(fresh.length === 1 ? 'New bill added' : `${fresh.length} new bills added`);
  // If the open bill was changed elsewhere (for example by Claude) and nothing is being typed, show the new version.
  const after = state.open && data.bills.find((b) => b.id === state.open);
  if (before && after && before.updated_at !== after.updated_at && !state.dirty) openBill(state.open);
}

// ---------- Bill panel ----------
const form = () => $('#billForm');
function readForm() {
  const f = form(); const out = {};
  for (const k of FIELDS) {
    const el = f.elements[k];
    out[k] = el.type === 'checkbox' ? el.checked : el.value;
  }
  if (!out.written_agreement) out.agreed_days = null;
  return out;
}
function fillForm(b) {
  const f = form();
  for (const k of FIELDS) {
    const el = f.elements[k];
    if (el.type === 'checkbox') el.checked = !!b[k]; else el.value = b[k] ?? '';
  }
  $('#agreedWrap').hidden = !f.elements.written_agreement.checked;
}
function renderRule(ev, unsaved) {
  const box = $('#dRule');
  box.className = `rule ${ev.light}`;
  const big = ev.due_date ? `${ev.coverage === 'not_covered' ? 'Contract due date' : 'Legal due date'}: ${fmtDate(ev.due_date)}` : 'No legal deadline tracked';
  const cd = ev.light === 'grey' || ev.days_left === null || ev.days_left === undefined ? '' : ` · ${countdown(ev)}`;
  box.innerHTML = `${unsaved ? '<div class="unsaved">Preview, not saved yet</div>' : ''}<div class="big">${esc(big)}${esc(cd)}</div><div class="calc">${esc(ev.explanation)}</div>${ev.outcome ? `<div class="out">${esc(ev.outcome)}</div>` : ''}`;
  $('#dFlags').innerHTML = (ev.flags || []).map((x) => `<div class="flag">${esc(x.message)}</div>`).join('');
}
const showVal = (field, v) => v === null || v === '' || v === undefined ? 'empty' : field === 'amount' ? money(v) : /_date$/.test(field) ? fmtDate(v) : typeof v === 'boolean' ? (v ? 'yes' : 'no') : field === 'mse_category' ? catLabel[v] : field === 'supplier_type' ? typeLabel[v] : String(v);
function renderActivity(list) {
  const verb = { created: 'created this bill', edited: 'edited this bill', approved: 'approved this bill', marked_paid: 'marked this bill as paid', reopened: 'reopened this bill' };
  $('#dActivity').innerHTML = list.slice().reverse().map((a) => {
    const changes = (a.changes || []).map((c) => `<div class="chg">${esc(LABELS[c.field] || c.field)}: ${esc(showVal(c.field, c.from))} → <b>${esc(showVal(c.field, c.to))}</b></div>`).join('');
    const when = new Date(a.at).toLocaleString('en-IN', { day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
    return `<li>${avatar(a.actor, a.actor_type)}<div><b>${esc(a.actor)}</b> ${verb[a.action] || esc(a.action)}${changes}<time>${esc(when)}</time></div></li>`;
  }).join('');
}
function renderActions(b) {
  const el = $('#dActions');
  if (state.isNew) { el.innerHTML = '<button class="btn primary" type="submit">Add bill</button>'; return; }
  let html = '<button class="btn primary" type="submit" id="saveBtn" disabled>Save changes</button>';
  if (b.status === 'needs_review') html += '<button class="btn accent" type="button" data-act="approve">Approve</button>';
  if (b.status !== 'paid') html += `<span class="paybox"><input type="date" id="payDate" value="${state.me.today}" max="${state.me.today}" aria-label="Payment date"><button class="btn" type="button" data-act="mark_paid">Mark paid</button></span>`;
  else html += '<button class="btn" type="button" data-act="reopen">Reopen (not paid)</button>';
  el.innerHTML = html;
}
function showPanel(data) {
  const b = data.bill;
  state.dirty = false;
  $('#dTitle').textContent = state.isNew ? 'Add a bill' : `${b.bill_no} · ${b.supplier_name}`;
  $('#dSub').innerHTML = state.isNew ? 'Type the details from the invoice. The due date is worked out as you go.' : `<span class="pill ${b.status === 'paid' ? 'grey' : b.status}">${STATUS[b.status]}</span><span class="by">${avatar(b.created_by, b.source)}Created by ${esc(b.created_by)}</span><span>${money(b.amount)}</span>`;
  fillForm(b);
  $('#dError').hidden = true;
  if (state.isNew) { $('#dRule').className = 'rule'; $('#dRule').innerHTML = '<div class="calc">Enter the invoice date and amount to see the legal due date.</div>'; $('#dFlags').innerHTML = ''; }
  else renderRule(b, false);
  renderActions(b);
  $('#dActivityWrap').hidden = state.isNew;
  if (!state.isNew) renderActivity(data.activity);
  $('#drawer').hidden = false; $('#scrim').hidden = false;
}
async function openBill(id) {
  try {
    state.isNew = false;
    const data = await api(`/api/bill?id=${id}`);
    state.open = data.bill.id;
    showPanel(data);
    history.replaceState(null, '', `#${data.bill.bill_no}`);
  } catch (e) { toast(e.message); }
}
function newBill() {
  state.isNew = true; state.open = null;
  showPanel({ bill: { mse_category: 'unknown', supplier_type: 'unknown', written_agreement: false }, activity: [] });
}
function closePanel() {
  if (state.dirty && !confirm('Close without saving your changes?')) return;
  $('#drawer').hidden = true; $('#scrim').hidden = true; state.open = null; state.dirty = false; state.isNew = false;
  history.replaceState(null, '', location.pathname);
}
function showError(e) { const el = $('#dError'); el.textContent = e.message; el.hidden = false; }
let previewTimer;
function onFormInput(ev) {
  if (ev && ev.target && !FIELDS.includes(ev.target.name)) return; // e.g. the payment date box
  state.dirty = true;
  $('#agreedWrap').hidden = !form().elements.written_agreement.checked;
  const save = $('#saveBtn'); if (save) save.disabled = false;
  clearTimeout(previewTimer);
  previewTimer = setTimeout(async () => {
    try {
      const cur = state.bills.find((b) => b.id === state.open);
      const { preview } = await api('/api/bill?id=0', { action: 'preview', fields: { ...readForm(), status: cur ? cur.status : 'needs_review', paid_date: cur ? cur.paid_date : null } });
      renderRule(preview, true); $('#dError').hidden = true;
    } catch (e) { if (e.status === 400 && !state.isNew) showError(e); }
  }, 250);
}
async function onFormSubmit(ev) {
  ev.preventDefault();
  try {
    if (state.isNew) {
      const { bill } = await api('/api/bills', readForm());
      state.isNew = false; state.dirty = false;
      await refresh(); await openBill(bill.id); toast(`Added ${bill.bill_no}`);
    } else {
      const data = await api(`/api/bill?id=${state.open}`, { action: 'update', fields: readForm() });
      showPanel(data); await refresh(); toast('Saved');
    }
  } catch (e) { showError(e); }
}
async function onAction(act) {
  try {
    if (state.dirty) { toast('Save your changes first'); return; }
    const body = { action: act };
    if (act === 'mark_paid') body.paid_date = $('#payDate').value;
    const data = await api(`/api/bill?id=${state.open}`, body);
    showPanel(data); await refresh();
    toast({ approve: 'Approved', mark_paid: 'Marked as paid', reopen: 'Reopened' }[act]);
  } catch (e) { showError(e); }
}

// ---------- Pop-ups ----------
function openModal(html) { $('#mBody').innerHTML = html; $('#modal').hidden = false; }
function connectModal() {
  const url = state.me.mcp_url;
  openModal(`
    <h2>Connect Claude to Clear45</h2>
    ${url ? `<p>This link is the key to this workspace. Treat it like a password.</p>
    <div class="copyrow"><input id="mcpUrl" readonly value="${esc(url)}" aria-label="Connector link"><button class="btn primary" data-copy="#mcpUrl">Copy link</button></div>` : '<p class="error">The server has no MCP_TOKEN set, so Claude cannot connect yet. Add it in the hosting settings and redeploy.</p>'}
    <ol>
      <li>In Claude (claude.ai or the desktop app), open <b>Customize</b>, then <b>Connectors</b>, press <b>+</b> and choose <b>Add custom connector</b>.</li>
      <li>Name it <b>Clear45</b>, paste the link above and press <b>Add</b>. No sign-in is asked for.</li>
      <li>Start a new chat, switch the Clear45 connector on, drop in a sample invoice and type the first request below.</li>
    </ol>
    <h3>Things to type in Claude</h3>
    ${['Log this bill in Clear45. We accepted the goods on the date shown and have a 45-day written agreement.', 'Which Clear45 bills must we pay this week, and which are already overdue?', 'In Clear45, set the acceptance date of the Malabar Coir Exports bill to 2 days after its invoice date.', 'Give me the Clear45 MSME-1 summary for this half-year as a short note for my CFO.'].map((p, i) => `<div class="prompt"><span id="p${i}">${esc(p)}</span><button class="btn" data-copy="#p${i}">Copy</button></div>`).join('')}
    <h3>Sample invoices</h3>
    <div class="samples">${sampleLinks()}</div>`);
}
function exportModal() {
  const cur = state.me.current_period;
  const [y, h] = cur.split('-H').map(Number);
  const prev = h === 1 ? `${y - 1}-H2` : `${y}-H1`;
  const label = (p) => { const [yy, hh] = p.split('-H').map(Number); return hh === 1 ? `April to September ${yy}` : `October ${yy} to March ${yy + 1}`; };
  openModal(`
    <h2>Export</h2>
    <p>Both files open in Excel or Google Sheets.</p>
    <a class="sample" href="/api/export?type=register"><div><b>Bill register</b><span>Every bill with its acceptance date, legal due date, rule applied and status.</span></div><em>Download CSV</em></a>
    <a class="sample" href="/api/export?type=msme1&period=${cur}"><div><b>Form MSME-1 working sheet: ${label(cur)}</b><span>Per supplier: paid within 45 days, paid after 45 days, outstanding 45 days or less, outstanding more than 45 days.</span></div><em>Download CSV</em></a>
    <a class="sample" href="/api/export?type=msme1&period=${prev}"><div><b>Form MSME-1 working sheet: ${label(prev)}</b><span>The previous half-year.</span></div><em>Download CSV</em></a>
    <p class="hint">Decision-support only. Confirm with your chartered accountant before filing.</p>`);
}

// ---------- Start-up ----------
async function start() {
  state.me = await api('/api/me');
  document.querySelectorAll('[data-samples]').forEach((el) => (el.innerHTML = sampleLinks()));
  if (!state.me.user) {
    $('#login').hidden = false;
    if (state.me.demo) {
      const btn = $('#demoBtn'); btn.hidden = false;
      btn.onclick = () => { const f = $('#loginForm'); f.username.value = state.me.demo.username; f.password.value = state.me.demo.password; f.name.focus(); };
    }
    $('#loginForm').onsubmit = async (ev) => {
      ev.preventDefault();
      const f = ev.target;
      try { await api('/api/login', { username: f.username.value, password: f.password.value, name: f.name.value }); location.reload(); }
      catch (e) { const el = $('#loginError'); el.textContent = e.message; el.hidden = false; }
    };
    return;
  }
  $('#app').hidden = false;
  $('#who').textContent = `Signed in as ${state.me.user.name}`;
  $('#memoryBanner').hidden = state.me.storage !== 'memory';
  await refresh();
  const m = /^#B-?0*(\d+)$/i.exec(location.hash);
  if (m) openBill(Number(m[1]));
  state.timer = setInterval(() => { if (!document.hidden) refresh({ quiet: true }).catch(() => {}); }, 4000);

  const setFilter = (f) => { state.filter = f; renderChips(); renderTable(); };
  $('#tiles').onclick = (e) => { const t = e.target.closest('[data-filter]'); if (t) setFilter(t.dataset.filter); };
  $('#chips').onclick = (e) => { const t = e.target.closest('[data-filter]'); if (t) setFilter(t.dataset.filter); };
  $('#search').oninput = (e) => { state.search = e.target.value; renderTable(); };
  const rowOpen = (e) => { const tr = e.target.closest('tr[data-id]'); if (tr) openBill(Number(tr.dataset.id)); };
  $('#bills tbody').onclick = rowOpen;
  $('#bills tbody').onkeydown = (e) => { if (e.key === 'Enter') rowOpen(e); };
  $('#dClose').onclick = closePanel; $('#scrim').onclick = closePanel;
  form().oninput = onFormInput; form().onsubmit = onFormSubmit;
  $('#dActions').onclick = (e) => { const b = e.target.closest('[data-act]'); if (b) onAction(b.dataset.act); };
  $('#addBtn').onclick = newBill;
  $('#connectBtn').onclick = connectModal;
  $('#exportBtn').onclick = exportModal;
  $('#mClose').onclick = () => ($('#modal').hidden = true);
  $('#modal').onclick = (e) => { if (e.target.id === 'modal') $('#modal').hidden = true; };
  $('#mBody').onclick = async (e) => {
    const b = e.target.closest('[data-copy]'); if (!b) return;
    const src = $(b.dataset.copy); const text = src.value ?? src.textContent;
    try { await navigator.clipboard.writeText(text); } catch { if (src.select) { src.select(); document.execCommand('copy'); } }
    toast('Copied');
  };
  $('#resetBtn').onclick = async () => {
    if (!confirm('Put the sample bills back as they were? Bills added since then will be removed.')) return;
    try { await api('/api/reset', {}); state.known = null; closePanelQuiet(); await refresh(); toast('Demo data reset'); } catch (e) { toast(e.message); }
  };
  $('#logoutBtn').onclick = async () => { await api('/api/logout', {}); location.href = '/'; };
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { if (!$('#modal').hidden) $('#modal').hidden = true; else if (!$('#drawer').hidden) closePanel(); } });
}
function closePanelQuiet() { state.dirty = false; if (!$('#drawer').hidden) closePanel(); }

start().catch((e) => { document.body.insertAdjacentHTML('beforeend', `<p class="error" style="margin:24px">Clear45 could not start: ${esc(e.message)}</p>`); });
