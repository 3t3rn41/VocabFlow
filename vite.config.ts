import { defineConfig, type Plugin } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import fs from 'node:fs'

// 构建时间戳，用于文件名后缀以避免浏览器缓存
const BUILD_TIMESTAMP = Date.now()

/**
 * 插件：仅复制必要的 public 资源到 dist，排除 images/ 和 audio/（从 OSS 加载）
 * - 开发模式：通过中间件提供 /favicon.svg
 * - 构建模式：仅将 favicon.svg 复制到 dist/
 */
function copyMinimalPublic(): Plugin {
  return {
    name: 'copy-minimal-public',
    configureServer(server) {
      server.middlewares.use('/favicon.svg', (_req, res) => {
        const faviconPath = path.resolve(__dirname, 'public/favicon.svg')
        if (fs.existsSync(faviconPath)) {
          res.setHeader('Content-Type', 'image/svg+xml')
          res.end(fs.readFileSync(faviconPath))
        } else {
          res.statusCode = 404
          res.end()
        }
      })
    },
    async writeBundle() {
      const publicDir = path.resolve(__dirname, 'public')
      const outDir = path.resolve(__dirname, 'dist')
      const faviconSrc = path.join(publicDir, 'favicon.svg')
      const faviconDest = path.join(outDir, 'favicon.svg')
      if (fs.existsSync(faviconSrc)) {
        fs.copyFileSync(faviconSrc, faviconDest)
        console.log('[vite] 已复制 favicon.svg（images/ 和 audio/ 从 OSS 加载，不打包）')
      }
    },
  }
}

export default defineConfig({
  plugins: [react(), copyMinimalPublic()],
  // 禁用默认 public 目录自动复制，由 copyMinimalPublic 插件按需处理
  publicDir: false,
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
