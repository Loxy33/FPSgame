import { defineConfig } from 'vite';

// 单文件打包专用配置：输出 IIFE 经典脚本（不含 ESM import），
// 这样内联进 HTML 后可以直接用 <script> 执行，file:// 下没有任何模块/CORS 限制。
export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist-single',
    emptyOutDir: true,
    chunkSizeWarningLimit: 4000,
    rollupOptions: {
      output: {
        format: 'iife',
        inlineDynamicImports: true,
        entryFileNames: 'app.js',
        assetFileNames: 'app.[ext]',
      },
    },
  },
});
