import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { venueSearchPlugin } from './server/braveSearch';
export default defineConfig(({ mode }) => {
  // Server-only secret: no VITE_ prefix, so it is never bundled into the page.
  const env = loadEnv(mode, process.cwd(), '');
  return {plugins:[react(),tailwindcss(),venueSearchPlugin(env.BRAVE_SEARCH_API_KEY)],build:{chunkSizeWarningLimit:900},server:{host:'0.0.0.0',allowedHosts:true}};
});
