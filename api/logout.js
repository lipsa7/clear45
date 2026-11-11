import { endpoint, send, clearCookie } from '../lib/http.js';

export default endpoint(async (req, res) => send(res, 200, { ok: true }, { 'Set-Cookie': clearCookie() }), { login: false });
