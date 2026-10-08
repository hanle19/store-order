import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://localhost:3333'
    }
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
    // antd 整包单独成 chunk（gzip ~388KB），一次性加载并 immutable 长缓存，
    // 二次访问零传输；recharts/html-to-image 已按页懒加载拆出。阈值据此校准，避免误报噪音。
    chunkSizeWarningLimit: 1400,
    rollupOptions: {
      output: {
        // 显式带 hash，配合服务端对 /assets/* 长效缓存，避免用户缓存旧版图表逻辑
        entryFileNames: 'assets/[name]-[hash].js',
        chunkFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash][extname]',
        manualChunks(id) {
          if (id.includes('node_modules')) {
            // antd 组件库 + 其依赖（rc-*、@ant-design/*）单独成包，浏览器可独立缓存
            if (
              id.includes('antd') ||
              id.includes('@ant-design') ||
              id.includes('rc-') ||
              id.includes('@rc-component') ||
              id.includes('@ctrl') ||
              id.includes('async-validator') ||
              id.includes('cssinjs') ||
              id.includes('@emotion') ||
              // antd/rc 链路的 React 辅助包，随 antd 同包避免跨包循环
              id.includes('prop-types') ||
              id.includes('react-is') ||
              id.includes('react-transition-group')
            ) {
              return 'antd';
            }
            // 图表库 recharts 及其 d3 依赖
            if (
              id.includes('recharts') ||
              id.includes('d3-') ||
              id.includes('victory') ||
              id.includes('internmap') ||
              id.includes('decimal.js') ||
              id.includes('react-smooth')
            ) {
              return 'charts';
            }
            // React 运行时（仅核心三件套，用路径边界精确匹配，避免误抓 react-is 等造成循环引用）
            if (
              id.includes('node_modules/react/') ||
              id.includes('node_modules/react-dom/') ||
              id.includes('node_modules/scheduler/')
            ) {
              return 'react-vendor';
            }
            return 'vendor';
          }
        }
      }
    }
  }
});
