import * as svc from '../lib/service.js';
import { endpoint, send, readJson } from '../lib/http.js';

export default endpoint(async (req, res, ctx) => {
  if (req.method === 'POST') {
    const r = await svc.createBill(await readJson(req), ctx);
    if (r.duplicate) return send(res, 409, { error: `This supplier and invoice number are already saved as ${r.bill.bill_no}.`, bill: r.bill });
    return send(res, 201, { bill: r.bill });
  }
  send(res, 200, { stats: await svc.stats(), bills: await svc.listBills() });
});
