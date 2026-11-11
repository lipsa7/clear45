// Claude connects here. Address: https://<your-site>/api/mcp?key=<MCP_TOKEN>
import { handleMessage } from '../lib/mcp.js';
import { query, readJson, send, baseUrl, mcpToken, safeEqual } from '../lib/http.js';

export default async function handler(req, res) {
  const cors = { 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type, Accept, Authorization, Mcp-Session-Id, Mcp-Protocol-Version', 'Access-Control-Allow-Methods': 'POST, OPTIONS' };
  if (req.method === 'OPTIONS') return send(res, 204, null, cors);

  const token = mcpToken();
  if (!token) return send(res, 503, { error: 'MCP_TOKEN is not set on the server. Add it in the hosting settings and redeploy.' }, cors);
  const bearer = /^Bearer\s+(.+)$/i.exec(req.headers.authorization || '');
  const given = query(req).key || (bearer && bearer[1]) || '';
  if (!given || !safeEqual(given, token)) return send(res, 401, { error: 'The connector link is missing its key or the key is wrong. Copy the full link again from the Clear45 app.' }, cors);

  if (req.method !== 'POST') return send(res, 405, { jsonrpc: '2.0', id: null, error: { code: -32000, message: 'Use POST. This server does not open event streams.' } }, { ...cors, Allow: 'POST, OPTIONS' });

  let body;
  try { body = await readJson(req); } catch { return send(res, 400, { jsonrpc: '2.0', id: null, error: { code: -32700, message: 'Parse error' } }, cors); }
  const appUrl = baseUrl(req);
  if (Array.isArray(body)) {
    const replies = (await Promise.all(body.map((m) => handleMessage(m, appUrl)))).filter(Boolean);
    return replies.length ? send(res, 200, replies, cors) : send(res, 202, null, cors);
  }
  const reply = await handleMessage(body, appUrl);
  return reply ? send(res, 200, reply, cors) : send(res, 202, null, cors);
}
