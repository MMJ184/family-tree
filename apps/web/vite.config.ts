import tailwindcss from '@tailwindcss/vite';
import { tanstackRouter } from '@tanstack/router-plugin/vite';
import viteReact from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const config = defineConfig({
  server: { host: '127.0.0.1', port: 3100, strictPort: true },
  preview: { host: '127.0.0.1', port: 3100, strictPort: true },
  resolve: {
    tsconfigPaths: true,
    dedupe: ['react', 'react-dom', 'radix-ui', 'three'],
  },
  plugins: [
    tailwindcss(),
    tanstackRouter({
      target: 'react',
      autoCodeSplitting: true,
      routeFileIgnorePattern: '\\.test\\.(ts|tsx)$',
    }),
    viteReact(),
  ],
});

export default config;
