import { defineConfig } from 'vite';
import { godotHost, bundledExports } from './server/godot-host.js';

// The preview proxy serves this app from a generated https://<port>-<id>.e2b.app
// host, so both the dev server and the preview server must accept it.
export default defineConfig({
  plugins: [bundledExports(), godotHost()],
  server: {
    host: '0.0.0.0',
    port: 5173,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
  preview: {
    host: '0.0.0.0',
    port: 4173,
    allowedHosts: ['.e2b.app', 'localhost', '127.0.0.1'],
  },
  build: {
    chunkSizeWarningLimit: 900,
  },
});
