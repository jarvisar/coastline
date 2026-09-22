import { defineConfig } from 'vite';
import { coastlinePwa } from './scripts/pwa-plugin.mjs';

export default defineConfig({ plugins: [coastlinePwa()], worker: { format: 'es' } });
