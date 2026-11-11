// Small helpers so every endpoint uses plain Node request/response objects.
import crypto from 'node:crypto';
import { UserError } from './service.js';

export function query(req) {
  return Object.fromEntries(new URL(req.url, 'http://x').searchParams);
}
export async function readJson(req) {
  let body;
  try { body = req.body; } catch { body = undefined; }
  if (body !== undefined && body !== null) {
    if (Buffer.isBuffer(body)) body = body.toString('utf8');
    if (typeof body === 'string') return body.trim() ? JSON.parse(body) : {};
    return body;
  }
  const chunks = [];
  for await (const c of req) chunks.push(c);
  const text = Buffer.concat(chunks).toString('utf8');
  return text.trim() ? JSON.parse(text) : {};
}
export function send(res, status, data, headers = {}) {
  res.statusCode = status;
  res.setHeader('Cache-Control', 'no-store');
  for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  if (data === undefined || data === null) return res.end();
  if (typeof data === 'string') return res.end(data);
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(data));
}
export function baseUrl(req) {
  const proto = String(req.headers['x-forwarded-proto'] || 'http').split(',')[0].trim();
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || 'localhost').split(',')[0].trim();
  return `${proto}://${host}`;
}

// ---------- Settings ----------
const onVercel = () => !!process.env.VERCEL;
export const appUser = () => process.env.APP_USERNAME || 'demo';
export const appPass = () => process.env.APP_PASSWORD || 'clear45-demo';
/** Secret inside the Claude connector link. Must be set on the live site. */
export const mcpToken = () => process.env.MCP_TOKEN || (onVercel() ? '' : 'local-dev-token');
export const showDemoLogin = () => process.env.SHOW_DEMO_LOGIN === '1' || (!onVercel() && process.env.SHOW_DEMO_LOGIN !== '0');
const secret = () => process.env.SESSION_SECRET || crypto.createHash('sha256').update(`clear45|${appPass()}|${mcpToken()}`).digest('hex');

export function safeEqual(a, b) {
  const x = crypto.createHash('sha256').update(String(a)).digest();
  const y = crypto.createHash('sha256').update(String(b)).digest();
  return crypto.timingSafeEqual(x, y);
}

// ---------- Login session (signed cookie) ----------
const COOKIE = 'c45_session';
const sign = (payload) => crypto.createHmac('sha256', secret()).update(payload).digest('base64url');
export function sessionCookie(req, name) {
  const payload = Buffer.from(JSON.stringify({ n: name, exp: Date.now() + 7 * 86400000 })).toString('base64url');
  const secure = baseUrl(req).startsWith('https') ? '; Secure' : '';
  return `${COOKIE}=${payload}.${sign(payload)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=604800${secure}`;
}
export const clearCookie = () => `${COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
export function session(req) {
  const m = new RegExp(`(?:^|;\\s*)${COOKIE}=([^;]+)`).exec(req.headers.cookie || '');
  if (!m) return null;
  const [payload, sig] = m[1].split('.');
  if (!payload || !sig || !safeEqual(sig, sign(payload))) return null;
  try {
    const data = JSON.parse(Buffer.from(payload, 'base64url').toString('utf8'));
    return data.exp > Date.now() ? { name: data.n } : null;
  } catch { return null; }
}

/** Wrap a web endpoint: optional login check plus tidy error replies. */
export function endpoint(fn, { login = true } = {}) {
  return async (req, res) => {
    try {
      const user = session(req);
      if (login && !user) return send(res, 401, { error: 'Please sign in.' });
      await fn(req, res, user ? { actor: user.name, actorType: 'person' } : null);
    } catch (e) {
      if (e instanceof UserError) return send(res, 400, { error: e.message, problems: e.problems });
      if (e instanceof SyntaxError) return send(res, 400, { error: 'The request was not valid JSON.' });
      console.error(e);
      send(res, 500, { error: 'Something went wrong on the server. Please try again.' });
    }
  };
}
