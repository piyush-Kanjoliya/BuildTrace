'use strict';

const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    include: ['tests/**/*.test.js'],
    // describe/it/expect are injected - the project is CommonJS and cannot
    // require('vitest').
    globals: true,
    // Sequential files: every suite resets the same test database.
    fileParallelism: false,
    setupFiles: ['./tests/setup.js'],
    testTimeout: 30000,
    hookTimeout: 30000,
  },
});
