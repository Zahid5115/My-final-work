import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import fs from 'fs';
import path from 'path';
import {defineConfig, loadEnv} from 'vite';

export default defineConfig(({mode}) => {
  const env = loadEnv(mode, process.cwd(), '');
  const resolvedMapsKey =
    [
      env.VITE_GOOGLE_MAPS_API_KEY,
      env.GOOGLE_MAPS_API_KEY,
      process.env.VITE_GOOGLE_MAPS_API_KEY,
      process.env.GOOGLE_MAPS_API_KEY,
    ]
      .map((v) => (v || '').trim())
      .find((v) => v && v !== 'MY_GOOGLE_MAPS_API_KEY') || '';

  if (resolvedMapsKey && !process.env.VITE_GOOGLE_MAPS_API_KEY) {
    process.env.VITE_GOOGLE_MAPS_API_KEY = resolvedMapsKey;
  }

  return {
    define: {
      'import.meta.env.VITE_GOOGLE_MAPS_API_KEY': JSON.stringify(resolvedMapsKey),
    },
    plugins: [
      react(),
      tailwindcss(),
      // Copies src/assets into dist/ so root-relative URLs like
      // "/src/assets/images/..." (e.g. generate_image output) still resolve
      // in production builds. Do not remove.
      {
        name: 'copy-unbundled-src-assets',
        apply: 'build',
        closeBundle(error?: Error): void {
          if (error) {
            return;
          }
          const distDir = path.resolve(import.meta.dirname, 'dist');
          const srcAssets = path.resolve(import.meta.dirname, 'src/assets');
          const distAssets = path.resolve(distDir, 'src/assets');
          if (fs.existsSync(distDir) && fs.existsSync(srcAssets)) {
            fs.cpSync(srcAssets, distAssets, {recursive: true, force: true});
          }
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(import.meta.dirname, '.'),
      },
    },
    build: {
      chunkSizeWarningLimit: 700,
      rolldownOptions: {
        output: {
          codeSplitting: {
            groups: [
              { name: 'react-vendor', test: /node_modules[\\/](react|react-dom|react-router|react-router-dom)[\\/]/ },
              { name: 'supabase-vendor', test: /node_modules[\\/]@supabase[\\/]/ },
              { name: 'firebase-vendor', test: /node_modules[\\/](firebase|@firebase)[\\/]/ },
              { name: 'maps-vendor', test: /node_modules[\\/]@vis\.gl[\\/]/ },
              { name: 'ui-vendor', test: /node_modules[\\/](lucide-react|motion|framer-motion)[\\/]/ },
            ],
          },
        },
      },
    },
    server: {
      // HMR is disabled in AI Studio via DISABLE_HMR env var.
      // Do not modify—file watching is disabled to prevent flickering during agent edits.
      hmr: process.env.DISABLE_HMR !== 'true',
      // Disable file watching when DISABLE_HMR is true to save CPU during agent edits.
      watch: process.env.DISABLE_HMR === 'true' ? null : {},
    },
  };
});
