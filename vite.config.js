import net from 'node:net';
import { defineConfig } from 'vite';
import { coastlinePwa } from './scripts/pwa-plugin.mjs';

// Vite's own fallback only checks the address it binds. On Windows, 0.0.0.0:5173 can still bind while
// another dev server holds 127.0.0.1:5173 or [::1]:5173, so localhost would open the old server.
function canBind(port, host) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.once('error', (err) => resolve(err.code !== 'EADDRINUSE' && err.code !== 'EACCES'));
    server.listen({ port, host, exclusive: true }, () => server.close(() => resolve(true)));
  });
}

async function freePort(start) {
  for (let port = start; port < start + 100; port++) {
    let free = true;
    for (const host of ['0.0.0.0', '127.0.0.1', '::', '::1']) {
      if (!(await canBind(port, host))) { free = false; break; }
    }
    if (free) return port;
  }
  return start;
}

export default defineConfig(async ({ command }) => ({
  plugins: [coastlinePwa()],
  worker: { format: 'es' },
  server: command === 'serve' ? { port: await freePort(5173), strictPort: true } : {}
}));
