import { copyFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { defineConfig } from 'vite';

export default defineConfig({
  root: resolve(import.meta.dirname, 'site'),
  base: '/ci-bill-doctor/',
  plugins: [
    {
      name: 'copy-legal-notices',
      closeBundle() {
        const outputDirectory = resolve(import.meta.dirname, 'dist/site');
        copyFileSync(
          resolve(import.meta.dirname, 'LICENSE'),
          resolve(outputDirectory, 'LICENSE.txt')
        );
        copyFileSync(
          resolve(import.meta.dirname, 'THIRD_PARTY_NOTICES.md'),
          resolve(outputDirectory, 'THIRD_PARTY_NOTICES.md')
        );
      }
    }
  ],
  build: {
    outDir: resolve(import.meta.dirname, 'dist/site'),
    emptyOutDir: true,
    modulePreload: {
      polyfill: false
    },
    sourcemap: false,
    target: 'es2022'
  }
});
