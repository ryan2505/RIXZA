// Tiny static file server for local dev — serves the project root so the
// RIXZA .dc.html, its support.js runtime, and assets/ all resolve over HTTP.
// "/" serves the site homepage directly. Pair with `node server.js` (the API).
import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import { join, extname, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..'); // project root (parent of xray/)
const HOME = 'RIXZA Website v2 (FR).dc.html';
const PORT = Number(process.env.STATIC_PORT) || 8080;

const TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.pdf': 'application/pdf',
  '.woff2': 'font/woff2',
};

const server = createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://x').pathname);
    if (pathname === '/' || pathname === '') pathname = '/' + HOME;
    // Prevent path traversal outside ROOT.
    const filePath = normalize(join(ROOT, pathname));
    if (!filePath.startsWith(ROOT)) {
      res.writeHead(403).end('Forbidden');
      return;
    }
    const info = await stat(filePath);
    if (info.isDirectory()) {
      res.writeHead(302, { location: '/' }).end();
      return;
    }
    const body = await readFile(filePath);
    res.writeHead(200, { 'content-type': TYPES[extname(filePath).toLowerCase()] || 'application/octet-stream' });
    res.end(body);
  } catch {
    // SPA fallback: extensionless route (e.g. /solutions) → serve the app so the
    // client-side router can render the right page on reload / deep-link.
    if (!extname(pathname)) {
      try {
        const body = await readFile(join(ROOT, HOME));
        res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
        return res.end(body);
      } catch {}
    }
    res.writeHead(404, { 'content-type': 'text/plain; charset=utf-8' }).end('Not found');
  }
});

server.listen(PORT, () => {
  console.log(`\n  RIXZA site (static)  →  http://localhost:${PORT}/`);
  console.log(`  serving: ${ROOT}\n`);
});
