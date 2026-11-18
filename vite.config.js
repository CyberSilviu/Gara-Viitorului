import { defineConfig } from 'vite';
import fs from 'node:fs';
import path from 'node:path';

// Doar in modul dezvoltare: POST /__salveaza-prezentare scrie docs/PREZENTARE.md
// (generat din textele punctelor de informare si ale turului ghidat – vezi window.exportaPrezentarea()).
const savePresentation = {
  name: 'salveaza-prezentare',
  apply: 'serve',
  configureServer(server) {
    server.middlewares.use('/__salveaza-prezentare', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; if (body.length > 2e6) req.destroy(); });
      req.on('end', () => {
        const file = path.resolve('docs/PREZENTARE.md');
        fs.writeFileSync(file, body, 'utf8');
        res.end('salvat ' + file);
      });
    });
    // POST /__salveaza-captura?nume=01-gara  (corp: data URL PNG/JPEG) -> docs/capturi/01-gara.png|jpg
    server.middlewares.use('/__salveaza-captura', (req, res) => {
      if (req.method !== 'POST') { res.statusCode = 405; return res.end(); }
      const url = new URL(req.url, 'http://x');
      const name = (url.searchParams.get('nume') || 'captura').replace(/[^a-z0-9\-_]/gi, '');
      let body = '';
      req.setEncoding('utf8');
      req.on('data', (c) => { body += c; if (body.length > 40e6) req.destroy(); });
      req.on('end', () => {
        const m = /^data:image\/(png|jpeg);base64,(.+)$/.exec(body);
        if (!m) { res.statusCode = 400; return res.end('format invalid'); }
        const dir = path.resolve('docs/capturi');
        fs.mkdirSync(dir, { recursive: true });
        const file = path.join(dir, `${name}.${m[1] === 'jpeg' ? 'jpg' : 'png'}`);
        fs.writeFileSync(file, Buffer.from(m[2], 'base64'));
        res.end('salvat ' + file);
      });
    });
  },
};

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [savePresentation],
});
