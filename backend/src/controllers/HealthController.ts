import { Request, Response } from 'express';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { createClient } from 'redis';

export interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  version: string;
  uptime: number;
  checks: {
    [key: string]: {
      status: 'pass' | 'fail' | 'warn';
      message?: string;
      duration?: number;
    };
  };
  metrics?: any;
}

export class HealthController {
  private logger: Logger;
  private metricsCollector: MetricsCollector;
  private startTime: number;

  constructor() {
    this.logger = Logger.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
    this.startTime = Date.now();
  }

  // Basic health check endpoint
  public async healthCheck(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.performHealthChecks();
      
      const statusCode = health.status === 'healthy' ? 200 : 
                        health.status === 'degraded' ? 200 : 503;
      
      res.status(statusCode).json(health);
      
      this.logger.debug('Health check performed', { 
        status: health.status,
        checks: Object.keys(health.checks).length
      });
    } catch (error) {
      this.logger.error('Health check failed', { error: (error as Error).message });
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Health check system failure'
      });
    }
  }

  // Detailed health check with all components
  public async detailedHealthCheck(req: Request, res: Response): Promise<void> {
    try {
      const health = await this.performHealthChecks(true);
      res.status(200).json(health);
    } catch (error) {
      this.logger.error('Detailed health check failed', { error: (error as Error).message });
      res.status(503).json({
        status: 'unhealthy',
        timestamp: new Date().toISOString(),
        error: 'Detailed health check system failure'
      });
    }
  }

  // Readiness probe for Kubernetes
  public async readinessCheck(req: Request, res: Response): Promise<void> {
    try {
      const checks = await this.performCriticalChecks();
      const isReady = Object.values(checks).every(check => check.status === 'pass');
      
      if (isReady) {
        res.status(200).json({ status: 'ready', checks });
      } else {
        res.status(503).json({ status: 'not_ready', checks });
      }
    } catch (error) {
      this.logger.error('Readiness check failed', { error: (error as Error).message });
      res.status(503).json({ status: 'not_ready', error: 'Readiness check failure' });
    }
  }

  // Liveness probe for Kubernetes
  public async livenessCheck(req: Request, res: Response): Promise<void> {
    try {
      // Simple liveness check - just verify the process is responsive
      const uptime = Date.now() - this.startTime;
      const memUsage = process.memoryUsage();
      
      // Check if memory usage is reasonable (less than 1GB)
      const isAlive = memUsage.heapUsed < 1024 * 1024 * 1024;
      
      if (isAlive) {
        res.status(200).json({ 
          status: 'alive', 
          uptime,
          memory: memUsage.heapUsed 
        });
      } else {
        res.status(503).json({ 
          status: 'not_alive', 
          reason: 'Memory usage too high',
          memory: memUsage.heapUsed 
        });
      }
    } catch (error) {
      this.logger.error('Liveness check failed', { error: (error as Error).message });
      res.status(503).json({ status: 'not_alive', error: 'Liveness check failure' });
    }
  }

  // Metrics endpoint
  public async getMetrics(req: Request, res: Response): Promise<void> {
    try {
      const format = req.query.format as string || 'json';
      
      if (format === 'prometheus') {
        const prometheusMetrics = this.metricsCollector.exportPrometheusMetrics();
        res.set('Content-Type', 'text/plain');
        res.send(prometheusMetrics);
      } else {
        const systemMetrics = this.metricsCollector.getSystemMetrics();
        res.json({
          timestamp: new Date().toISOString(),
          metrics: systemMetrics
        });
      }
    } catch (error) {
      this.logger.error('Metrics retrieval failed', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to retrieve metrics' });
    }
  }

  // Performance metrics endpoint
  public async getPerformanceMetrics(req: Request, res: Response): Promise<void> {
    try {
      const timeWindow = parseInt(req.query.window as string) || 300000; // 5 minutes default
      const performanceMetrics = this.logger.getPerformanceMetrics(timeWindow);
      
      res.json({
        timestamp: new Date().toISOString(),
        timeWindow,
        performance: performanceMetrics
      });
    } catch (error) {
      this.logger.error('Performance metrics retrieval failed', { error: (error as Error).message });
      res.status(500).json({ error: 'Failed to retrieve performance metrics' });
    }
  }

  private async performHealthChecks(includeMetrics: boolean = false): Promise<HealthStatus> {
    const checks = await this.performAllChecks();
    
    // Determine overall status
    const hasFailures = Object.values(checks).some(check => check.status === 'fail');
    const hasWarnings = Object.values(checks).some(check => check.status === 'warn');
    
    const status = hasFailures ? 'unhealthy' : hasWarnings ? 'degraded' : 'healthy';
    
    const health: HealthStatus = {
      status,
      timestamp: new Date().toISOString(),
      version: process.env.npm_package_version || '1.0.0',
      uptime: Date.now() - this.startTime,
      checks
    };

    if (includeMetrics) {
      health.metrics = this.metricsCollector.getSystemMetrics();
    }

    return health;
  }

  private async performCriticalChecks(): Promise<{ [key: string]: any }> {
    const checks: { [key: string]: any } = {};

    // Redis connectivity check
    checks.redis = await this.checkRedis();
    
    // Memory check
    checks.memory = this.checkMemory();
    
    return checks;
  }

  private async performAllChecks(): Promise<{ [key: string]: any }> {
    const checks: { [key: string]: any } = {};

    // System checks
    checks.memory = this.checkMemory();
    checks.disk = await this.checkDisk();
    checks.process = this.checkProcess();

    // External dependencies
    checks.redis = await this.checkRedis();

    // Application-specific checks
    checks.websocket = this.checkWebSocket();
    checks.ai_service = await this.checkAIService();

    return checks;
  }

  private checkMemory(): { status: string; message?: string; duration?: number } {
    const startTime = Date.now();
    const memUsage = process.memoryUsage();
    const heapUsedMB = memUsage.heapUsed / 1024 / 1024;
    const heapTotalMB = memUsage.heapTotal / 1024 / 1024;
    const duration = Date.now() - startTime;

    if (heapUsedMB > 512) { // More than 512MB
      return {
        status: 'fail',
        message: `High memory usage: ${heapUsedMB.toFixed(2)}MB`,
        duration
      };
    } else if (heapUsedMB > 256) { // More than 256MB
      return {
        status: 'warn',
        message: `Elevated memory usage: ${heapUsedMB.toFixed(2)}MB`,
        duration
      };
    }

    return {
      status: 'pass',
      message: `Memory usage: ${heapUsedMB.toFixed(2)}MB / ${heapTotalMB.toFixed(2)}MB`,
      duration
    };
  }

  private async checkDisk(): Promise<{ status: string; message?: string; duration?: number }> {
    const startTime = Date.now();
    
    try {
      // Simple disk check - in production, use proper disk monitoring
      const stats = await import('fs').then(fs => 
        new Promise((resolve, reject) => {
          fs.stat('.', (err, stats) => {
            if (err) reject(err);
            else resolve(stats);
          });
        })
      );
      
      const duration = Date.now() - startTime;
      return {
        status: 'pass',
        message: 'Disk accessible',
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        status: 'fail',
        message: `Disk check failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private checkProcess(): { status: string; message?: string; duration?: number } {
    const startTime = Date.now();
    const uptime = process.uptime();
    const duration = Date.now() - startTime;

    return {
      status: 'pass',
      message: `Process uptime: ${Math.floor(uptime)}s`,
      duration
    };
  }

  private async checkRedis(): Promise<{ status: string; message?: string; duration?: number }> {
    const startTime = Date.now();
    
    try {
      const client = createClient({
        socket: {
          host: process.env.REDIS_HOST || 'localhost',
          port: parseInt(process.env.REDIS_PORT || '6379'),
          connectTimeout: 5000
        }
      });

      await client.connect();
      await client.ping();
      await client.disconnect();
      
      const duration = Date.now() - startTime;
      return {
        status: 'pass',
        message: 'Redis connection successful',
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        status: 'fail',
        message: `Redis connection failed: ${(error as Error).message}`,
        duration
      };
    }
  }

  private checkWebSocket(): { status: string; message?: string; duration?: number } {
    const startTime = Date.now();
    
    // Check WebSocket metrics
    const activeConnections = this.metricsCollector.getCounter('websocket.connections.active');
    const totalConnections = this.metricsCollector.getCounter('websocket.connections.total');
    
    const duration = Date.now() - startTime;
    
    return {
      status: 'pass',
      message: `WebSocket: ${activeConnections} active, ${totalConnections} total connections`,
      duration
    };
  }

  private async checkAIService(): Promise<{ status: string; message?: string; duration?: number }> {
    const startTime = Date.now();
    
    try {
      // Check AI service health by looking at recent metrics
      const queueSize = this.metricsCollector.getGauge('ai.queue.size') || 0;
      const successRate = this.metricsCollector.getSystemMetrics().ai.successRate;
      
      const duration = Date.now() - startTime;
      
      if (queueSize > 100) {
        return {
          status: 'warn',
          message: `AI queue size high: ${queueSize}`,
          duration
        };
      }
      
      if (successRate < 90 && successRate > 0) {
        return {
          status: 'warn',
          message: `AI success rate low: ${successRate.toFixed(1)}%`,
          duration
        };
      }
      
      return {
        status: 'pass',
        message: `AI service: ${queueSize} queued, ${successRate.toFixed(1)}% success rate`,
        duration
      };
    } catch (error) {
      const duration = Date.now() - startTime;
      return {
        status: 'fail',
        message: `AI service check failed: ${(error as Error).message}`,
        duration
      };
    }
  }
}