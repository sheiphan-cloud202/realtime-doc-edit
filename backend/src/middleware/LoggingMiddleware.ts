import { Request, Response, NextFunction } from 'express';
import { Logger } from '../utils/Logger';
import { MetricsCollector } from '../utils/MetricsCollector';
import { v4 as uuidv4 } from 'uuid';

// Extend Request interface to include logging context
declare global {
  namespace Express {
    interface Request {
      requestId?: string;
      startTime?: number;
      userId?: string;
    }
  }
}

export class LoggingMiddleware {
  private logger: Logger;
  private metricsCollector: MetricsCollector;

  constructor() {
    this.logger = Logger.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
  }

  // Request logging middleware
  public requestLogger = (req: Request, res: Response, next: NextFunction): void => {
    // Generate unique request ID
    req.requestId = uuidv4();
    req.startTime = Date.now();

    // Extract user ID from headers or auth
    req.userId = req.headers['x-user-id'] as string || 'anonymous';

    // Log incoming request
    this.logger.info('Incoming request', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      userAgent: req.headers['user-agent'],
      ip: req.ip,
      userId: req.userId
    });

    // Override res.end to log response
    const originalEnd = res.end;
    res.end = function(chunk?: any, encoding?: any) {
      const duration = Date.now() - (req.startTime || 0);
      
      // Log response
      const logger = Logger.getInstance();
      logger.info('Request completed', {
        requestId: req.requestId,
        method: req.method,
        url: req.url,
        statusCode: res.statusCode,
        duration,
        userId: req.userId
      });

      // Record metrics
      const metricsCollector = MetricsCollector.getInstance();
      metricsCollector.incrementCounter('http.requests.total', 1, {
        method: req.method,
        status: res.statusCode.toString()
      });
      metricsCollector.recordHistogram('http.request.duration', duration, {
        method: req.method,
        endpoint: req.route?.path || req.url
      });

      // Call original end and return the result
      return originalEnd.call(this, chunk, encoding);
    };

    next();
  };

  // Error logging middleware
  public errorLogger = (error: Error, req: Request, res: Response, next: NextFunction): void => {
    const duration = Date.now() - (req.startTime || 0);

    this.logger.error('Request error', {
      requestId: req.requestId,
      method: req.method,
      url: req.url,
      error: error.message,
      stack: error.stack,
      duration,
      userId: req.userId
    });

    // Record error metrics
    this.metricsCollector.incrementCounter('http.errors.total', 1, {
      method: req.method,
      error: error.name
    });

    next(error);
  };

  // Performance monitoring middleware
  public performanceMonitor = (req: Request, res: Response, next: NextFunction): void => {
    const startTime = Date.now();

    // Monitor response time
    res.on('finish', () => {
      const duration = Date.now() - startTime;
      
      // Log slow requests (> 1 second)
      if (duration > 1000) {
        this.logger.warn('Slow request detected', {
          requestId: req.requestId,
          method: req.method,
          url: req.url,
          duration,
          userId: req.userId
        });
      }

      // Record performance metrics
      this.logger.logPerformance(`HTTP ${req.method} ${req.url}`, duration, {
        requestId: req.requestId,
        statusCode: res.statusCode,
        userId: req.userId
      });
    });

    next();
  };

  // Rate limiting logger
  public rateLimitLogger = (req: Request, res: Response, next: NextFunction): void => {
    // Check if this is a rate-limited request
    if (res.getHeader('X-RateLimit-Remaining') === '0') {
      this.logger.warn('Rate limit reached', {
        requestId: req.requestId,
        method: req.method,
        url: req.url,
        ip: req.ip,
        userId: req.userId
      });

      this.metricsCollector.incrementCounter('http.rate_limited.total', 1, {
        userId: req.userId || 'anonymous'
      });
    }

    next();
  };

  // Security event logger
  public securityLogger = (event: string, req: Request, details?: any): void => {
    this.logger.warn(`Security event: ${event}`, {
      requestId: req.requestId,
      event,
      method: req.method,
      url: req.url,
      ip: req.ip,
      userAgent: req.headers['user-agent'],
      userId: req.userId,
      ...details
    });

    this.metricsCollector.incrementCounter('security.events.total', 1, {
      event,
      userId: req.userId || 'anonymous'
    });
  };
}

// WebSocket logging utilities
export class WebSocketLoggingUtils {
  private logger: Logger;
  private metricsCollector: MetricsCollector;

  constructor() {
    this.logger = Logger.getInstance();
    this.metricsCollector = MetricsCollector.getInstance();
  }

  public logConnection(socketId: string, userId?: string): void {
    this.logger.info('WebSocket connection established', {
      socketId,
      userId
    });

    this.metricsCollector.recordWebSocketConnection(true);
  }

  public logDisconnection(socketId: string, userId?: string, reason?: string): void {
    this.logger.info('WebSocket connection closed', {
      socketId,
      userId,
      reason
    });

    this.metricsCollector.recordWebSocketConnection(false);
  }

  public logMessage(event: string, socketId: string, userId?: string, documentId?: string, data?: any): void {
    this.logger.logWebSocketEvent(event, userId, documentId, {
      socketId,
      dataSize: data ? JSON.stringify(data).length : 0
    });

    this.metricsCollector.incrementCounter('websocket.messages.total', 1, {
      event,
      userId: userId || 'anonymous'
    });
  }

  public logError(error: Error, socketId: string, userId?: string, context?: string): void {
    this.logger.error(`WebSocket error: ${error.message}`, {
      socketId,
      userId,
      context,
      error: error.name,
      stack: error.stack
    });

    this.metricsCollector.incrementCounter('websocket.errors.total', 1, {
      error: error.name,
      userId: userId || 'anonymous'
    });
  }

  public logPerformance(operation: string, duration: number, socketId: string, userId?: string, documentId?: string): void {
    this.logger.logPerformance(`WebSocket ${operation}`, duration, {
      socketId,
      userId,
      documentId
    });

    this.metricsCollector.recordHistogram('websocket.operation.duration', duration, {
      operation,
      userId: userId || 'anonymous'
    });
  }
}