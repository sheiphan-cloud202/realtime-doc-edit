import dotenv from 'dotenv';
dotenv.config();
import express from 'express';
import { createServer } from 'http';
import { Server as SocketIOServer } from 'socket.io';
import cors from 'cors';
import { DocumentManager } from './services/DocumentManager';
import { UserSessionManager } from './services/UserSessionManager';
import { WebSocketHandler } from './services/WebSocketHandler';
import { AIServiceAdapter } from './services/AIServiceAdapter';
import { AIProcessingQueue } from './services/AIProcessingQueue';
import { AIIntegrationService } from './services/AIIntegrationService';
import { OperationBroadcaster } from './services/OperationBroadcaster';
import { AIRequest } from '../../shared/types';
import { v4 as uuidv4 } from 'uuid';
import { Logger } from './utils/Logger';
import { MetricsCollector } from './utils/MetricsCollector';
import { LoggingMiddleware } from './middleware/LoggingMiddleware';
import { HealthController } from './controllers/HealthController';

const app = express();
const server = createServer(app);

// Initialize logging and monitoring
const logger = Logger.getInstance();
const metricsCollector = MetricsCollector.getInstance();
const loggingMiddleware = new LoggingMiddleware();
const healthController = new HealthController();

// Configure CORS
app.use(cors({
  origin: process.env.FRONTEND_URL || 'http://localhost:3000',
  credentials: true
}));

app.use(express.json());

// Add logging middleware
app.use(loggingMiddleware.requestLogger);
app.use(loggingMiddleware.performanceMonitor);
app.use(loggingMiddleware.rateLimitLogger);

// Initialize Socket.IO with CORS
const io = new SocketIOServer(server, {
  cors: {
    origin: process.env.FRONTEND_URL || 'http://localhost:3000',
    methods: ['GET', 'POST'],
    credentials: true
  }
});

// Initialize services
const documentManager = new DocumentManager();
const userSessionManager = new UserSessionManager();
const operationBroadcaster = new OperationBroadcaster(io, documentManager);

// Initialize AI services
const aiServiceAdapter = new AIServiceAdapter({
  apiKey: process.env.OPENAI_API_KEY || '',
  model: 'gpt-3.5-turbo',
  maxTokens: 1000,
  temperature: 0.7,
  requestTimeoutMs: parseInt(process.env.AI_SERVICE_TIMEOUT || '60000'),
  maxRetries: 3,
  retryDelayMs: 2000
});

const aiProcessingQueue = new AIProcessingQueue(aiServiceAdapter, {
  redisUrl: process.env.REDIS_URL || 'redis://localhost:6379',
  maxConcurrentRequests: 5,
  requestTimeoutMs: parseInt(process.env.AI_SERVICE_TIMEOUT || '60000'),
  enableRequestDeduplication: process.env.AI_ENABLE_DEDUPLICATION === 'true',
  enableResponseCaching: process.env.AI_ENABLE_CACHING === 'true',
  cacheTTLSeconds: 3600,
  rateLimitPerUserPerMinute: 15
});

const aiIntegrationService = new AIIntegrationService(
  aiProcessingQueue,
  documentManager,
  operationBroadcaster
);

const webSocketHandler = new WebSocketHandler(io, documentManager, userSessionManager, aiIntegrationService);

// Health and monitoring endpoints
app.get('/health', healthController.healthCheck.bind(healthController));
app.get('/health/detailed', healthController.detailedHealthCheck.bind(healthController));
app.get('/health/ready', healthController.readinessCheck.bind(healthController));
app.get('/health/live', healthController.livenessCheck.bind(healthController));
app.get('/metrics', healthController.getMetrics.bind(healthController));
app.get('/metrics/performance', healthController.getPerformanceMetrics.bind(healthController));

// Simple REST endpoint for AI editing without websockets/collaboration
app.post('/ai/edit', async (req, res) => {
  try {
    const { selectedText, prompt } = req.body || {};

    if (!selectedText || !prompt) {
      return res.status(400).json({ error: 'selectedText and prompt are required' });
    }

    // Build a minimal AIRequest shape for the adapter
    const aiReq: AIRequest = {
      id: uuidv4(),
      documentId: 'single-user',
      userId: 'local-user',
      selectedText,
      prompt,
      selectionStart: 0,
      selectionEnd: selectedText.length,
      status: 'pending',
      createdAt: new Date()
    } as any;

    const result = await aiServiceAdapter.processRequest(aiReq);
    if (!result.success) {
      return res.status(500).json({ error: result.error || 'AI processing failed' });
    }
    return res.json({ result: result.result });
  } catch (error) {
    return res.status(500).json({ error: (error as Error).message || 'Server error' });
  }
});

// Add error logging middleware
app.use(loggingMiddleware.errorLogger);

// Start server
const PORT = process.env.PORT || 3001;

async function startServer() {
  try {
    logger.info('Starting server initialization');

    // Initialize document manager (Redis connection)
    await documentManager.initialize();
    logger.info('DocumentManager initialized');

    // Initialize user session manager (Redis connection)
    await userSessionManager.initialize();
    logger.info('UserSessionManager initialized');

    // AI processing queue is initialized in constructor
    logger.info('AI processing queue initialized');

    // Initialize WebSocket handler
    await webSocketHandler.initialize();
    logger.info('WebSocket handler initialized');

    server.listen(PORT, () => {
      logger.info(`Server running on port ${PORT}`, { port: PORT });
      metricsCollector.recordGauge('server.status', 1);
    });

    // Graceful shutdown handling
    process.on('SIGTERM', gracefulShutdown);
    process.on('SIGINT', gracefulShutdown);

  } catch (error) {
    logger.error('Failed to start server', { error: (error as Error).message });
    process.exit(1);
  }
}

async function gracefulShutdown(signal: string) {
  logger.info(`Received ${signal}, starting graceful shutdown`);
  
  try {
    // Stop accepting new connections
    server.close(() => {
      logger.info('HTTP server closed');
    });

    // Close WebSocket connections
    io.close(() => {
      logger.info('WebSocket server closed');
    });

    // Stop metrics collection
    metricsCollector.stop();
    
    // Close logger streams
    logger.close();

    logger.info('Graceful shutdown completed');
    process.exit(0);
  } catch (error) {
    logger.error('Error during graceful shutdown', { error: (error as Error).message });
    process.exit(1);
  }
}

startServer();