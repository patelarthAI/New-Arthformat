import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'path';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    const apiKey = env.GEMINI_API_KEY || env.VITE_GEMINI_API_KEY || process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY;
    
    return {
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
          'vfs_fonts_stub': path.resolve(__dirname, './src/services/vfs_fonts_stub.ts'),
        },
      },
      server: {
        port: 3000,
        host: '0.0.0.0',
      },
      plugins: [react(), tailwindcss()],
      build: {
        chunkSizeWarningLimit: 3000,
        rollupOptions: {
          output: {
            manualChunks: {
              'vendor-react': ['react', 'react-dom'],
              'vendor-motion': ['framer-motion'],
              'vendor-utils': ['lucide-react', 'axios', 'lodash'],
              'vendor-docs': ['docx', 'jspdf', 'pdfmake', 'mammoth'],
            }
          }
        }
      },
      define: {
        'process.env.API_KEY': JSON.stringify(apiKey || ""),
        'process.env.GEMINI_API_KEY': JSON.stringify(apiKey || "")
      }
    };
});
