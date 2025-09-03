module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>'],
  testMatch: ['**/*.test.ts'],
  transform: {
    '^.+\\.ts$': 'ts-jest',
  },
  collectCoverageFrom: [
    '../../backend/src/**/*.ts',
    '../../frontend/src/**/*.ts',
    '../../shared/**/*.ts',
    '!**/*.d.ts',
    '!**/node_modules/**',
  ],
  coverageDirectory: './coverage',
  coverageReporters: ['text', 'lcov', 'html'],
  setupFilesAfterEnv: ['<rootDir>/jest.setup.ts'],
  testTimeout: 60000, // 60 seconds for integration tests
  maxWorkers: 1, // Run tests sequentially to avoid port conflicts
  verbose: true,
  detectOpenHandles: true,
  forceExit: true,
};