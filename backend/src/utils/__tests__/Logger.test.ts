import { Logger, LogLevel } from '../Logger';
import { createWriteStream } from 'fs';
import { join } from 'path';

// Mock fs module
jest.mock('fs', () => ({
  createWriteStream: jest.fn(() => ({
    write: jest.fn(),
    end: jest.fn()
  }))
}));

describe('Logger', () => {
  let logger: Logger;
  let consoleSpy: jest.SpyInstance;

  beforeEach(() => {
    // Reset singleton instance
    (Logger as any).instance = undefined;
    logger = Logger.getInstance();
    
    // Mock console methods
    consoleSpy = jest.spyOn(console, 'log').mockImplementation();
    jest.spyOn(console, 'error').mockImplementation();
    jest.spyOn(console, 'warn').mockImplementation();
  });

  afterEach(() => {
    consoleSpy.mockRestore();
    logger.close();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const logger1 = Logger.getInstance();
      const logger2 = Logger.getInstance();
      expect(logger1).toBe(logger2);
    });
  });

  describe('Log Levels', () => {
    it('should log error messages', () => {
      logger.error('Test error', { code: 500 });
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('[ERROR]'),
        { code: 500 }
      );
    });

    it('should log warning messages', () => {
      logger.warn('Test warning', { code: 400 });
      
      expect(console.warn).toHaveBeenCalledWith(
        expect.stringContaining('[WARN]'),
        { code: 400 }
      );
    });

    it('should log info messages', () => {
      logger.info('Test info', { userId: 'user1' });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[INFO]'),
        { userId: 'user1' }
      );
    });

    it('should log debug messages when debug level is enabled', () => {
      process.env.LOG_LEVEL = 'debug';
      const debugLogger = Logger.getInstance();
      
      debugLogger.debug('Test debug', { data: 'test' });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('[DEBUG]'),
        { data: 'test' }
      );
    });
  });

  describe('Specialized Logging Methods', () => {
    it('should log user actions', () => {
      logger.logUserAction('user1', 'document_edit', 'doc1', { operation: 'insert' });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('User action: document_edit'),
        expect.objectContaining({
          userId: 'user1',
          documentId: 'doc1',
          action: 'document_edit',
          operation: 'insert'
        })
      );
    });

    it('should log performance metrics', () => {
      logger.logPerformance('operation_test', 150, { userId: 'user1' });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('Performance: operation_test took 150ms'),
        expect.objectContaining({
          operation: 'operation_test',
          duration: 150,
          userId: 'user1'
        })
      );
    });

    it('should log AI requests', () => {
      logger.logAIRequest('req1', 'user1', 'doc1', 'Test prompt', 'completed', 2000);
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('AI request completed'),
        expect.objectContaining({
          requestId: 'req1',
          userId: 'user1',
          documentId: 'doc1',
          status: 'completed',
          duration: 2000
        })
      );
    });

    it('should log WebSocket events', () => {
      logger.logWebSocketEvent('connection', 'user1', 'doc1', { socketId: 'socket1' });
      
      expect(console.log).toHaveBeenCalledWith(
        expect.stringContaining('WebSocket event: connection'),
        expect.objectContaining({
          event: 'connection',
          userId: 'user1',
          documentId: 'doc1',
          socketId: 'socket1'
        })
      );
    });

    it('should log errors with context', () => {
      const error = new Error('Test error');
      logger.logError(error, 'test context', { userId: 'user1' });
      
      expect(console.error).toHaveBeenCalledWith(
        expect.stringContaining('test context: Test error'),
        expect.objectContaining({
          error: 'Error',
          stack: expect.any(String),
          context: 'test context',
          userId: 'user1'
        })
      );
    });
  });

  describe('Performance Metrics Aggregation', () => {
    it('should aggregate performance metrics', () => {
      // Log multiple performance entries
      logger.logPerformance('operation1', 100);
      logger.logPerformance('operation1', 200);
      logger.logPerformance('operation2', 150);
      
      const metrics = logger.getPerformanceMetrics(600000); // 10 minutes
      
      expect(metrics.totalOperations).toBe(3);
      expect(metrics.operationStats.operation1).toEqual({
        count: 2,
        totalDuration: 300,
        avgDuration: 150
      });
      expect(metrics.operationStats.operation2).toEqual({
        count: 1,
        totalDuration: 150,
        avgDuration: 150
      });
    });

    it('should filter metrics by time window', () => {
      logger.logPerformance('operation1', 100);
      
      // Get metrics for a very short time window (should be empty)
      const metrics = logger.getPerformanceMetrics(1); // 1ms
      
      expect(metrics.totalOperations).toBe(0);
    });
  });

  describe('File Logging', () => {
    it('should create log streams in non-test environment', () => {
      const originalEnv = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      
      // Create new logger instance
      (Logger as any).instance = undefined;
      const prodLogger = Logger.getInstance();
      
      expect(createWriteStream).toHaveBeenCalledWith(
        expect.stringContaining('app.log'),
        { flags: 'a' }
      );
      expect(createWriteStream).toHaveBeenCalledWith(
        expect.stringContaining('error.log'),
        { flags: 'a' }
      );
      
      process.env.NODE_ENV = originalEnv;
      prodLogger.close();
    });
  });
});