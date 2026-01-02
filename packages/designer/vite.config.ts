import { existsSync } from 'fs'
import { dirname, join, resolve } from 'path'
import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

// Find project root by walking up directory tree
function findProjectRoot(startDir: string): string {
  let dir = resolve(startDir)
  while (dir !== '/') {
    if (existsSync(join(dir, '.robomesh')) || existsSync(join(dir, '.git'))) {
      return dir
    }
    const parent = dirname(dir)
    if (parent === dir) break
    dir = parent
  }
  return startDir
}

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  // Load .env from project root (found by walking up directory tree)
  const projectRoot = findProjectRoot(__dirname)
  const env = loadEnv(mode, projectRoot, '')

  const serverPort = env.PORT || '3000'

  return {
    plugins: [react()],
    define: {
      // Pass server port to client for API URL construction
      'import.meta.env.VITE_SERVER_PORT': JSON.stringify(serverPort),
    },
    server: {
      proxy: {
        // Proxy API requests to the backend server
        '/api': {
          target: `http://localhost:${serverPort}`,
          changeOrigin: true,
        },
      },
    },
  }
})
