import { IntegrationTestSetup, TestServer, TestClient } from './setup';
import { Logger } from '../../backend/src/utils/Logger';
import { MetricsCollector } from '../../backend/src/utils/MetricsCollector';
import request from 'supertest';
import express from 'express';

describe('Monitoring and Logging System Integration Tests', () => {
  let testSetup: IntegrationTestSetup;
  let server: TestServer;
  let logger: Logger;
  let metricsCollector: MetricsCollector;

  beforeAll(async () => {
    testSetup = new IntegrationTestSetup();
    server = await testSetup.createTestServer();
    logger = Logger.getInstance();
    metricsCollector = MetricsCollector.getInstance();
  });

  afterAll(async () => {
    await testSetup.cleanup();
  });

  describe('Health Check Endpoints', () => {
    it('should provide basic health status', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/health', healthController.healthCheck.bind(healthController));
      
      const response = await request(app).get('/health');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/healthy|degraded|unhealthy/),
        timestamp: expect.any(String),
        version: expect.any(String),
        uptime: expect.any(Number),
        checks: expect.any(Object)
      });
    });

    it('should provide detailed health information', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/health/detailed', healthController.detailedHealthCheck.bind(healthController));
      
      const response = await request(app).get('/health/detailed');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        status: expect.any(String),
        checks: expect.any(Object),
        metrics: expect.objectContaining({
          memory: expect.any(Object),
          connections: expect.any(Object),
          documents: expect.any(Object),
          ai: expect.any(Object)
        })
      });
    });

    it('should provide readiness probe for Kubernetes', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/health/ready', healthController.readinessCheck.bind(healthController));
      
      const response = await request(app).get('/health/ready');
      
      expect([200, 503]).toContain(response.status);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/ready|not_ready/),
        checks: expect.any(Object)
      });
    });

    it('should provide liveness probe for Kubernetes', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/health/live', healthController.livenessCheck.bind(healthController));
      
      const response = await request(app).get('/health/live');
      
      expect([200, 503]).toContain(response.status);
      expect(response.body).toMatchObject({
        status: expect.stringMatching(/alive|not_alive/),
        uptime: expect.any(Number)
      });
    });
  });

  describe('Metrics Collection and Exposure', () => {
    it('should collect and expose system metrics in JSON format', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/metrics', healthController.getMetrics.bind(healthController));
      
      // Generate some metrics
      metricsCollector.incrementCounter('test.requests', 5);
      metricsCollector.recordGauge('test.active_users', 10);
      metricsCollector.recordHistogram('test.response_time', 150);
      
      const response = await request(app).get('/metrics');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        metrics: expect.objectContaining({
          memory: expect.any(Object),
          connections: expect.any(Object),
          documents: expect.any(Object),
          ai: expect.any(Object)
        })
      });
    });

    it('should expose metrics in Prometheus format', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/metrics', healthController.getMetrics.bind(healthController));
      
      // Generate some metrics
      metricsCollector.incrementCounter('prometheus.test.counter', 3);
      metricsCollector.recordGauge('prometheus.test.gauge', 42);
      
      const response = await request(app)
        .get('/metrics')
        .query({ format: 'prometheus' });
      
      expect(response.status).toBe(200);
      expect(response.headers['content-type']).toBe('text/plain; charset=utf-8');
      expect(response.text).toContain('# TYPE prometheus_test_counter counter');
      expect(response.text).toContain('prometheus_test_counter 3');
      expect(response.text).toContain('# TYPE prometheus_test_gauge gauge');
      expect(response.text).toContain('prometheus_test_gauge 42');
    });

    it('should provide performance metrics with time windows', async () => {
      const app = express();
      const { HealthController } = require('../../backend/src/controllers/HealthController');
      const healthController = new HealthController();
      
      app.get('/metrics/performance', healthController.getPerformanceMetrics.bind(healthController));
      
      // Generate some performance data
      logger.logPerformance('test.operation', 100);
      logger.logPerformance('test.operation', 200);
      logger.logPerformance('another.operation', 150);
      
      const response = await request(app).get('/metrics/performance');
      
      expect(response.status).toBe(200);
      expect(response.body).toMatchObject({
        timestamp: expect.any(String),
        timeWindow: expect.any(Number),
        performance: expect.objectContaining({
          totalOperations: expect.any(Number),
          operationStats: expect.any(Object)
        })
      });
    });
  });

  describe('Application Logging', () => {
    it('should log user actions with proper context', async () => {
      const client = await testSetup.createTestClient(server.port, 'logging-user-1');
      const documentId = 'logging-doc-1';

      // Join document (should generate logs)
      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Make an edit (should generate logs)
      const operation = {
        type: 'insert',
        position: 0,
        content: 'Test logging',
        userId: 'logging-user-1',
        timestamp: new Date(),
        version: 1
      };

      client.socket.emit('operation', operation);
      await testSetup.waitForEvent(client, 'operation_applied');

      // Verify metrics were collected
      expect(metricsCollector.getCounter('websocket.connections.total')).toBeGreaterThan(0);
      expect(metricsCollector.getCounter('websocket.messages.total')).toBeGreaterThan(0);

      client.disconnect();
    });

    it('should log AI requests with performance metrics', async () => {
      const client = await testSetup.createTestClient(server.port, 'ai-logging-user');
      const documentId = 'ai-logging-doc';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Add content for AI processing
      client.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'Content for AI logging test',
        userId: 'ai-logging-user',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client, 'operation_applied');

      // Make AI request
      const aiRequest = {
        documentId,
        selectedText: 'Content for AI logging test',
        prompt: 'Improve this text',
        selectionStart: 0,
        selectionEnd: 27
      };

      const startTime = Date.now();
      client.socket.emit('ai_request', aiRequest);
      const aiResponse = await testSetup.waitForEvent(client, 'ai_response', 15000);
      const duration = Date.now() - startTime;

      expect(aiResponse.status).toBe('completed');

      // Verify AI metrics were collected
      expect(metricsCollector.getCounter('ai.requests.started')).toBeGreaterThan(0);
      expect(metricsCollector.getCounter('ai.requests.completed')).toBeGreaterThan(0);

      // Verify performance was logged
      const aiStats = metricsCollector.getHistogramStats('ai.request.duration');
      expect(aiStats).toBeTruthy();
      expect(aiStats!.count).toBeGreaterThan(0);

      client.disconnect();
    });

    it('should log errors with proper context and stack traces', async () => {
      const client = await testSetup.createTestClient(server.port, 'error-logging-user');

      // Try to join invalid document (should generate error logs)
      client.socket.emit('join_document', { documentId: '' });
      const errorResponse = await testSetup.waitForEvent(client, 'error');

      expect(errorResponse.type).toBeDefined();

      // Verify error metrics were collected
      expect(metricsCollector.getCounter('websocket.errors.total')).toBeGreaterThan(0);

      client.disconnect();
    });
  });

  describe('Performance Monitoring', () => {
    it('should track operation latencies and throughput', async () => {
      const client = await testSetup.createTestClient(server.port, 'perf-monitoring-user');
      const documentId = 'perf-monitoring-doc';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      const operationCount = 20;
      const startTime = Date.now();

      // Perform multiple operations
      for (let i = 0; i < operationCount; i++) {
        const operation = {
          type: 'insert',
          position: i * 5,
          content: `Op${i}`,
          userId: 'perf-monitoring-user',
          timestamp: new Date(),
          version: i + 1
        };

        client.socket.emit('operation', operation);
        await testSetup.waitForEvent(client, 'operation_applied');
      }

      const totalTime = Date.now() - startTime;
      const avgLatency = totalTime / operationCount;

      // Verify performance metrics
      const operationStats = metricsCollector.getHistogramStats('websocket.operation.duration');
      expect(operationStats).toBeTruthy();
      expect(operationStats!.count).toBeGreaterThanOrEqual(operationCount);

      console.log(`Performance monitoring test: ${operationCount} operations in ${totalTime}ms, avg latency: ${avgLatency}ms`);

      client.disconnect();
    });

    it('should monitor memory usage and system resources', async () => {
      // Get initial memory metrics
      const initialMetrics = metricsCollector.getSystemMetrics();
      expect(initialMetrics.memory.heapUsed).toBeGreaterThan(0);
      expect(initialMetrics.memory.heapTotal).toBeGreaterThan(0);

      // Create multiple clients to increase memory usage
      const clients: TestClient[] = [];
      for (let i = 0; i < 5; i++) {
        const client = await testSetup.createTestClient(server.port, `memory-test-user-${i}`);
        clients.push(client);
      }

      // Get updated metrics
      const updatedMetrics = metricsCollector.getSystemMetrics();
      expect(updatedMetrics.connections.active).toBe(5);
      expect(updatedMetrics.connections.total).toBeGreaterThanOrEqual(5);

      // Cleanup
      clients.forEach(client => client.disconnect());
    });
  });

  describe('Alerting and Monitoring Integration', () => {
    it('should detect and report high error rates', async () => {
      const initialErrorCount = metricsCollector.getCounter('websocket.errors.total');

      // Generate multiple errors
      for (let i = 0; i < 5; i++) {
        const client = await testSetup.createTestClient(server.port, `error-gen-user-${i}`);
        
        // Send invalid operation to generate error
        client.socket.emit('operation', { invalid: 'operation' });
        
        try {
          await testSetup.waitForEvent(client, 'error', 2000);
        } catch (error) {
          // Expected timeout for invalid operations
        }
        
        client.disconnect();
      }

      const finalErrorCount = metricsCollector.getCounter('websocket.errors.total');
      expect(finalErrorCount).toBeGreaterThan(initialErrorCount);
    });

    it('should monitor AI service health and performance', async () => {
      const client = await testSetup.createTestClient(server.port, 'ai-health-user');
      const documentId = 'ai-health-doc';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Add content
      client.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'AI health monitoring test content',
        userId: 'ai-health-user',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client, 'operation_applied');

      // Make AI request to test service health
      const aiRequest = {
        documentId,
        selectedText: 'AI health monitoring test content',
        prompt: 'Test AI service health',
        selectionStart: 0,
        selectionEnd: 33
      };

      client.socket.emit('ai_request', aiRequest);
      const aiResponse = await testSetup.waitForEvent(client, 'ai_response', 15000);

      // Verify AI service metrics
      const systemMetrics = metricsCollector.getSystemMetrics();
      expect(systemMetrics.ai.successRate).toBeGreaterThanOrEqual(0);
      expect(systemMetrics.ai.averageProcessingTime).toBeGreaterThanOrEqual(0);

      client.disconnect();
    });

    it('should provide comprehensive system health overview', async () => {
      // Generate various types of activity
      const client = await testSetup.createTestClient(server.port, 'health-overview-user');
      const documentId = 'health-overview-doc';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Document operations
      client.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'Health overview test',
        userId: 'health-overview-user',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client, 'operation_applied');

      // Get comprehensive system metrics
      const systemMetrics = metricsCollector.getSystemMetrics();

      expect(systemMetrics).toMatchObject({
        memory: expect.objectContaining({
          heapUsed: expect.any(Number),
          heapTotal: expect.any(Number),
          external: expect.any(Number),
          rss: expect.any(Number)
        }),
        cpu: expect.objectContaining({
          usage: expect.any(Number)
        }),
        connections: expect.objectContaining({
          active: expect.any(Number),
          total: expect.any(Number)
        }),
        documents: expect.objectContaining({
          active: expect.any(Number),
          operations: expect.any(Number)
        }),
        ai: expect.objectContaining({
          requestsInQueue: expect.any(Number),
          averageProcessingTime: expect.any(Number),
          successRate: expect.any(Number)
        })
      });

      console.log('System Health Overview:', JSON.stringify(systemMetrics, null, 2));

      client.disconnect();
    });
  });
});