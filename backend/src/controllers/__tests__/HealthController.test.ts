import { Request, Response } from 'express';
import { HealthController } from '../HealthController';
import { Logger } from '../../utils/Logger';
import { MetricsCollector } from '../../utils/MetricsCollector';

// Mock dependencies
jest.mock('../../utils/Logger');
jest.mock('../../utils/MetricsCollector');
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    ping: jest.fn(),
    disconnect: jest.fn()
  }))
}));

describe('HealthController', () => {
  let healthController: HealthController;
  let mockRequest: Partial<Request>;
  let mockResponse: Partial<Response>;
  let mockLogger: jest.Mocked<Logger>;
  let mockMetricsCollector: jest.Mocked<MetricsCollector>;

  beforeEach(() => {
    // Reset mocks
    jest.clearAllMocks();
    
    // Mock Logger
    mockLogger = {
      debug: jest.fn(),
      error: jest.fn(),
      getPerformanceMetrics: jest.fn()
    } as any;
    (Logger.getInstance as jest.Mock).mockReturnValue(mockLogger);
    
    // Mock MetricsCollector
    mockMetricsCollector = {
      getCounter: jest.fn(),
      getGauge: jest.fn(),
      getSystemMetrics: jest.fn(),
      exportPrometheusMetrics: jest.fn()
    } as any;
    (MetricsCollector.getInstance as jest.Mock).mockReturnValue(mockMetricsCollector);
    
    healthController = new HealthController();
    
    // Mock Express request and response
    mockRequest = {
      query: {}
    };
    
    mockResponse = {
      status: jest.fn().mockReturnThis(),
      json: jest.fn().mockReturnThis(),
      set: jest.fn().mockReturnThis(),
      send: jest.fn().mockReturnThis()
    };
  });

  describe('healthCheck', () => {
    it('should return healthy status when all checks pass', async () => {
      // Mock successful Redis connection
      const { createClient } = require('redis');
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        ping: jest.fn().mockResolvedValue('PONG'),
        disconnect: jest.fn().mockResolvedValue(undefined)
      };
      createClient.mockReturnValue(mockRedisClient);
      
      await healthController.healthCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'healthy',
          timestamp: expect.any(String),
          version: expect.any(String),
          uptime: expect.any(Number),
          checks: expect.any(Object)
        })
      );
    });

    it('should return unhealthy status when Redis fails', async () => {
      // Mock failed Redis connection
      const { createClient } = require('redis');
      const mockRedisClient = {
        connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
        ping: jest.fn(),
        disconnect: jest.fn()
      };
      createClient.mockReturnValue(mockRedisClient);
      
      await healthController.healthCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy'
        })
      );
    });

    it('should handle health check system failure', async () => {
      // Mock system failure
      jest.spyOn(healthController as any, 'performHealthChecks').mockRejectedValue(new Error('System failure'));
      
      await healthController.healthCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'unhealthy',
          error: 'Health check system failure'
        })
      );
    });
  });

  describe('detailedHealthCheck', () => {
    it('should return detailed health information', async () => {
      mockMetricsCollector.getSystemMetrics.mockReturnValue({
        memory: { heapUsed: 100, heapTotal: 200, external: 50, rss: 150 },
        cpu: { usage: 25 },
        connections: { active: 5, total: 10 },
        documents: { active: 3, operations: 100 },
        ai: { requestsInQueue: 2, averageProcessingTime: 1500, successRate: 95 }
      });
      
      await healthController.detailedHealthCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          metrics: expect.any(Object)
        })
      );
    });
  });

  describe('readinessCheck', () => {
    it('should return ready when critical checks pass', async () => {
      // Mock successful Redis connection
      const { createClient } = require('redis');
      const mockRedisClient = {
        connect: jest.fn().mockResolvedValue(undefined),
        ping: jest.fn().mockResolvedValue('PONG'),
        disconnect: jest.fn().mockResolvedValue(undefined)
      };
      createClient.mockReturnValue(mockRedisClient);
      
      await healthController.readinessCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'ready'
        })
      );
    });

    it('should return not ready when critical checks fail', async () => {
      // Mock failed Redis connection
      const { createClient } = require('redis');
      const mockRedisClient = {
        connect: jest.fn().mockRejectedValue(new Error('Connection failed')),
        ping: jest.fn(),
        disconnect: jest.fn()
      };
      createClient.mockReturnValue(mockRedisClient);
      
      await healthController.readinessCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'not_ready'
        })
      );
    });
  });

  describe('livenessCheck', () => {
    it('should return alive when memory usage is reasonable', async () => {
      // Mock reasonable memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 100 * 1024 * 1024, // 100MB
        heapTotal: 200 * 1024 * 1024,
        external: 50 * 1024 * 1024,
        rss: 150 * 1024 * 1024,
        arrayBuffers: 0
      }) as any;
      
      await healthController.livenessCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(200);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'alive'
        })
      );
      
      process.memoryUsage = originalMemoryUsage;
    });

    it('should return not alive when memory usage is too high', async () => {
      // Mock high memory usage
      const originalMemoryUsage = process.memoryUsage;
      process.memoryUsage = jest.fn().mockReturnValue({
        heapUsed: 2 * 1024 * 1024 * 1024, // 2GB
        heapTotal: 3 * 1024 * 1024 * 1024,
        external: 100 * 1024 * 1024,
        rss: 2.5 * 1024 * 1024 * 1024,
        arrayBuffers: 0
      }) as any;
      
      await healthController.livenessCheck(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(503);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          status: 'not_alive',
          reason: 'Memory usage too high'
        })
      );
      
      process.memoryUsage = originalMemoryUsage;
    });
  });

  describe('getMetrics', () => {
    it('should return JSON metrics by default', async () => {
      mockMetricsCollector.getSystemMetrics.mockReturnValue({
        memory: { heapUsed: 100, heapTotal: 200, external: 50, rss: 150 },
        cpu: { usage: 25 },
        connections: { active: 5, total: 10 },
        documents: { active: 3, operations: 100 },
        ai: { requestsInQueue: 2, averageProcessingTime: 1500, successRate: 95 }
      });
      
      await healthController.getMetrics(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          metrics: expect.any(Object)
        })
      );
    });

    it('should return Prometheus format when requested', async () => {
      mockRequest.query = { format: 'prometheus' };
      mockMetricsCollector.exportPrometheusMetrics.mockReturnValue('# Prometheus metrics\ntest_metric 1');
      
      await healthController.getMetrics(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.set).toHaveBeenCalledWith('Content-Type', 'text/plain');
      expect(mockResponse.send).toHaveBeenCalledWith('# Prometheus metrics\ntest_metric 1');
    });

    it('should handle metrics retrieval failure', async () => {
      mockMetricsCollector.getSystemMetrics.mockImplementation(() => {
        throw new Error('Metrics failure');
      });
      
      await healthController.getMetrics(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to retrieve metrics'
      });
    });
  });

  describe('getPerformanceMetrics', () => {
    it('should return performance metrics with default time window', async () => {
      mockLogger.getPerformanceMetrics.mockReturnValue({
        timeWindow: 300000,
        totalOperations: 100,
        operationStats: {
          'document.operation': { count: 50, totalDuration: 5000, avgDuration: 100 },
          'ai.request': { count: 25, totalDuration: 50000, avgDuration: 2000 }
        }
      });
      
      await healthController.getPerformanceMetrics(mockRequest as Request, mockResponse as Response);
      
      expect(mockLogger.getPerformanceMetrics).toHaveBeenCalledWith(300000);
      expect(mockResponse.json).toHaveBeenCalledWith(
        expect.objectContaining({
          timestamp: expect.any(String),
          timeWindow: 300000,
          performance: expect.any(Object)
        })
      );
    });

    it('should use custom time window when provided', async () => {
      mockRequest.query = { window: '600000' };
      mockLogger.getPerformanceMetrics.mockReturnValue({
        timeWindow: 600000,
        totalOperations: 200,
        operationStats: {}
      });
      
      await healthController.getPerformanceMetrics(mockRequest as Request, mockResponse as Response);
      
      expect(mockLogger.getPerformanceMetrics).toHaveBeenCalledWith(600000);
    });

    it('should handle performance metrics retrieval failure', async () => {
      mockLogger.getPerformanceMetrics.mockImplementation(() => {
        throw new Error('Performance metrics failure');
      });
      
      await healthController.getPerformanceMetrics(mockRequest as Request, mockResponse as Response);
      
      expect(mockResponse.status).toHaveBeenCalledWith(500);
      expect(mockResponse.json).toHaveBeenCalledWith({
        error: 'Failed to retrieve performance metrics'
      });
    });
  });
});