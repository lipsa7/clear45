// Storage. Postgres when DATABASE_URL is set; otherwise an in-memory store
// (for local testing only - it forgets everything when the process stops).

export const BILL_COLS = [
  'supplier_name', 'supplier_pan', 'supplier_gstin', 'udyam_number', 'mse_category', 'supplier_type',
  'invoice_number', 'invoice_date', 'acceptance_date', 'amount', 'written_agreement', 'agreed_days',
  'status', 'paid_date', 'delay_reason', 'notes', 'source', 'created_by', 'created_at', 'updated_at',
];
const ACT_COLS = ['bill_id', 'actor', 'actor_type', 'action', 'changes', 'at'];

const SCHEMA = `
CREATE TABLE IF NOT EXISTS bills (
  id SERIAL PRIMARY KEY,
  supplier_name TEXT NOT NULL,
  supplier_pan TEXT,
  supplier_gstin TEXT,
  udyam_number TEXT,
  mse_category TEXT NOT NULL DEFAULT 'unknown',
  supplier_type TEXT NOT NULL DEFAULT 'unknown',
  invoice_number TEXT NOT NULL,
  invoice_date TEXT NOT NULL,
  acceptance_date TEXT,
  amount DOUBLE PRECISION NOT NULL,
  written_agreement BOOLEAN NOT NULL DEFAULT FALSE,
  agreed_days INTEGER,
  status TEXT NOT NULL DEFAULT 'needs_review',
  paid_date TEXT,
  delay_reason TEXT,
  notes TEXT,
  source TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS activity (
  id SERIAL PRIMARY KEY,
  bill_id INTEGER NOT NULL,
  actor TEXT NOT NULL,
  actor_type TEXT NOT NULL,
  action TEXT NOT NULL,
  changes TEXT,
  at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT);
`;

class MemoryStore {
  kind = 'memory';
  bills = []; activity = []; nextBill = 1; nextAct = 1; seeded = false;
  async init() {}
  async claimSeed() { if (this.seeded) return false; this.seeded = true; return true; }
  async allBills() { return this.bills.map((b) => ({ ...b })); }
  async getBill(id) { const b = this.bills.find((x) => x.id === id); return b ? { ...b } : null; }
  async insertBill(row) {
    const b = { id: this.nextBill++ };
    for (const c of BILL_COLS) b[c] = row[c] ?? null;
    this.bills.push(b);
    return { ...b };
  }
  async updateBill(id, patch) {
    const b = this.bills.find((x) => x.id === id);
    if (!b) return null;
    for (const c of BILL_COLS) if (c in patch) b[c] = patch[c] ?? null;
    return { ...b };
  }
  async addActivity(row) { this.activity.push({ id: this.nextAct++, ...row }); }
  async activityFor(billId) { return this.activity.filter((a) => a.bill_id === billId).map((a) => ({ ...a })); }
  async reset() { this.bills = []; this.activity = []; this.nextBill = 1; this.nextAct = 1; }
}

class PgStore {
  kind = 'postgres';
  constructor(url) { this.url = url; }
  async init() {
    const pg = (await import('pg')).default;
    this.pool = new pg.Pool({ connectionString: this.url, max: 1 });
    await this.pool.query(SCHEMA);
  }
  async q(text, params = []) { return (await this.pool.query(text, params)).rows; }
  async claimSeed() {
    const rows = await this.q(`INSERT INTO meta (key, value) VALUES ('seeded', '1') ON CONFLICT (key) DO NOTHING RETURNING key`);
    return rows.length > 0;
  }
  async allBills() { return this.q('SELECT * FROM bills ORDER BY id'); }
  async getBill(id) { return (await this.q('SELECT * FROM bills WHERE id = $1', [id]))[0] || null; }
  async insertBill(row) {
    const marks = BILL_COLS.map((_, i) => `$${i + 1}`).join(', ');
    const rows = await this.q(`INSERT INTO bills (${BILL_COLS.join(', ')}) VALUES (${marks}) RETURNING *`, BILL_COLS.map((c) => row[c] ?? null));
    return rows[0];
  }
  async updateBill(id, patch) {
    const cols = BILL_COLS.filter((c) => c in patch);
    if (!cols.length) return this.getBill(id);
    const sets = cols.map((c, i) => `${c} = $${i + 1}`).join(', ');
    const rows = await this.q(`UPDATE bills SET ${sets} WHERE id = $${cols.length + 1} RETURNING *`, [...cols.map((c) => patch[c] ?? null), id]);
    return rows[0] || null;
  }
  async addActivity(row) {
    await this.q(`INSERT INTO activity (${ACT_COLS.join(', ')}) VALUES ($1, $2, $3, $4, $5, $6)`, ACT_COLS.map((c) => row[c] ?? null));
  }
  async activityFor(billId) { return this.q('SELECT * FROM activity WHERE bill_id = $1 ORDER BY id', [billId]); }
  async reset() { await this.q('TRUNCATE bills, activity RESTART IDENTITY'); }
}

let store;
export function getStore() {
  if (!store) store = process.env.DATABASE_URL ? new PgStore(process.env.DATABASE_URL) : new MemoryStore();
  return store;
}
