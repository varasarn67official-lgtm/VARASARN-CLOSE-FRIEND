import { defineConfig } from 'vite'
import { fileURLToPath } from 'node:url'
import vue from '@vitejs/plugin-vue'

// Dev-only entry point: `npm run dev:mock`. Serves the app with a fake signed-in
// admin session and RPC fixtures (mock/neon.mock.ts) so screens behind Google
// sign-in can be exercised without real auth. Never used by `npm run build`.
export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      './neon': fileURLToPath(new URL('./mock/neon.mock.ts', import.meta.url)),
    },
  },
})
