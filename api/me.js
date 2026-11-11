import * as svc from '../lib/service.js';
import { getStore } from '../lib/store.js';
import { todayIST } from '../lib/rules.js';
import { endpoint, send, session, baseUrl, mcpToken, showDemoLogin, appUser, appPass } from '../lib/http.js';

export default endpoint(async (req, res) => {
  const user = session(req);
  const out = { user, today: todayIST(), demo: showDemoLogin() ? { username: appUser(), password: appPass() } : null };
  if (user) {
    await svc.ready();
    out.storage = getStore().kind;
    out.mcp_url = mcpToken() ? `${baseUrl(req)}/api/mcp?key=${encodeURIComponent(mcpToken())}` : null;
    out.current_period = svc.periodFor(out.today);
  }
  send(res, 200, out);
}, { login: false });
