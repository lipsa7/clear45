import * as svc from '../lib/service.js';
import { endpoint, send } from '../lib/http.js';

export default endpoint(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  await svc.resetDemo();
  send(res, 200, { ok: true });
});
