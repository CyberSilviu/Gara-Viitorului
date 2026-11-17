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
  },
};

export default defineConfig({
  base: './',
  server: { port: 5173, open: false },
  build: { chunkSizeWarningLimit: 2000 },
  plugins: [savePresentation],
});
