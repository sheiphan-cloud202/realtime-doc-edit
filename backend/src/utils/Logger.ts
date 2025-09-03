import { createWriteStream, WriteStream } from 'fs';
import { join } from 'path';

export enum LogLevel {
  ERROR = 0,
  WARN = 1,
  INFO = 2,
  DEBUG = 3
}

export interface LogEntry {
  timestamp: string;
  level: string;
  message: string;
  metadata?: any;
  userId?: string;
  documentId?: string;
  requestId?: string;
  duration?: number;
}

export class Logger {
  private static instance: Logger;
  private logLevel: LogLevel;
  private logStreams: Map<string, WriteStream> = new Map();
  private metricsBuffer: LogEntry[] = [];
  private readonly maxBufferSize = 1000;

  private constructor() {
    this.logLevel = this.parseLogLevel(process.env.LOG_LEVEL || 'info');
    this.initializeLogStreams();
  }

  public static getInstance(): Logger {
    if (!Logger.instance) {
      Logger.instance = new Logger();
    }
    return Logger.instance;
  }

  private parseLogLevel(level: string): LogLevel {
    switch (level.toLowerCase()) {
      case 'error': return LogLevel.ERROR;
      case 'warn': return LogLevel.WARN;
      case 'info': return LogLevel.INFO;
      case 'debug': return LogLevel.DEBUG;
      default: return LogLevel.INFO;
    }
  }

  private initializeLogStreams(): void {
    if (process.env.NODE_ENV !== 'test') {
      const logsDir = join(process.cwd(), 'logs');
      
      // Create log streams for different log types
      this.logStreams.set('app', createWriteStream(join(logsDir, 'app.log'), { flags: 'a' }));
      this.logStreams.set('error', createWriteStream(join(logsDir, 'error.log'), { flags: 'a' }));
      this.logStreams.set('performance', createWriteStream(join(logsDir, 'performance.log'), { flags: 'a' }));
      this.logStreams.set('audit', createWriteStream(join(logsDir, 'audit.log'), { flags: 'a' }));
    }
  }

  private shouldLog(level: LogLevel): boolean {
    return level <= this.logLevel;
  }

  private formatLogEntry(entry: LogEntry): string {
    return JSON.stringify(entry) + '\n';
  }

  private writeToStream(streamName: string, entry: LogEntry): void {
    const stream = this.logStreams.get(streamName);
    if (stream) {
      stream.write(this.formatLogEntry(entry));
    }
  }

  private createLogEntry(level: string, message: string, metadata?: any): LogEntry {
    return {
      timestamp: new Date().toISOString(),
      level,
      message,
      metadata,
      ...metadata // Spread metadata to include userId, documentId, etc.
    };
  }

  public error(message: string, metadata?: any): void {
    if (!this.shouldLog(LogLevel.ERROR)) return;

    const entry = this.createLogEntry('ERROR', message, metadata);
    
    console.error(`[ERROR] ${entry.timestamp} - ${message}`, metadata || '');
    this.writeToStream('app', entry);
    this.writeToStream('error', entry);
  }

  public warn(message: string, metadata?: any): void {
    if (!this.shouldLog(LogLevel.WARN)) return;

    const entry = this.createLogEntry('WARN', message, metadata);
    
    console.warn(`[WARN] ${entry.timestamp} - ${message}`, metadata || '');
    this.writeToStream('app', entry);
  }

  public info(message: string, metadata?: any): void {
    if (!this.shouldLog(LogLevel.INFO)) return;

    const entry = this.createLogEntry('INFO', message, metadata);
    
    console.log(`[INFO] ${entry.timestamp} - ${message}`, metadata || '');
    this.writeToStream('app', entry);
  }

  public debug(message: string, metadata?: any): void {
    if (!this.shouldLog(LogLevel.DEBUG)) return;

    const entry = this.createLogEntry('DEBUG', message, metadata);
    
    console.log(`[DEBUG] ${entry.timestamp} - ${message}`, metadata || '');
    this.writeToStream('app', entry);
  }

  // Specialized logging methods
  public logUserAction(userId: string, action: string, documentId?: string, metadata?: any): void {
    this.info(`User action: ${action}`, {
      userId,
      documentId,
      action,
      ...metadata
    });
    
    // Also write to audit log
    const auditEntry = this.createLogEntry('AUDIT', `User ${userId} performed ${action}`, {
      userId,
      documentId,
      action,
      ...metadata
    });
    this.writeToStream('audit', auditEntry);
  }

  public logPerformance(operation: string, duration: number, metadata?: any): void {
    const entry = this.createLogEntry('PERFORMANCE', `${operation} completed`, {
      operation,
      duration,
      ...metadata
    });

    this.info(`Performance: ${operation} took ${duration}ms`, { operation, duration, ...metadata });
    this.writeToStream('performance', entry);

    // Buffer metrics for aggregation
    this.metricsBuffer.push(entry);
    if (this.metricsBuffer.length > this.maxBufferSize) {
      this.metricsBuffer.shift(); // Remove oldest entry
    }
  }

  public logAIRequest(requestId: string, userId: string, documentId: string, prompt: string, status: string, duration?: number): void {
    this.info(`AI request ${status}`, {
      requestId,
      userId,
      documentId,
      prompt: prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''),
      status,
      duration
    });

    // Audit AI usage
    const auditEntry = this.createLogEntry('AI_AUDIT', `AI request ${status}`, {
      requestId,
      userId,
      documentId,
      status,
      duration,
      promptLength: prompt.length
    });
    this.writeToStream('audit', auditEntry);
  }

  public logWebSocketEvent(event: string, userId?: string, documentId?: string, metadata?: any): void {
    this.debug(`WebSocket event: ${event}`, {
      event,
      userId,
      documentId,
      ...metadata
    });
  }

  public logError(error: Error, context?: string, metadata?: any): void {
    this.error(`${context ? context + ': ' : ''}${error.message}`, {
      error: error.name,
      stack: error.stack,
      context,
      ...metadata
    });
  }

  // Metrics aggregation
  public getPerformanceMetrics(timeWindow: number = 300000): any { // 5 minutes default
    const cutoff = Date.now() - timeWindow;
    const recentMetrics = this.metricsBuffer.filter(entry => 
      new Date(entry.timestamp).getTime() > cutoff
    );

    const operationStats: { [key: string]: { count: number; totalDuration: number; avgDuration: number } } = {};

    recentMetrics.forEach(entry => {
      if (entry.metadata?.operation && entry.duration) {
        const op = entry.metadata.operation;
        if (!operationStats[op]) {
          operationStats[op] = { count: 0, totalDuration: 0, avgDuration: 0 };
        }
        operationStats[op].count++;
        operationStats[op].totalDuration += entry.duration;
        operationStats[op].avgDuration = operationStats[op].totalDuration / operationStats[op].count;
      }
    });

    return {
      timeWindow,
      totalOperations: recentMetrics.length,
      operationStats
    };
  }

  public close(): void {
    this.logStreams.forEach(stream => stream.end());
    this.logStreams.clear();
  }
}