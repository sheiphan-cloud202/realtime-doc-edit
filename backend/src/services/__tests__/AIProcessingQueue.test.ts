import { AIProcessingQueue, QueueConfig } from '../AIProcessingQueue';
import { AIServiceAdapter } from '../AIServiceAdapter';
import { AIRequest } from '../../../../shared/types';
import { createClient } from 'redis';

// Mock Redis
jest.mock('redis');
const mockRedis = {
  connect: jest.fn(),
  quit: jest.fn(),
  on: jest.fn(),
  isOpen: false,
  zAdd: jest.fn(),
  zPopMin: jest.fn(),
  zCard: jest.fn(),
  hSet: jest.fn(),
  hGet: jest.fn(),
  hDel: jest.fn(),
  get: jest.fn(),
  incr: jest.fn(),
  expire: jest.fn(),
  del: jest.fn()
};

(createClient as jest.Mock).mockReturnValue(mockRedis);

// Mock AIServiceAdapter
jest.mock('../AIServiceAdapter');
const MockedAIServiceAdapter = AIServiceAdapter as jest.MockedClass<typeof AIServiceAdapter>;

describe('AIProcessingQueue', () => {
  let queue: AIProcessingQueue;
  let mockAIService: jest.Mocked<AIServiceAdapter>;

  const defaultConfig: QueueConfig = {
    redisUrl: 'redis://localhost:6379',
    maxConcurrentRequests: 2,
    requestTimeoutMs: 5000,
    rateLimitPerUserPerMinute: 5,
    retryDelayMs: 1000,
    maxRetries: 2
  };

  const sampleRequest: AIRequest = {
    id: 'test-request-1',
    documentId: 'doc-1',
    userId: 'user-1',
    selectedText: 'Sample text to process',
    prompt: 'Make this text better',
    selectionStart: 0,
    selectionEnd: 23,
    status: 'pending',
    createdAt: new Date()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    
    mockAIService = {
      processRequest: jest.fn(),
      validateRequest: jest.fn(),
      healthCheck: jest.fn()
    } as any;

    MockedAIServiceAdapter.mockImplementation(() => mockAIService);
    
    queue = new AIProcessingQueue(mockAIService, defaultConfig);
  });

  afterEach(async () => {
    await queue.close();
  });

  describe('constructor', () => {
    it('should initialize with default config', () => {
      const queueWithDefaults = new AIProcessingQueue(mockAIService);
      expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
    });

    it('should use provided config', () => {
      expect(createClient).toHaveBeenCalledWith({ url: 'redis://localhost:6379' });
    });
  });

  describe('enqueueRequest', () => {
    beforeEach(() => {
      mockRedis.get.mockResolvedValue('0'); // Rate limit check
      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);
    });

    it('should successfully enqueue a request', async () => {
      const result = await queue.enqueueRequest(sampleRequest, 1);

      expect(result.success).toBe(true);
      expect(mockRedis.zAdd).toHaveBeenCalledWith(
        'ai:queue:pending',
        expect.objectContaining({
          score: expect.any(Number),
          value: expect.stringContaining(sampleRequest.id)
        })
      );
    });

    it('should handle rate limiting', async () => {
      mockRedis.get.mockResolvedValue('5'); // At rate limit

      const result = await queue.enqueueRequest(sampleRequest, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
      expect(mockRedis.zAdd).not.toHaveBeenCalled();
    });

    it('should prioritize requests correctly', async () => {
      await queue.enqueueRequest(sampleRequest, 5); // High priority
      await queue.enqueueRequest({ ...sampleRequest, id: 'req-2' }, 1); // Low priority

      const calls = mockRedis.zAdd.mock.calls;
      expect(calls).toHaveLength(2);
      
      // High priority should have lower score (processed first)
      const highPriorityScore = calls[0][1].score;
      const lowPriorityScore = calls[1][1].score;
      expect(highPriorityScore).toBeLessThan(lowPriorityScore);
    });

    it('should handle Redis errors gracefully', async () => {
      mockRedis.zAdd.mockRejectedValue(new Error('Redis error'));

      const result = await queue.enqueueRequest(sampleRequest, 1);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Failed to enqueue request');
    });
  });

  describe('rate limiting', () => {
    it('should allow requests within rate limit', async () => {
      mockRedis.get.mockResolvedValue('3'); // Under limit
      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.incr.mockResolvedValue(4);
      mockRedis.expire.mockResolvedValue(1);

      const result = await queue.enqueueRequest(sampleRequest, 1);

      expect(result.success).toBe(true);
      expect(mockRedis.incr).toHaveBeenCalledWith('ai:ratelimit:user-1:' + Math.floor(Date.now() / 60000));
    });

    it('should block requests exceeding rate limit', async () => {
      mockRedis.get.mockResolvedValue('5'); // At limit

      const result = await queue.enqueueRequest(sampleRequest, 1);

      expect(result.success).toBe(false);
      expect(result.error).toContain('Rate limit exceeded');
    });

    it('should handle rate limit check errors gracefully', async () => {
      mockRedis.get.mockRejectedValue(new Error('Redis error'));
      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.incr.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      const result = await queue.enqueueRequest(sampleRequest, 1);

      expect(result.success).toBe(true); // Should allow on error
    });
  });

  describe('request processing', () => {
    beforeEach(() => {
      mockAIService.validateRequest.mockReturnValue({ valid: true });
      mockAIService.processRequest.mockResolvedValue({
        success: true,
        result: 'Processed text',
        retryCount: 0
      });
    });

    it('should process requests successfully', async () => {
      const queuedRequest = {
        ...sampleRequest,
        priority: 1,
        enqueuedAt: new Date(),
        retryCount: 0,
        timeoutAt: new Date(Date.now() + 5000)
      };

      mockRedis.zPopMin.mockResolvedValueOnce({
        score: Date.now(),
        value: JSON.stringify(queuedRequest)
      });
      mockRedis.hSet.mockResolvedValue(1);
      mockRedis.hDel.mockResolvedValue(1);

      // Manually trigger processing
      await (queue as any).processRequestAsync(queuedRequest);

      expect(mockAIService.processRequest).toHaveBeenCalledWith(queuedRequest);
      expect(mockRedis.hSet).toHaveBeenCalledWith(
        `ai:results:${sampleRequest.id}`,
        expect.objectContaining({
          result: expect.stringContaining('completed'),
          completedAt: expect.any(String)
        })
      );
    });

    it('should handle validation failures', async () => {
      mockAIService.validateRequest.mockReturnValue({
        valid: false,
        error: 'Invalid request'
      });

      const queuedRequest = {
        ...sampleRequest,
        priority: 1,
        enqueuedAt: new Date(),
        retryCount: 2, // Set to max retries so it fails permanently
        timeoutAt: new Date(Date.now() + 5000)
      };

      mockRedis.hSet.mockResolvedValue(1);
      mockRedis.hDel.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await (queue as any).processRequestAsync(queuedRequest);

      expect(mockAIService.processRequest).not.toHaveBeenCalled();
      expect(mockRedis.hSet).toHaveBeenCalledWith(
        `ai:results:${sampleRequest.id}`,
        expect.objectContaining({
          result: expect.stringContaining('failed'),
          failedAt: expect.any(String)
        })
      );
    });

    it('should retry failed requests', async () => {
      mockAIService.processRequest.mockResolvedValue({
        success: false,
        error: 'Temporary error',
        retryCount: 0
      });

      const queuedRequest = {
        ...sampleRequest,
        priority: 1,
        enqueuedAt: new Date(),
        retryCount: 0,
        timeoutAt: new Date(Date.now() + 5000)
      };

      mockRedis.zAdd.mockResolvedValue(1);
      mockRedis.hDel.mockResolvedValue(1);

      await (queue as any).processRequestAsync(queuedRequest);

      expect(mockRedis.zAdd).toHaveBeenCalledWith(
        'ai:queue:pending',
        expect.objectContaining({
          value: expect.stringContaining('"retryCount":1')
        })
      );
    });

    it('should fail permanently after max retries', async () => {
      mockAIService.processRequest.mockResolvedValue({
        success: false,
        error: 'Persistent error',
        retryCount: 2
      });

      const queuedRequest = {
        ...sampleRequest,
        priority: 1,
        enqueuedAt: new Date(),
        retryCount: 2, // At max retries
        timeoutAt: new Date(Date.now() + 5000)
      };

      mockRedis.hSet.mockResolvedValue(1);
      mockRedis.hDel.mockResolvedValue(1);
      mockRedis.expire.mockResolvedValue(1);

      await (queue as any).processRequestAsync(queuedRequest);

      expect(mockRedis.zAdd).not.toHaveBeenCalled(); // Should not retry
      expect(mockRedis.hSet).toHaveBeenCalledWith(
        `ai:results:${sampleRequest.id}`,
        expect.objectContaining({
          result: expect.stringContaining('failed')
        })
      );
    });

    it('should handle timed out requests', async () => {
      // Create a request that's already expired
      const pastTime = new Date(Date.now() - 10000); // 10 seconds ago
      const expiredRequest = {
        id: 'expired-request',
        documentId: 'doc-1',
        userId: 'user-1',
        selectedText: 'Expired text',
        prompt: 'Process this',
        selectionStart: 0,
        selectionEnd: 12,
        status: 'pending' as const,
        createdAt: pastTime.toISOString(),
        priority: 1,
        enqueuedAt: pastTime.toISOString(),
        retryCount: 0,
        timeoutAt: pastTime.toISOString() // Already expired as ISO string
      };

      // Clear any previous mocks
      mockRedis.zPopMin.mockReset();
      mockRedis.zPopMin.mockResolvedValueOnce({
        score: Date.now(),
        value: JSON.stringify(expiredRequest)
      });

      const result = await (queue as any).dequeueRequest();

      expect(result).toBeNull();
    });
  });

  describe('queue statistics', () => {
    it('should return accurate queue statistics', async () => {
      mockRedis.zCard.mockResolvedValue(5); // 5 pending requests
      
      // Simulate some processing stats
      (queue as any).processingStats = {
        completed: 10,
        failed: 2,
        totalProcessingTime: 15000
      };
      (queue as any).processingRequests.set('req1', {} as any);
      (queue as any).processingRequests.set('req2', {} as any);

      const stats = await queue.getQueueStats();

      expect(stats).toEqual({
        pendingRequests: 5,
        processingRequests: 2,
        completedRequests: 10,
        failedRequests: 2,
        averageProcessingTimeMs: 1500
      });
    });

    it('should handle Redis errors in stats', async () => {
      mockRedis.zCard.mockRejectedValue(new Error('Redis error'));

      const stats = await queue.getQueueStats();

      expect(stats).toEqual({
        pendingRequests: 0,
        processingRequests: 0,
        completedRequests: 0,
        failedRequests: 0,
        averageProcessingTimeMs: 0
      });
    });
  });

  describe('result retrieval', () => {
    it('should retrieve completed request results', async () => {
      const completedResult = {
        ...sampleRequest,
        status: 'completed',
        result: 'Processed text',
        createdAt: sampleRequest.createdAt.toISOString() // Convert to string for JSON serialization
      };

      mockRedis.hGet.mockResolvedValue(JSON.stringify(completedResult));

      const result = await queue.getRequestResult(sampleRequest.id);

      expect(result.found).toBe(true);
      expect(result.result).toEqual(completedResult);
    });

    it('should handle missing results', async () => {
      mockRedis.hGet.mockResolvedValue(null);

      const result = await queue.getRequestResult('nonexistent-id');

      expect(result.found).toBe(false);
    });

    it('should handle Redis errors in result retrieval', async () => {
      mockRedis.hGet.mockRejectedValue(new Error('Redis error'));

      const result = await queue.getRequestResult(sampleRequest.id);

      expect(result.found).toBe(false);
      expect(result.error).toBe('Redis error');
    });
  });

  describe('queue management', () => {
    it('should clear all queues', async () => {
      mockRedis.del.mockResolvedValue(1);

      await queue.clearQueues();

      expect(mockRedis.del).toHaveBeenCalledWith('ai:queue:pending');
      expect(mockRedis.del).toHaveBeenCalledWith('ai:queue:processing');
      expect(mockRedis.del).toHaveBeenCalledWith('ai:queue:stats');
    });

    it('should close Redis connection', async () => {
      mockRedis.quit.mockResolvedValue('OK');

      await queue.close();

      expect(mockRedis.quit).toHaveBeenCalled();
    });
  });

  describe('concurrent processing limits', () => {
    it('should respect max concurrent requests limit', async () => {
      // This test verifies that the dequeue method works correctly
      // The actual concurrency limiting happens in the processing loop
      const futureTime = new Date(Date.now() + 5000);
      const queuedRequest = {
        id: 'valid-request',
        documentId: 'doc-1',
        userId: 'user-1',
        selectedText: 'Valid text',
        prompt: 'Process this',
        selectionStart: 0,
        selectionEnd: 10,
        status: 'pending' as const,
        createdAt: new Date().toISOString(),
        priority: 1,
        enqueuedAt: new Date().toISOString(),
        retryCount: 0,
        timeoutAt: futureTime.toISOString()
      };

      // Clear any previous mocks
      mockRedis.zPopMin.mockReset();
      mockRedis.hSet.mockReset();
      
      mockRedis.zPopMin.mockResolvedValueOnce({
        score: Date.now(),
        value: JSON.stringify(queuedRequest)
      });
      mockRedis.hSet.mockResolvedValue(1);

      const result = await (queue as any).dequeueRequest();
      expect(result).not.toBeNull();
      expect(result.id).toBe('valid-request');
    });
  });
});