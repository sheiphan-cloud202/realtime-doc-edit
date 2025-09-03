import { MetricsCollector } from '../MetricsCollector';

describe('MetricsCollector', () => {
  let metricsCollector: MetricsCollector;

  beforeEach(() => {
    // Reset singleton instance
    (MetricsCollector as any).instance = undefined;
    metricsCollector = MetricsCollector.getInstance();
  });

  afterEach(() => {
    metricsCollector.stop();
  });

  describe('Singleton Pattern', () => {
    it('should return the same instance', () => {
      const collector1 = MetricsCollector.getInstance();
      const collector2 = MetricsCollector.getInstance();
      expect(collector1).toBe(collector2);
    });
  });

  describe('Counter Metrics', () => {
    it('should increment counters', () => {
      metricsCollector.incrementCounter('test.counter', 5);
      expect(metricsCollector.getCounter('test.counter')).toBe(5);
      
      metricsCollector.incrementCounter('test.counter', 3);
      expect(metricsCollector.getCounter('test.counter')).toBe(8);
    });

    it('should increment by 1 by default', () => {
      metricsCollector.incrementCounter('test.counter');
      expect(metricsCollector.getCounter('test.counter')).toBe(1);
    });

    it('should return 0 for non-existent counters', () => {
      expect(metricsCollector.getCounter('non.existent')).toBe(0);
    });
  });

  describe('Gauge Metrics', () => {
    it('should record gauge values', () => {
      metricsCollector.recordGauge('test.gauge', 42);
      expect(metricsCollector.getGauge('test.gauge')).toBe(42);
      
      metricsCollector.recordGauge('test.gauge', 100);
      expect(metricsCollector.getGauge('test.gauge')).toBe(100);
    });

    it('should return undefined for non-existent gauges', () => {
      expect(metricsCollector.getGauge('non.existent')).toBeUndefined();
    });
  });

  describe('Histogram Metrics', () => {
    it('should record histogram values', () => {
      metricsCollector.recordHistogram('test.histogram', 100);
      metricsCollector.recordHistogram('test.histogram', 200);
      metricsCollector.recordHistogram('test.histogram', 150);
      
      const stats = metricsCollector.getHistogramStats('test.histogram');
      
      expect(stats).toEqual({
        count: 3,
        min: 100,
        max: 200,
        avg: 150,
        p95: 200
      });
    });

    it('should return null for non-existent histograms', () => {
      expect(metricsCollector.getHistogramStats('non.existent')).toBeNull();
    });

    it('should calculate percentiles correctly', () => {
      // Add 100 values
      for (let i = 1; i <= 100; i++) {
        metricsCollector.recordHistogram('test.percentiles', i);
      }
      
      const stats = metricsCollector.getHistogramStats('test.percentiles');
      
      expect(stats?.count).toBe(100);
      expect(stats?.min).toBe(1);
      expect(stats?.max).toBe(100);
      expect(stats?.avg).toBe(50.5);
      expect(stats?.p95).toBe(95);
    });
  });

  describe('Application-Specific Metrics', () => {
    it('should record WebSocket connections', () => {
      metricsCollector.recordWebSocketConnection(true);
      expect(metricsCollector.getCounter('websocket.connections.total')).toBe(1);
      expect(metricsCollector.getCounter('websocket.connections.active')).toBe(1);
      
      metricsCollector.recordWebSocketConnection(false);
      expect(metricsCollector.getCounter('websocket.connections.total')).toBe(1);
      expect(metricsCollector.getCounter('websocket.connections.active')).toBe(0);
    });

    it('should record document operations', () => {
      metricsCollector.recordDocumentOperation('insert', 150, 'user1', 'doc1');
      
      expect(metricsCollector.getCounter('document.operations.insert')).toBe(1);
      
      const stats = metricsCollector.getHistogramStats('document.operation.duration');
      expect(stats?.count).toBe(1);
      expect(stats?.avg).toBe(150);
    });

    it('should record AI requests', () => {
      metricsCollector.recordAIRequest('started');
      metricsCollector.recordAIRequest('completed', 2000);
      metricsCollector.recordAIRequest('failed', 1000);
      
      expect(metricsCollector.getCounter('ai.requests.started')).toBe(1);
      expect(metricsCollector.getCounter('ai.requests.completed')).toBe(1);
      expect(metricsCollector.getCounter('ai.requests.failed')).toBe(1);
      
      const stats = metricsCollector.getHistogramStats('ai.request.duration');
      expect(stats?.count).toBe(2);
    });

    it('should record AI queue size', () => {
      metricsCollector.recordAIQueueSize(5);
      expect(metricsCollector.getGauge('ai.queue.size')).toBe(5);
    });

    it('should record document and user counts', () => {
      metricsCollector.recordDocumentCount(10);
      metricsCollector.recordUserCount(25);
      
      expect(metricsCollector.getGauge('documents.active')).toBe(10);
      expect(metricsCollector.getGauge('users.active')).toBe(25);
    });
  });

  describe('System Metrics', () => {
    it('should return comprehensive system metrics', () => {
      // Set up some test data
      metricsCollector.recordWebSocketConnection(true);
      metricsCollector.recordWebSocketConnection(true);
      metricsCollector.recordDocumentCount(5);
      metricsCollector.recordAIRequest('completed', 1500);
      metricsCollector.recordAIRequest('failed', 500);
      metricsCollector.recordAIQueueSize(3);
      
      const systemMetrics = metricsCollector.getSystemMetrics();
      
      expect(systemMetrics).toMatchObject({
        memory: expect.objectContaining({
          heapUsed: expect.any(Number),
          heapTotal: expect.any(Number),
          external: expect.any(Number),
          rss: expect.any(Number)
        }),
        connections: {
          active: 2,
          total: 2
        },
        documents: {
          active: 5,
          operations: 0
        },
        ai: {
          requestsInQueue: 3,
          averageProcessingTime: 1000, // (1500 + 500) / 2
          successRate: 50 // 1 completed out of 2 total
        }
      });
    });
  });

  describe('Prometheus Export', () => {
    it('should export metrics in Prometheus format', () => {
      metricsCollector.incrementCounter('test.counter', 5);
      metricsCollector.recordGauge('test.gauge', 42);
      metricsCollector.recordHistogram('test.histogram', 100);
      metricsCollector.recordHistogram('test.histogram', 200);
      
      const prometheusOutput = metricsCollector.exportPrometheusMetrics();
      
      expect(prometheusOutput).toContain('# TYPE test_counter counter');
      expect(prometheusOutput).toContain('test_counter 5');
      expect(prometheusOutput).toContain('# TYPE test_gauge gauge');
      expect(prometheusOutput).toContain('test_gauge 42');
      expect(prometheusOutput).toContain('# TYPE test_histogram histogram');
      expect(prometheusOutput).toContain('test_histogram_count 2');
    });
  });

  describe('Event Emission', () => {
    it('should emit events when metrics are recorded', (done) => {
      let eventCount = 0;
      
      metricsCollector.on('counter_incremented', (data) => {
        expect(data.name).toBe('test.event.counter');
        expect(data.value).toBe(1);
        eventCount++;
      });
      
      metricsCollector.on('gauge_recorded', (data) => {
        expect(data.name).toBe('test.event.gauge');
        expect(data.value).toBe(50);
        eventCount++;
      });
      
      metricsCollector.on('histogram_recorded', (data) => {
        expect(data.name).toBe('test.event.histogram');
        expect(data.value).toBe(75);
        eventCount++;
        
        if (eventCount === 3) {
          done();
        }
      });
      
      metricsCollector.incrementCounter('test.event.counter');
      metricsCollector.recordGauge('test.event.gauge', 50);
      metricsCollector.recordHistogram('test.event.histogram', 75);
    });
  });

  describe('Memory Management', () => {
    it('should limit the number of stored metrics', () => {
      const maxMetrics = 1000;
      
      // Record more than the maximum
      for (let i = 0; i < maxMetrics + 100; i++) {
        metricsCollector.recordHistogram('test.memory', i);
      }
      
      const stats = metricsCollector.getHistogramStats('test.memory');
      expect(stats?.count).toBe(maxMetrics);
    });

    it('should clear old metrics', () => {
      metricsCollector.recordHistogram('test.cleanup', 100);
      
      // Clear metrics older than 0ms (should clear everything)
      metricsCollector.clearOldMetrics(0);
      
      const stats = metricsCollector.getHistogramStats('test.cleanup');
      expect(stats?.count).toBe(0);
    });
  });
});