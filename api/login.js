import { endpoint, send, readJson, sessionCookie, appUser, appPass, safeEqual } from '../lib/http.js';

export default endpoint(async (req, res) => {
  if (req.method !== 'POST') return send(res, 405, { error: 'Use POST.' });
  const { username = '', password = '', name = '' } = await readJson(req);
  const okUser = safeEqual(String(username).trim().toLowerCase(), appUser().toLowerCase());
  const okPass = safeEqual(String(password), appPass());
  if (!okUser || !okPass) return send(res, 401, { error: 'Wrong username or password.' });
  const display = String(name).trim().slice(0, 40) || 'Demo user';
  send(res, 200, { user: { name: display } }, { 'Set-Cookie': sessionCookie(req, display) });
}, { login: false });
