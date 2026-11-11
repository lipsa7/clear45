import * as svc from '../lib/service.js';
import { endpoint, send, readJson, query } from '../lib/http.js';

export default endpoint(async (req, res, ctx) => {
  const { id } = query(req);
  if (req.method === 'GET') return send(res, 200, await svc.getBill(id));
  if (req.method !== 'POST') return send(res, 405, { error: 'Use GET or POST.' });
  const body = await readJson(req);
  switch (body.action) {
    case 'preview': return send(res, 200, { preview: svc.preview(body.fields || {}) });
    case 'update': await svc.updateBill(id, body.fields || {}, ctx); break;
    case 'approve': await svc.approveBill(id, ctx); break;
    case 'mark_paid': await svc.markPaid(id, body.paid_date, ctx); break;
    case 'reopen': await svc.reopenBill(id, ctx); break;
    default: return send(res, 400, { error: 'Unknown action.' });
  }
  send(res, 200, await svc.getBill(id));
});
