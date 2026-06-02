const { defineConfig } = require('vite');

module.exports = defineConfig({
  root: '.',
  base: './',
  server: {
    host: '0.0.0.0',
    port: 8080,
    proxy: {
      '/socket.io': {
        target: 'http://localhost:3000',
        ws: true,
      },
    },
  },
  build: {
    outDir: 'dist',
    assetsDir: 'assets',
  },
});
