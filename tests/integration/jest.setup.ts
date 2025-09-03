// Global test setup for integration tests
import { createClient } from 'redis';

// Extend Jest timeout for integration tests
jest.setTimeout(60000);

// Global setup
beforeAll(async () => {
  // Ensure Redis is available for testing
  const redis = createClient({
    socket: {
      host: 'localhost',
      port: 6379
    },
    database: 1 // Use test database
  });

  try {
    await redis.connect();
    await redis.flushDb(); // Clear test database
    await redis.disconnect();
  } catch (error) {
    console.warn('Redis not available for integration tests. Some tests may fail.');
  }
});

// Global teardown
afterAll(async () => {
  // Clean up test database
  const redis = createClient({
    socket: {
      host: 'localhost',
      port: 6379
    },
    database: 1
  });

  try {
    await redis.connect();
    await redis.flushDb();
    await redis.disconnect();
  } catch (error) {
    // Ignore cleanup errors
  }
});

// Mock console methods to reduce test noise
const originalConsoleLog = console.log;
const originalConsoleWarn = console.warn;
const originalConsoleError = console.error;

beforeEach(() => {
  // Only show console output for performance benchmarks
  if (!expect.getState().currentTestName?.includes('Benchmark')) {
    console.log = jest.fn();
    console.warn = jest.fn();
    console.error = jest.fn();
  }
});

afterEach(() => {
  console.log = originalConsoleLog;
  console.warn = originalConsoleWarn;
  console.error = originalConsoleError;
});