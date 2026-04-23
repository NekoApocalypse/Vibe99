import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src',
  base: '',
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    rollupOptions: {
      input: 'src/index.html',
    },
  },
  server: {
    port: 1420,
    strictPort: true,
  },
  clearScreen: false,
});
