import { defineConfig } from 'vite';
import path from 'path';

export default defineConfig({
  root: 'renderer',
  build: {
    outDir: 'dist',
    rollupOptions: {
      input: path.resolve(__dirname, 'renderer/index.html')
    }
  }
});
