import { EventEmitter } from 'events';

export interface Metric {
  name: string;
  value: number;
  timestamp: number;
  tags?: { [key: string]: string };
}

export interface SystemMetrics {
  memory: {
    heapUsed: number;
    heapTotal: number;
    external: number;
    rss: number;
  };
  cpu: {
    usage: number;
  };
  connections: {
    active: number;
    total: number;
  };
  documents: {
    active: number;
    operations: number;
  };
  ai: {
    requestsInQueue: number;
    averageProcessingTime: number;
    successRate: number;
  };
}

export class MetricsCollector extends EventEmitter {
  private static instance: MetricsCollector;
  private metrics: Map<string, Metric[]> = new Map();
  private counters: Map<string, number> = new Map();
  private gauges: Map<string, number> = new Map();
  private histograms: Map<string, number[]> = new Map();
  private readonly maxMetricsPerType = 1000;
  private collectionInterval: NodeJS.Timeout | null = null;

  private constructor() {
    super();
    this.startCollection();
  }

  public static getInstance(): MetricsCollector {
    if (!MetricsCollector.instance) {
      MetricsCollector.instance = new MetricsCollector();
    }
    return MetricsCollector.instance;
  }

  private startCollection(): void {
    // Collect system metrics every 30 seconds
    this.collectionInterval = setInterval(() => {
      this.collectSystemMetrics();
    }, 30000);
  }

  private collectSystemMetrics(): void {
    const memUsage = process.memoryUsage();
    const cpuUsage = process.cpuUsage();

    // Memory metrics
    this.recordGauge('system.memory.heap_used', memUsage.heapUsed);
    this.recordGauge('system.memory.heap_total', memUsage.heapTotal);
    this.recordGauge('system.memory.external', memUsage.external);
    this.recordGauge('system.memory.rss', memUsage.rss);

    // CPU metrics (simplified - in production, use proper CPU monitoring)
    this.recordGauge('system.cpu.user', cpuUsage.user);
    this.recordGauge('system.cpu.system', cpuUsage.system);

    this.emit('system_metrics_collected', {
      memory: memUsage,
      cpu: cpuUsage,
      timestamp: Date.now()
    });
  }

  // Counter methods
  public incrementCounter(name: string, value: number = 1, tags?: { [key: string]: string }): void {
    const current = this.counters.get(name) || 0;
    this.counters.set(name, current + value);
    
    this.recordMetric(name, current + value, tags);
    this.emit('counter_incremented', { name, value: current + value, tags });
  }

  public getCounter(name: string): number {
    return this.counters.get(name) || 0;
  }

  // Gauge methods
  public recordGauge(name: string, value: number, tags?: { [key: string]: string }): void {
    this.gauges.set(name, value);
    this.recordMetric(name, value, tags);
    this.emit('gauge_recorded', { name, value, tags });
  }

  public getGauge(name: string): number | undefined {
    return this.gauges.get(name);
  }

  // Histogram methods
  public recordHistogram(name: string, value: number, tags?: { [key: string]: string }): void {
    if (!this.histograms.has(name)) {
      this.histograms.set(name, []);
    }
    
    const values = this.histograms.get(name)!;
    values.push(value);
    
    // Keep only recent values
    if (values.length > this.maxMetricsPerType) {
      values.shift();
    }
    
    this.recordMetric(name, value, tags);
    this.emit('histogram_recorded', { name, value, tags });
  }

  public getHistogramStats(name: string): { count: number; min: number; max: number; avg: number; p95: number } | null {
    const values = this.histograms.get(name);
    if (!values || values.length === 0) return null;

    const sorted = [...values].sort((a, b) => a - b);
    const count = sorted.length;
    const min = sorted[0];
    const max = sorted[count - 1];
    const avg = sorted.reduce((sum, val) => sum + val, 0) / count;
    const p95Index = Math.floor(count * 0.95);
    const p95 = sorted[p95Index];

    return { count, min, max, avg, p95 };
  }

  // Generic metric recording
  private recordMetric(name: string, value: number, tags?: { [key: string]: string }): void {
    if (!this.metrics.has(name)) {
      this.metrics.set(name, []);
    }

    const metricArray = this.metrics.get(name)!;
    metricArray.push({
      name,
      value,
      timestamp: Date.now(),
      tags
    });

    // Keep only recent metrics
    if (metricArray.length > this.maxMetricsPerType) {
      metricArray.shift();
    }
  }

  // Application-specific metrics
  public recordWebSocketConnection(connected: boolean): void {
    if (connected) {
      this.incrementCounter('websocket.connections.total');
      this.incrementCounter('websocket.connections.active');
    } else {
      this.incrementCounter('websocket.connections.active', -1);
    }
  }

  public recordDocumentOperation(operation: string, duration: number, userId?: string, documentId?: string): void {
    this.incrementCounter(`document.operations.${operation}`);
    this.recordHistogram('document.operation.duration', duration, {
      operation,
      userId: userId || 'unknown',
      documentId: documentId || 'unknown'
    });
  }

  public recordAIRequest(status: 'started' | 'completed' | 'failed', duration?: number): void {
    this.incrementCounter(`ai.requests.${status}`);
    
    if (duration !== undefined) {
      this.recordHistogram('ai.request.duration', duration, { status });
    }
  }

  public recordAIQueueSize(size: number): void {
    this.recordGauge('ai.queue.size', size);
  }

  public recordDocumentCount(count: number): void {
    this.recordGauge('documents.active', count);
  }

  public recordUserCount(count: number): void {
    this.recordGauge('users.active', count);
  }

  // Get comprehensive system metrics
  public getSystemMetrics(): SystemMetrics {
    const memUsage = process.memoryUsage();
    
    return {
      memory: {
        heapUsed: memUsage.heapUsed,
        heapTotal: memUsage.heapTotal,
        external: memUsage.external,
        rss: memUsage.rss
      },
      cpu: {
        usage: this.getGauge('system.cpu.usage') || 0
      },
      connections: {
        active: this.getCounter('websocket.connections.active'),
        total: this.getCounter('websocket.connections.total')
      },
      documents: {
        active: this.getGauge('documents.active') || 0,
        operations: this.getCounter('document.operations.total') || 0
      },
      ai: {
        requestsInQueue: this.getGauge('ai.queue.size') || 0,
        averageProcessingTime: this.getHistogramStats('ai.request.duration')?.avg || 0,
        successRate: this.calculateAISuccessRate()
      }
    };
  }

  private calculateAISuccessRate(): number {
    const completed = this.getCounter('ai.requests.completed');
    const failed = this.getCounter('ai.requests.failed');
    const total = completed + failed;
    
    return total > 0 ? (completed / total) * 100 : 0;
  }

  // Export metrics in Prometheus format
  public exportPrometheusMetrics(): string {
    let output = '';

    // Counters
    this.counters.forEach((value, name) => {
      output += `# TYPE ${name.replace(/\./g, '_')} counter\n`;
      output += `${name.replace(/\./g, '_')} ${value}\n`;
    });

    // Gauges
    this.gauges.forEach((value, name) => {
      output += `# TYPE ${name.replace(/\./g, '_')} gauge\n`;
      output += `${name.replace(/\./g, '_')} ${value}\n`;
    });

    // Histograms
    this.histograms.forEach((values, name) => {
      const stats = this.getHistogramStats(name);
      if (stats) {
        const metricName = name.replace(/\./g, '_');
        output += `# TYPE ${metricName} histogram\n`;
        output += `${metricName}_count ${stats.count}\n`;
        output += `${metricName}_sum ${stats.avg * stats.count}\n`;
        output += `${metricName}_bucket{le="0.1"} ${values.filter(v => v <= 100).length}\n`;
        output += `${metricName}_bucket{le="0.5"} ${values.filter(v => v <= 500).length}\n`;
        output += `${metricName}_bucket{le="1.0"} ${values.filter(v => v <= 1000).length}\n`;
        output += `${metricName}_bucket{le="+Inf"} ${values.length}\n`;
      }
    });

    return output;
  }

  // Get metrics for a specific time range
  public getMetricsInRange(name: string, startTime: number, endTime: number): Metric[] {
    const metrics = this.metrics.get(name) || [];
    return metrics.filter(metric => 
      metric.timestamp >= startTime && metric.timestamp <= endTime
    );
  }

  // Clear old metrics
  public clearOldMetrics(olderThan: number = 3600000): void { // 1 hour default
    const cutoff = Date.now() - olderThan;
    
    this.metrics.forEach((metricArray, name) => {
      const filtered = metricArray.filter(metric => metric.timestamp > cutoff);
      this.metrics.set(name, filtered);
    });
  }

  public stop(): void {
    if (this.collectionInterval) {
      clearInterval(this.collectionInterval);
      this.collectionInterval = null;
    }
  }
}