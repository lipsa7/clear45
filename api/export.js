import * as svc from '../lib/service.js';
import { todayIST } from '../lib/rules.js';
import { endpoint, send, query } from '../lib/http.js';

export default endpoint(async (req, res) => {
  const { type = 'register', period } = query(req);
  const isMsme = type === 'msme1';
  const p = period || svc.periodFor(todayIST());
  const body = isMsme ? await svc.msme1Csv(p) : await svc.billRegister();
  const name = isMsme ? `clear45-msme1-${p}.csv` : `clear45-bill-register-${todayIST()}.csv`;
  send(res, 200, body, { 'Content-Type': 'text/csv; charset=utf-8', 'Content-Disposition': `attachment; filename="${name}"` });
});
