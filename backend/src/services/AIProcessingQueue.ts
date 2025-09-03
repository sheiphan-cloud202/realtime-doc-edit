import { createClient, RedisClientType } from 'redis';
import { AIRequest } from '../../../shared/types';
import { AIServiceAdapter, AIProcessingResult } from './AIServiceAdapter';

export interface QueueConfig {
  redisUrl?: string;
  maxConcurrentRequests?: number;
  requestTimeoutMs?: number;
  rateLimitPerUserPerMinute?: number;
  retryDelayMs?: number;
  maxRetries?: number;
  enableRequestDeduplication?: boolean;
  enableResponseCaching?: boolean;
  cacheTTLSeconds?: number;
  enableResponseStreaming?: boolean;
}

export interface QueuedRequest extends AIRequest {
  priority: number;
  enqueuedAt: Date;
  retryCount: number;
  timeoutAt: Date;
}

export interface QueueStats {
  pendingRequests: number;
  processingRequests: number;
  completedRequests: number;
  failedRequests: number;
  averageProcessingTimeMs: number;
}

/**
 * AIProcessingQueue manages AI requests with Redis-backed queuing,
 * rate limiting, prioritization, and timeout handling
 */
export class AIProcessingQueue {
  private redis: RedisClientType;
  private aiService: AIServiceAdapter;
  private config: Required<QueueConfig>;
  private processingRequests = new Map<string, QueuedRequest>();
  private isProcessing = false;
  private processingStats = {
    completed: 0,
    failed: 0,
    totalProcessingTime: 0
  };

  // Redis keys
  private readonly QUEUE_KEY = 'ai:queue:pending';
  private readonly PROCESSING_KEY = 'ai:queue:processing';
  private readonly RATE_LIMIT_KEY_PREFIX = 'ai:ratelimit:';
  private readonly STATS_KEY = 'ai:queue:stats';
  private readonly CACHE_KEY_PREFIX = 'ai:cache:';
  private readonly DEDUP_KEY_PREFIX = 'ai:dedup:';

  constructor(aiService: AIServiceAdapter, config: QueueConfig = {}) {
    this.aiService = aiService;
    this.config = {
      redisUrl: 'redis://localhost:6379',
      maxConcurrentRequests: 5,
      requestTimeoutMs: 60000, // Increased to 60 seconds
      rateLimitPerUserPerMinute: 10,
      retryDelayMs: 5000,
      maxRetries: 3,
      enableRequestDeduplication: true,
      enableResponseCaching: true,
      cacheTTLSeconds: 3600, // 1 hour cache
      enableResponseStreaming: false, // Will implement in future
      ...config
    };

    this.redis = createClient({ url: this.config.redisUrl });
    this.setupRedisConnection();
  }

  /**
   * Initialize Redis connection and error handling
   */
  private async setupRedisConnection(): Promise<void> {
    this.redis.on('error', (err) => {
      console.error('Redis connection error:', err);
    });

    this.redis.on('connect', () => {
      console.log('Connected to Redis for AI queue');
    });

    if (!this.redis.isOpen) {
      await this.redis.connect();
    }
  }

  /**
   * Enqueue an AI request with priority and rate limiting
   */
  async enqueueRequest(request: AIRequest, priority: number = 1): Promise<{ success: boolean; error?: string; cached?: boolean; requestId?: string }> {
    try {
      // Check rate limiting
      const rateLimitCheck = await this.checkRateLimit(request.userId);
      if (!rateLimitCheck.allowed) {
        return {
          success: false,
          error: `Rate limit exceeded. Try again in ${rateLimitCheck.resetInSeconds} seconds.`
        };
      }

      // Check for cached response if caching is enabled
      if (this.config.enableResponseCaching) {
        const cachedResult = await this.getCachedResponse(request);
        if (cachedResult) {
          console.log(`Returning cached result for request ${request.id}`);

          // Ensure a standardized result record exists so downstream monitors can detect completion
          try {
            const completedRecord = {
              id: request.id,
              documentId: request.documentId,
              userId: request.userId,
              status: 'completed' as const,
              result: cachedResult,
            };
            await this.redis.hSet(`ai:results:${request.id}`, {
              result: JSON.stringify(completedRecord),
              completedAt: new Date().toISOString()
            });
            // Align expiry with normal success path (24h)
            await this.redis.expire(`ai:results:${request.id}`, 86400);
          } catch (e) {
            console.error('Error materializing cached AI result:', e);
          }

          return {
            success: true,
            cached: true,
            requestId: request.id
          };
        }
      }

      // Check for duplicate requests if deduplication is enabled
      if (this.config.enableRequestDeduplication) {
        const duplicateCheck = await this.checkForDuplicate(request);
        if (duplicateCheck.isDuplicate) {
          console.log(`Duplicate request detected for ${request.id}, waiting for existing request ${duplicateCheck.existingRequestId}`);
          return {
            success: true,
            requestId: duplicateCheck.existingRequestId
          };
        }
      }

      // Create queued request
      const queuedRequest: QueuedRequest = {
        ...request,
        priority,
        enqueuedAt: new Date(),
        retryCount: 0,
        timeoutAt: new Date(Date.now() + this.config.requestTimeoutMs)
      };

      // Register request for deduplication if enabled
      if (this.config.enableRequestDeduplication) {
        await this.registerRequestForDeduplication(request);
      }

      // Add to Redis queue with priority (higher priority = lower score for sorted set)
      const score = Date.now() - (priority * 1000000); // Priority affects ordering
      await this.redis.zAdd(this.QUEUE_KEY, {
        score,
        value: JSON.stringify(queuedRequest)
      });

      // Update rate limiting counter
      await this.updateRateLimit(request.userId);

      // Start processing if not already running
      if (!this.isProcessing) {
        this.startProcessing();
      }

      return { success: true, requestId: request.id };
    } catch (error) {
      console.error('Error enqueueing AI request:', error);
      return {
        success: false,
        error: 'Failed to enqueue request'
      };
    }
  }

  /**
   * Start processing requests from the queue
   */
  private async startProcessing(): Promise<void> {
    if (this.isProcessing) return;
    
    this.isProcessing = true;
    console.log('Starting AI queue processing');

    while (this.isProcessing) {
      try {
        // Check if we can process more requests
        if (this.processingRequests.size >= this.config.maxConcurrentRequests) {
          await this.sleep(1000);
          continue;
        }

        // Get next request from queue
        const nextRequest = await this.dequeueRequest();
        if (!nextRequest) {
          await this.sleep(2000);
          continue;
        }

        // Process request asynchronously
        this.processRequestAsync(nextRequest);
      } catch (error) {
        console.error('Error in queue processing loop:', error);
        await this.sleep(5000);
      }
    }
  }

  /**
   * Stop processing requests
   */
  async stopProcessing(): Promise<void> {
    this.isProcessing = false;
    
    // Wait for current requests to complete
    while (this.processingRequests.size > 0) {
      await this.sleep(1000);
    }
    
    console.log('AI queue processing stopped');
  }

  /**
   * Dequeue the next highest priority request
   */
  private async dequeueRequest(): Promise<QueuedRequest | null> {
    try {
      // Get the highest priority request (lowest score)
      const result = await this.redis.zPopMin(this.QUEUE_KEY);
      if (!result) return null;

      const queuedRequest: QueuedRequest = JSON.parse(result.value);
      
      // Check if request has timed out
      const timeoutAt = new Date(queuedRequest.timeoutAt);
      if (new Date() > timeoutAt) {
        console.log(`Request ${queuedRequest.id} timed out, discarding`);
        return null;
      }

      // Move to processing set
      await this.redis.hSet(this.PROCESSING_KEY, queuedRequest.id, JSON.stringify(queuedRequest));
      this.processingRequests.set(queuedRequest.id, queuedRequest);

      return queuedRequest;
    } catch (error) {
      console.error('Error dequeuing request:', error);
      return null;
    }
  }

  /**
   * Process a single request asynchronously
   */
  private async processRequestAsync(request: QueuedRequest): Promise<void> {
    const startTime = Date.now();
    
    try {
      console.log(`Processing AI request ${request.id} for user ${request.userId}`);
      
      // Validate request
      const validation = this.aiService.validateRequest(request);
      if (!validation.valid) {
        await this.handleRequestFailure(request, validation.error || 'Invalid request');
        return;
      }

      // Process with AI service
      const result = await this.aiService.processRequest(request);
      
      if (result.success && result.result) {
        await this.handleRequestSuccess(request, result.result, Date.now() - startTime);
      } else {
        await this.handleRequestFailure(request, result.error || 'Unknown error');
      }
    } catch (error) {
      console.error(`Error processing AI request ${request.id}:`, error);
      await this.handleRequestFailure(request, (error as Error).message);
    }
  }

  /**
   * Handle successful request processing
   */
  private async handleRequestSuccess(request: QueuedRequest, result: string, processingTime: number): Promise<void> {
    try {
      // Update request status
      const completedRequest = {
        ...request,
        status: 'completed' as const,
        result
      };

      // Store result (could be used for caching or history)
      await this.redis.hSet(`ai:results:${request.id}`, {
        result: JSON.stringify(completedRequest),
        completedAt: new Date().toISOString()
      });

      // Set expiration for result (24 hours)
      await this.redis.expire(`ai:results:${request.id}`, 86400);

      // Cache the response if caching is enabled
      if (this.config.enableResponseCaching) {
        await this.cacheResponse(request, result);
      }

      // Clean up deduplication tracking
      if (this.config.enableRequestDeduplication) {
        await this.cleanupDeduplication(request);
      }

      // Remove from processing
      await this.cleanupProcessedRequest(request.id);

      // Update stats
      this.processingStats.completed++;
      this.processingStats.totalProcessingTime += processingTime;

      console.log(`AI request ${request.id} completed successfully in ${processingTime}ms`);
    } catch (error) {
      console.error('Error handling request success:', error);
    }
  }

  /**
   * Handle failed request processing
   */
  private async handleRequestFailure(request: QueuedRequest, error: string): Promise<void> {
    try {
      // Check if we should retry
      if (request.retryCount < this.config.maxRetries) {
        console.log(`Retrying AI request ${request.id} (attempt ${request.retryCount + 1})`);
        
        // Increment retry count and re-enqueue with delay
        const retryRequest = {
          ...request,
          retryCount: request.retryCount + 1,
          enqueuedAt: new Date(Date.now() + this.config.retryDelayMs),
          timeoutAt: new Date(Date.now() + this.config.retryDelayMs + this.config.requestTimeoutMs)
        };

        // Re-add to queue with lower priority (higher score)
        const score = Date.now() + this.config.retryDelayMs + (request.retryCount * 10000);
        await this.redis.zAdd(this.QUEUE_KEY, {
          score,
          value: JSON.stringify(retryRequest)
        });
      } else {
        // Max retries exceeded, mark as failed
        const failedRequest = {
          ...request,
          status: 'failed' as const,
          error
        };

        await this.redis.hSet(`ai:results:${request.id}`, {
          result: JSON.stringify(failedRequest),
          failedAt: new Date().toISOString()
        });

        // Set expiration for failed result (1 hour)
        await this.redis.expire(`ai:results:${request.id}`, 3600);

        // Clean up deduplication tracking for failed requests
        if (this.config.enableRequestDeduplication) {
          await this.cleanupDeduplication(request);
        }

        this.processingStats.failed++;
        console.log(`Request ${request.id} timed out, discarding`);
      }

      // Remove from processing
      await this.cleanupProcessedRequest(request.id);
    } catch (cleanupError) {
      console.error('Error handling request failure:', cleanupError);
    }
  }

  /**
   * Clean up processed request from tracking
   */
  private async cleanupProcessedRequest(requestId: string): Promise<void> {
    this.processingRequests.delete(requestId);
    await this.redis.hDel(this.PROCESSING_KEY, requestId);
  }

  /**
   * Check rate limiting for a user
   */
  private async checkRateLimit(userId: string): Promise<{ allowed: boolean; resetInSeconds?: number }> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}${userId}`;
    const currentMinute = Math.floor(Date.now() / 60000);
    const windowKey = `${key}:${currentMinute}`;

    try {
      const currentCount = await this.redis.get(windowKey);
      const count = currentCount ? parseInt(currentCount) : 0;

      if (count >= this.config.rateLimitPerUserPerMinute) {
        const resetInSeconds = 60 - (Math.floor(Date.now() / 1000) % 60);
        return { allowed: false, resetInSeconds };
      }

      return { allowed: true };
    } catch (error) {
      console.error('Error checking rate limit:', error);
      return { allowed: true }; // Allow on error to avoid blocking
    }
  }

  /**
   * Update rate limiting counter for a user
   */
  private async updateRateLimit(userId: string): Promise<void> {
    const key = `${this.RATE_LIMIT_KEY_PREFIX}${userId}`;
    const currentMinute = Math.floor(Date.now() / 60000);
    const windowKey = `${key}:${currentMinute}`;

    try {
      await this.redis.incr(windowKey);
      await this.redis.expire(windowKey, 60);
    } catch (error) {
      console.error('Error updating rate limit:', error);
    }
  }

  /**
   * Get queue statistics
   */
  async getQueueStats(): Promise<QueueStats> {
    try {
      const pendingCount = await this.redis.zCard(this.QUEUE_KEY);
      const processingCount = this.processingRequests.size;
      
      const averageProcessingTime = this.processingStats.completed > 0
        ? this.processingStats.totalProcessingTime / this.processingStats.completed
        : 0;

      return {
        pendingRequests: pendingCount,
        processingRequests: processingCount,
        completedRequests: this.processingStats.completed,
        failedRequests: this.processingStats.failed,
        averageProcessingTimeMs: Math.round(averageProcessingTime)
      };
    } catch (error) {
      console.error('Error getting queue stats:', error);
      return {
        pendingRequests: 0,
        processingRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        averageProcessingTimeMs: 0
      };
    }
  }

  /**
   * Get result for a completed request
   */
  async getRequestResult(requestId: string): Promise<{ found: boolean; result?: any; error?: string }> {
    try {
      const result = await this.redis.hGet(`ai:results:${requestId}`, 'result');
      if (!result) {
        return { found: false };
      }

      return {
        found: true,
        result: JSON.parse(result)
      };
    } catch (error) {
      return {
        found: false,
        error: (error as Error).message
      };
    }
  }

  /**
   * Clear all queues (for testing/maintenance)
   */
  async clearQueues(): Promise<void> {
    await Promise.all([
      this.redis.del(this.QUEUE_KEY),
      this.redis.del(this.PROCESSING_KEY),
      this.redis.del(this.STATS_KEY)
    ]);
    
    this.processingRequests.clear();
    this.processingStats = {
      completed: 0,
      failed: 0,
      totalProcessingTime: 0
    };
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    this.isProcessing = false;
    await this.redis.quit();
  }

  /**
   * Generate cache key for request
   */
  private generateCacheKey(request: AIRequest): string {
    // Create a hash of the selected text and prompt for caching
    const content = `${request.selectedText}|${request.prompt}`;
    return `${this.CACHE_KEY_PREFIX}${Buffer.from(content).toString('base64')}`;
  }

  /**
   * Generate deduplication key for request
   */
  private generateDeduplicationKey(request: AIRequest): string {
    // Create a hash of the selected text, prompt, and user for deduplication
    const content = `${request.selectedText}|${request.prompt}|${request.userId}`;
    return `${this.DEDUP_KEY_PREFIX}${Buffer.from(content).toString('base64')}`;
  }

  /**
   * Check for cached response
   */
  private async getCachedResponse(request: AIRequest): Promise<string | null> {
    try {
      const cacheKey = this.generateCacheKey(request);
      const cachedResult = await this.redis.get(cacheKey);
      return cachedResult;
    } catch (error) {
      console.error('Error checking cache:', error);
      return null;
    }
  }

  /**
   * Cache response for future use
   */
  private async cacheResponse(request: AIRequest, result: string): Promise<void> {
    try {
      const cacheKey = this.generateCacheKey(request);
      await this.redis.setEx(cacheKey, this.config.cacheTTLSeconds, result);
    } catch (error) {
      console.error('Error caching response:', error);
    }
  }

  /**
   * Check for duplicate requests
   */
  private async checkForDuplicate(request: AIRequest): Promise<{ isDuplicate: boolean; existingRequestId?: string }> {
    try {
      const dedupKey = this.generateDeduplicationKey(request);
      const existingRequestId = await this.redis.get(dedupKey);
      
      if (existingRequestId) {
        // Check if the existing request is still being processed
        const isProcessing = await this.redis.hExists(this.PROCESSING_KEY, existingRequestId);
        const isInQueue = await this.redis.zScore(this.QUEUE_KEY, existingRequestId);
        
        if (isProcessing || isInQueue !== null) {
          return { isDuplicate: true, existingRequestId };
        } else {
          // Clean up stale deduplication entry
          await this.redis.del(dedupKey);
        }
      }
      
      return { isDuplicate: false };
    } catch (error) {
      console.error('Error checking for duplicates:', error);
      return { isDuplicate: false };
    }
  }

  /**
   * Register request for deduplication tracking
   */
  private async registerRequestForDeduplication(request: AIRequest): Promise<void> {
    try {
      const dedupKey = this.generateDeduplicationKey(request);
      // Set with expiration equal to request timeout
      await this.redis.setEx(dedupKey, Math.ceil(this.config.requestTimeoutMs / 1000), request.id);
    } catch (error) {
      console.error('Error registering request for deduplication:', error);
    }
  }

  /**
   * Clean up deduplication tracking
   */
  private async cleanupDeduplication(request: AIRequest): Promise<void> {
    try {
      const dedupKey = this.generateDeduplicationKey(request);
      await this.redis.del(dedupKey);
    } catch (error) {
      console.error('Error cleaning up deduplication:', error);
    }
  }

  /**
   * Sleep utility
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}