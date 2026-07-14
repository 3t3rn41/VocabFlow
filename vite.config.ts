import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'

// 构建时间戳，用于文件名后缀以避免浏览器缓存
const BUILD_TIMESTAMP = Date.now()

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    port: 5173,
    host: true,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    // 开发模式下也不缓存
    headers: {
      'Cache-Control': 'no-cache, no-store, must-revalidate',
    },
  },
  build: {
    // 输出文件名添加时间戳后缀，确保每次部署后浏览器不会使用旧缓存
    rollupOptions: {
      output: {
        entryFileNames: `assets/[name]-[hash]-${BUILD_TIMESTAMP}.js`,
        chunkFileNames: `assets/[name]-[hash]-${BUILD_TIMESTAMP}.js`,
        assetFileNames: `assets/[name]-[hash]-${BUILD_TIMESTAMP}.[ext]`,
      },
    },
  },
})
