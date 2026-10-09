import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'path';

export default defineConfig({
    plugins: [react()],
    root: 'src/renderer',
    base: './',
    build: {
        outDir: '../../dist/renderer',
        emptyOutDir: true,
        // Keep chunks reasonably sized so the parser doesn't allocate a huge
        // contiguous heap object for one giant file.
        chunkSizeWarningLimit: 600,
        rollupOptions: {
            input: {
                main: path.resolve(__dirname, 'src/renderer/index.html'),
                'splash': path.resolve(__dirname, 'src/renderer/splash.html'),
                'limit-overlay': path.resolve(__dirname, 'src/renderer/limit-overlay.html'),
                'lock-screen': path.resolve(__dirname, 'src/renderer/lock-screen.html'),
                'focus-screen': path.resolve(__dirname, 'src/renderer/focus-screen.html'),
                'goodbye': path.resolve(__dirname, 'src/renderer/goodbye.html'),
            },
            output: {
                // Split vendor libraries into separate cacheable chunks so
                // the main app bundle stays small and V8 parse cost is spread.
                manualChunks(id) {
                    if (id.includes('node_modules/framer-motion')) return 'vendor-motion';
                    if (id.includes('node_modules/react-dom'))     return 'vendor-react';
                    if (id.includes('node_modules/react'))         return 'vendor-react';
                },
            },
        },
    },
    resolve: {
        alias: {
            '@': path.resolve(__dirname, 'src/renderer'),
        },
    },
    server: {
        port: 5173,
    },
});
