// Runs the app on your own computer for testing: node dev-server.mjs
// On the live site, Vercel does this job (it serves /public and runs each file in /api).
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
const TYPES = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.pdf': 'application/pdf', '.svg': 'image/svg+xml', '.png': 'image/png', '.ico': 'image/x-icon' };
const port = Number(process.env.PORT || 3000);

http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://x');
  try {
    if (url.pathname.startsWith('/api/')) {
      const file = path.join(root, 'api', url.pathname.slice(5).replace(/[^a-z0-9_-]/gi, '') + '.js');
      if (!fs.existsSync(file)) { res.statusCode = 404; return res.end('Not found'); }
      const mod = await import(pathToFileURL(file).href);
      return await mod.default(req, res);
    }
    let rel = url.pathname === '/' ? '/index.html' : url.pathname;
    let file = path.join(root, 'public', path.normalize(rel));
    if (!file.startsWith(path.join(root, 'public'))) { res.statusCode = 403; return res.end(); }
    if (!fs.existsSync(file) && fs.existsSync(file + '.html')) file += '.html';
    if (!fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.statusCode = 404; return res.end('Not found'); }
    res.setHeader('Content-Type', TYPES[path.extname(file)] || 'application/octet-stream');
    fs.createReadStream(file).pipe(res);
  } catch (e) {
    console.error(e);
    res.statusCode = 500; res.end('Server error');
  }
}).listen(port, () => console.log(`Clear45 running at http://localhost:${port}  (Claude link: http://localhost:${port}/api/mcp?key=${process.env.MCP_TOKEN || 'local-dev-token'})`));
