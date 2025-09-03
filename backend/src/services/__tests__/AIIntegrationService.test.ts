import { AIIntegrationService, AIIntegrationConfig } from '../AIIntegrationService';
import { AIProcessingQueue } from '../AIProcessingQueue';
import { DocumentManager } from '../DocumentManager';
import { OperationBroadcaster } from '../OperationBroadcaster';
import { AIRequest, Document, Operation } from '../../../../shared/types';

// Mock dependencies
jest.mock('../AIProcessingQueue');
jest.mock('../DocumentManager');
jest.mock('../OperationBroadcaster');

const MockedAIProcessingQueue = AIProcessingQueue as jest.MockedClass<typeof AIProcessingQueue>;
const MockedDocumentManager = DocumentManager as jest.MockedClass<typeof DocumentManager>;
const MockedOperationBroadcaster = OperationBroadcaster as jest.MockedClass<typeof OperationBroadcaster>;

describe('AIIntegrationService', () => {
  let service: AIIntegrationService;
  let mockAIQueue: jest.Mocked<AIProcessingQueue>;
  let mockDocumentManager: jest.Mocked<DocumentManager>;
  let mockOperationBroadcaster: jest.Mocked<OperationBroadcaster>;

  const defaultConfig: AIIntegrationConfig = {
    enableStatusTracking: true,
    enableUserNotifications: true,
    maxProcessingTimeMs: 5000 // Short timeout for tests
  };

  const sampleDocument: Document = {
    id: 'doc-1',
    content: 'Hello world! This is a test document.',
    version: 1,
    operations: [],
    collaborators: [],
    createdAt: new Date(),
    updatedAt: new Date()
  };

  const sampleAIRequest: AIRequest = {
    id: 'ai-request-1',
    documentId: 'doc-1',
    userId: 'user-1',
    selectedText: 'Hello world!',
    prompt: 'Make this more formal',
    selectionStart: 0,
    selectionEnd: 12,
    status: 'pending',
    createdAt: new Date()
  };

  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();

    mockAIQueue = {
      enqueueRequest: jest.fn(),
      getRequestResult: jest.fn(),
      getQueueStats: jest.fn(),
      clearQueues: jest.fn(),
      close: jest.fn()
    } as any;

    mockDocumentManager = {
      getDocument: jest.fn(),
      applyOperation: jest.fn(),
      createDocument: jest.fn(),
      updateDocument: jest.fn()
    } as any;

    mockOperationBroadcaster = {
      broadcastOperation: jest.fn(),
      broadcastToDocument: jest.fn(),
      broadcastPresence: jest.fn(),
      broadcastUserJoined: jest.fn(),
      broadcastUserLeft: jest.fn(),
      validateOperation: jest.fn(),
      handleConcurrentOperation: jest.fn()
    } as any;

    MockedAIProcessingQueue.mockImplementation(() => mockAIQueue);
    MockedDocumentManager.mockImplementation(() => mockDocumentManager);
    MockedOperationBroadcaster.mockImplementation(() => mockOperationBroadcaster);

    service = new AIIntegrationService(
      mockAIQueue,
      mockDocumentManager,
      mockOperationBroadcaster,
      defaultConfig
    );
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  describe('processAIRequest', () => {
    beforeEach(() => {
      mockDocumentManager.getDocument.mockResolvedValue(sampleDocument);
      mockAIQueue.enqueueRequest.mockResolvedValue({ success: true });
    });

    it('should successfully process a valid AI request', async () => {
      const result = await service.processAIRequest(sampleAIRequest);

      expect(result.success).toBe(true);
      expect(result.requestId).toBe(sampleAIRequest.id);
      expect(mockDocumentManager.getDocument).toHaveBeenCalledWith('doc-1');
      expect(mockAIQueue.enqueueRequest).toHaveBeenCalledWith(
        sampleAIRequest,
        expect.any(Number) // priority
      );
    });

    it('should generate request ID if not provided', async () => {
      const requestWithoutId = { ...sampleAIRequest };
      delete (requestWithoutId as any).id;

      const result = await service.processAIRequest(requestWithoutId as AIRequest);

      expect(result.success).toBe(true);
      expect(result.requestId).toBeDefined();
      expect(result.requestId).toMatch(/^[0-9a-f-]{36}$/); // UUID format
    });

    it('should reject request for non-existent document', async () => {
      mockDocumentManager.getDocument.mockResolvedValue(null);

      const result = await service.processAIRequest(sampleAIRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Document not found');
      expect(mockAIQueue.enqueueRequest).not.toHaveBeenCalled();
    });

    it('should reject request with invalid selection bounds', async () => {
      const invalidRequest = {
        ...sampleAIRequest,
        selectionStart: -1,
        selectionEnd: 5
      };

      const result = await service.processAIRequest(invalidRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Invalid selection bounds');
    });

    it('should reject request with mismatched selected text', async () => {
      const mismatchedRequest = {
        ...sampleAIRequest,
        selectedText: 'Different text'
      };

      const result = await service.processAIRequest(mismatchedRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Selected text does not match document content');
    });

    it('should handle queue enqueue failure', async () => {
      mockAIQueue.enqueueRequest.mockResolvedValue({
        success: false,
        error: 'Queue is full'
      });

      const result = await service.processAIRequest(sampleAIRequest);

      expect(result.success).toBe(false);
      expect(result.error).toBe('Queue is full');
    });

    it('should track request status when enabled', async () => {
      await service.processAIRequest(sampleAIRequest);

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status).toBeDefined();
      expect(status?.status).toBe('pending');
      expect(status?.userId).toBe('user-1');
      expect(status?.documentId).toBe('doc-1');
    });

    it('should send notifications when enabled', async () => {
      await service.processAIRequest(sampleAIRequest);

      expect((mockOperationBroadcaster as any).broadcastToDocument).toHaveBeenCalledWith(
        'doc-1',
        'ai_request_started',
        expect.objectContaining({
          type: 'ai_request',
          payload: sampleAIRequest
        })
      );
    });

    it('should calculate priority based on text length', async () => {
      // Short text should get high priority
      const shortTextRequest = { ...sampleAIRequest, selectedText: 'Hi' };
      await service.processAIRequest(shortTextRequest);
      expect(mockAIQueue.enqueueRequest).toHaveBeenCalledWith(shortTextRequest, 5);

      // Medium text should get medium priority
      const mediumTextRequest = { ...sampleAIRequest, selectedText: 'A'.repeat(200) };
      await service.processAIRequest(mediumTextRequest);
      expect(mockAIQueue.enqueueRequest).toHaveBeenCalledWith(mediumTextRequest, 3);

      // Long text should get low priority
      const longTextRequest = { ...sampleAIRequest, selectedText: 'A'.repeat(600) };
      await service.processAIRequest(longTextRequest);
      expect(mockAIQueue.enqueueRequest).toHaveBeenCalledWith(longTextRequest, 1);
    });
  });

  describe('handleAICompletion', () => {
    beforeEach(() => {
      mockDocumentManager.getDocument.mockResolvedValue(sampleDocument);
      mockDocumentManager.applyOperation.mockResolvedValue(sampleDocument);
      
      // Set up a request status
      service.processAIRequest(sampleAIRequest);
    });

    it('should successfully handle AI completion', async () => {
      const aiResult = 'Greetings, world!';
      
      await service.handleAICompletion(sampleAIRequest.id, aiResult);

      // Should apply operation to document
      expect(mockDocumentManager.applyOperation).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          position: 0,
          content: aiResult,
          length: 12,
          userId: 'user-1'
        })
      );

      // Should broadcast operation
      expect(mockOperationBroadcaster.broadcastOperation).toHaveBeenCalled();

      // Should update status to completed
      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('completed');

      // Should send completion notification
      expect((mockOperationBroadcaster as any).broadcastToDocument).toHaveBeenCalledWith(
        'doc-1',
        'ai_request_completed',
        expect.objectContaining({
          type: 'ai_response',
          payload: expect.objectContaining({
            requestId: sampleAIRequest.id,
            result: aiResult,
            status: 'completed'
          })
        })
      );
    });

    it('should handle document not found error', async () => {
      mockDocumentManager.getDocument.mockResolvedValue(null);

      await service.handleAICompletion(sampleAIRequest.id, 'Result');

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('failed');
      expect(status?.error).toContain('Document doc-1 not found');
    });

    it('should handle operation apply failure', async () => {
      mockDocumentManager.applyOperation.mockResolvedValue(null);

      await service.handleAICompletion(sampleAIRequest.id, 'Result');

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('failed');
      expect(status?.error).toContain('Failed to apply AI operation');
    });

    it('should handle missing request status', async () => {
      const unknownRequestId = 'unknown-request';
      
      await service.handleAICompletion(unknownRequestId, 'Result');

      // Should not throw error, just log and return
      expect(mockDocumentManager.applyOperation).not.toHaveBeenCalled();
    });
  });

  describe('handleRequestFailure', () => {
    beforeEach(() => {
      service.processAIRequest(sampleAIRequest);
    });

    it('should update status to failed', async () => {
      const error = 'AI processing failed';
      
      await service.handleRequestFailure(sampleAIRequest.id, error);

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe(error);
    });

    it('should send failure notification', async () => {
      const error = 'AI processing failed';
      
      await service.handleRequestFailure(sampleAIRequest.id, error);

      expect((mockOperationBroadcaster as any).broadcastToDocument).toHaveBeenCalledWith(
        'doc-1',
        'ai_request_failed',
        expect.objectContaining({
          type: 'ai_response',
          payload: expect.objectContaining({
            requestId: sampleAIRequest.id,
            status: 'failed',
            error
          })
        })
      );
    });
  });

  describe('request management', () => {
    beforeEach(() => {
      service.processAIRequest(sampleAIRequest);
      service.processAIRequest({
        ...sampleAIRequest,
        id: 'ai-request-2',
        userId: 'user-2'
      });
    });

    it('should get request status', () => {
      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status).toBeDefined();
      expect(status?.requestId).toBe(sampleAIRequest.id);
    });

    it('should get user requests', () => {
      const userRequests = service.getUserRequests('user-1');
      expect(userRequests).toHaveLength(1);
      expect(userRequests[0].userId).toBe('user-1');
    });

    it('should get document requests', () => {
      const docRequests = service.getDocumentRequests('doc-1');
      expect(docRequests).toHaveLength(2);
      expect(docRequests.every(r => r.documentId === 'doc-1')).toBe(true);
    });
  });

  describe('cancelRequest', () => {
    beforeEach(() => {
      service.processAIRequest(sampleAIRequest);
    });

    it('should successfully cancel a pending request', async () => {
      const result = await service.cancelRequest(sampleAIRequest.id, 'user-1');

      expect(result.success).toBe(true);
      
      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('Cancelled by user');
    });

    it('should reject cancellation by unauthorized user', async () => {
      const result = await service.cancelRequest(sampleAIRequest.id, 'user-2');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Unauthorized to cancel this request');
    });

    it('should reject cancellation of non-existent request', async () => {
      const result = await service.cancelRequest('unknown-request', 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request not found');
    });

    it('should reject cancellation of completed request', async () => {
      // Mark request as completed
      await service.handleAICompletion(sampleAIRequest.id, 'Result');

      const result = await service.cancelRequest(sampleAIRequest.id, 'user-1');

      expect(result.success).toBe(false);
      expect(result.error).toBe('Request already completed');
    });
  });

  describe('request monitoring', () => {
    beforeEach(() => {
      mockAIQueue.getRequestResult.mockResolvedValue({ found: false });
    });

    it('should monitor request and handle completion', async () => {
      // Set up queue to return completed result
      mockAIQueue.getRequestResult.mockResolvedValue({
        found: true,
        result: {
          status: 'completed',
          result: 'AI processed text'
        }
      });

      mockDocumentManager.getDocument.mockResolvedValue(sampleDocument);
      mockDocumentManager.applyOperation.mockResolvedValue(sampleDocument);

      await service.processAIRequest(sampleAIRequest);

      // Fast-forward timers to trigger monitoring
      jest.advanceTimersByTime(2000);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('completed');
    });

    it('should monitor request and handle failure', async () => {
      mockAIQueue.getRequestResult.mockResolvedValue({
        found: true,
        result: {
          status: 'failed',
          error: 'AI processing error'
        }
      });

      await service.processAIRequest(sampleAIRequest);

      // Fast-forward timers to trigger monitoring
      jest.advanceTimersByTime(2000);

      // Wait for async operations
      await new Promise(resolve => setTimeout(resolve, 0));

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('AI processing error');
    });

    it('should timeout requests that take too long', async () => {
      await service.processAIRequest(sampleAIRequest);

      // Fast-forward past the timeout
      jest.advanceTimersByTime(6000); // Longer than maxProcessingTimeMs

      const status = service.getRequestStatus(sampleAIRequest.id);
      expect(status?.status).toBe('failed');
      expect(status?.error).toBe('Processing timeout exceeded');
    });
  });

  describe('statistics and cleanup', () => {
    beforeEach(() => {
      service.processAIRequest(sampleAIRequest);
      service.processAIRequest({
        ...sampleAIRequest,
        id: 'ai-request-2',
        userId: 'user-2'
      });
    });

    it('should provide accurate statistics', () => {
      const stats = service.getStatistics();

      expect(stats.totalRequests).toBe(2);
      expect(stats.pendingRequests).toBe(2);
      expect(stats.processingRequests).toBe(0);
      expect(stats.completedRequests).toBe(0);
      expect(stats.failedRequests).toBe(0);
    });

    it('should clean up old completed requests', async () => {
      // Complete one request
      await service.handleAICompletion(sampleAIRequest.id, 'Result');

      // Mock old timestamp
      const status = service.getRequestStatus(sampleAIRequest.id);
      if (status) {
        status.updatedAt = new Date(Date.now() - 7200000); // 2 hours ago
      }

      await service.cleanupOldRequests(3600000); // 1 hour max age

      expect(service.getRequestStatus(sampleAIRequest.id)).toBeNull();
      expect(service.getRequestStatus('ai-request-2')).toBeDefined(); // Still pending
    });
  });

  describe('configuration options', () => {
    it('should disable status tracking when configured', async () => {
      const serviceWithoutTracking = new AIIntegrationService(
        mockAIQueue,
        mockDocumentManager,
        mockOperationBroadcaster,
        { enableStatusTracking: false }
      );

      mockDocumentManager.getDocument.mockResolvedValue(sampleDocument);
      mockAIQueue.enqueueRequest.mockResolvedValue({ success: true });

      await serviceWithoutTracking.processAIRequest(sampleAIRequest);

      expect(serviceWithoutTracking.getRequestStatus(sampleAIRequest.id)).toBeNull();
    });

    it('should disable notifications when configured', async () => {
      const serviceWithoutNotifications = new AIIntegrationService(
        mockAIQueue,
        mockDocumentManager,
        mockOperationBroadcaster,
        { enableUserNotifications: false }
      );

      mockDocumentManager.getDocument.mockResolvedValue(sampleDocument);
      mockAIQueue.enqueueRequest.mockResolvedValue({ success: true });

      await serviceWithoutNotifications.processAIRequest(sampleAIRequest);

      expect((mockOperationBroadcaster as any).broadcastToDocument).not.toHaveBeenCalled();
    });
  });
});