import { AIRequest, Operation, AIRequestMessage, AIResponseMessage } from '../../../shared/types';
import { AIProcessingQueue } from './AIProcessingQueue';
import { DocumentManager } from './DocumentManager';
import { OperationBroadcaster } from './OperationBroadcaster';
import { v4 as uuidv4 } from 'uuid';

export interface AIIntegrationConfig {
  enableStatusTracking?: boolean;
  enableUserNotifications?: boolean;
  maxProcessingTimeMs?: number;
}

export interface AIRequestStatus {
  requestId: string;
  userId: string;
  documentId: string;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  progress?: number;
  error?: string;
  createdAt: Date;
  updatedAt: Date;
  // Store original request details
  originalRequest?: AIRequest;
}

/**
 * AIIntegrationService connects AI processing with document operations
 * and operational transformation system
 */
export class AIIntegrationService {
  private aiQueue: AIProcessingQueue;
  private documentManager: DocumentManager;
  private operationBroadcaster: OperationBroadcaster;
  private config: Required<AIIntegrationConfig>;
  private requestStatuses = new Map<string, AIRequestStatus>();
  private processingTimeouts = new Map<string, NodeJS.Timeout>();
  private responseCallbacks = new Map<string, (response: AIResponseMessage) => void>();

  constructor(
    aiQueue: AIProcessingQueue,
    documentManager: DocumentManager,
    operationBroadcaster: OperationBroadcaster,
    config: AIIntegrationConfig = {}
  ) {
    this.aiQueue = aiQueue;
    this.documentManager = documentManager;
    this.operationBroadcaster = operationBroadcaster;
    this.config = {
      enableStatusTracking: true,
      enableUserNotifications: true,
      maxProcessingTimeMs: 60000, // 1 minute
      ...config
    };
  }

  /**
   * Register a callback for AI response
   */
  registerResponseCallback(requestId: string, callback: (response: AIResponseMessage) => void): void {
    this.responseCallbacks.set(requestId, callback);
  }

  /**
   * Process an AI request and integrate the result with document operations
   */
  async processAIRequest(request: AIRequest): Promise<{ success: boolean; requestId?: string; error?: string }> {
    try {
      // Validate the request
      const validation = await this.validateAIRequest(request);
      if (!validation.valid) {
        return { success: false, error: validation.error };
      }

      // Generate unique request ID if not provided
      const requestId = request.id || uuidv4();
      const enhancedRequest = { ...request, id: requestId };

      // Track request status
      if (this.config.enableStatusTracking) {
        await this.updateRequestStatus(requestId, {
          requestId,
          userId: request.userId,
          documentId: request.documentId,
          status: 'pending',
          createdAt: new Date(),
          updatedAt: new Date(),
          originalRequest: enhancedRequest
        });
      }

      // Set processing timeout
      this.setProcessingTimeout(requestId);

      // Enqueue the request for AI processing
      const enqueueResult = await this.aiQueue.enqueueRequest(enhancedRequest, this.calculatePriority(request));
      
      if (!enqueueResult.success) {
        await this.handleRequestFailure(requestId, enqueueResult.error || 'Failed to enqueue request');
        return { success: false, error: enqueueResult.error };
      }

      // Handle cached responses
      if (enqueueResult.cached) {
        console.log(`Using cached response for request ${requestId}`);
        const cachedResult = await this.aiQueue.getRequestResult(requestId);
        if (cachedResult.found && cachedResult.result) {
          // Process cached result immediately
          setTimeout(() => {
            this.handleAICompletion(requestId, cachedResult.result.result || cachedResult.result);
          }, 100);
        }
      }

      // Start monitoring the request
      this.monitorRequest(requestId);

      // Notify users if enabled
      if (this.config.enableUserNotifications) {
        await this.notifyRequestStarted(enhancedRequest);
      }

      return { success: true, requestId };
    } catch (error) {
      console.error('Error processing AI request:', error);
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Handle completed AI request by applying changes as document operations
   */
  async handleAICompletion(requestId: string, result: string): Promise<void> {
    try {
      const status = this.requestStatuses.get(requestId);
      if (!status) {
        console.error(`No status found for request ${requestId}`);
        return;
      }

      // Update status to processing
      await this.updateRequestStatus(requestId, { ...status, status: 'processing', updatedAt: new Date() });

      // Get the original request details
      const document = await this.documentManager.getDocument(status.documentId);
      if (!document) {
        throw new Error(`Document ${status.documentId} not found`);
      }

      // Find the original request to get selection details
      const originalRequest = await this.getOriginalRequest(requestId);
      if (!originalRequest) {
        throw new Error(`Original request ${requestId} not found`);
      }

      // Create operation to replace selected text with AI result
      const operation: Operation = {
        type: 'insert',
        position: originalRequest.selectionStart,
        content: result,
        length: originalRequest.selectionEnd - originalRequest.selectionStart,
        userId: originalRequest.userId,
        timestamp: new Date(),
        version: document.version + 1
      };

      // Apply the operation through document manager
      const updatedDocument = await this.documentManager.applyOperation(status.documentId, operation);
      if (!updatedDocument) {
        throw new Error(`Failed to apply AI operation to document ${status.documentId}`);
      }

      // Broadcast the operation to all connected clients
      await this.operationBroadcaster.broadcastOperation(status.documentId, operation);

      // Update status to completed
      await this.updateRequestStatus(requestId, { 
        ...status, 
        status: 'completed', 
        updatedAt: new Date() 
      });

      // Clear processing timeout
      this.clearProcessingTimeout(requestId);

      // Notify users of completion
      if (this.config.enableUserNotifications) {
        await this.notifyRequestCompleted(requestId, result);
      }

      console.log(`AI request ${requestId} completed and applied to document ${status.documentId}`);
    } catch (error) {
      console.error(`Error handling AI completion for request ${requestId}:`, error);
      await this.handleRequestFailure(requestId, (error as Error).message);
    }
  }

  /**
   * Handle failed AI request
   */
  async handleRequestFailure(requestId: string, error: string): Promise<void> {
    try {
      const status = this.requestStatuses.get(requestId);
      if (status) {
        await this.updateRequestStatus(requestId, {
          ...status,
          status: 'failed',
          error,
          updatedAt: new Date()
        });
      }

      // Clear processing timeout
      this.clearProcessingTimeout(requestId);

      // Notify users of failure
      if (this.config.enableUserNotifications) {
        await this.notifyRequestFailed(requestId, error);
      }

      console.log(`AI request ${requestId} failed: ${error}`);
    } catch (notificationError) {
      console.error(`Error handling request failure for ${requestId}:`, notificationError);
    }
  }

  /**
   * Get status of an AI request
   */
  getRequestStatus(requestId: string): AIRequestStatus | null {
    return this.requestStatuses.get(requestId) || null;
  }

  /**
   * Get all active requests for a user
   */
  getUserRequests(userId: string): AIRequestStatus[] {
    return Array.from(this.requestStatuses.values())
      .filter(status => status.userId === userId);
  }

  /**
   * Get all active requests for a document
   */
  getDocumentRequests(documentId: string): AIRequestStatus[] {
    return Array.from(this.requestStatuses.values())
      .filter(status => status.documentId === documentId);
  }

  /**
   * Cancel an AI request
   */
  async cancelRequest(requestId: string, userId: string): Promise<{ success: boolean; error?: string }> {
    try {
      const status = this.requestStatuses.get(requestId);
      if (!status) {
        return { success: false, error: 'Request not found' };
      }

      if (status.userId !== userId) {
        return { success: false, error: 'Unauthorized to cancel this request' };
      }

      if (status.status === 'completed' || status.status === 'failed') {
        return { success: false, error: 'Request already completed' };
      }

      // Update status
      await this.updateRequestStatus(requestId, {
        ...status,
        status: 'failed',
        error: 'Cancelled by user',
        updatedAt: new Date()
      });

      // Clear timeout
      this.clearProcessingTimeout(requestId);

      // Notify cancellation
      if (this.config.enableUserNotifications) {
        await this.notifyRequestFailed(requestId, 'Cancelled by user');
      }

      return { success: true };
    } catch (error) {
      return { success: false, error: (error as Error).message };
    }
  }

  /**
   * Validate AI request before processing
   */
  private async validateAIRequest(request: AIRequest): Promise<{ valid: boolean; error?: string }> {
    // Check if document exists
    const document = await this.documentManager.getDocument(request.documentId);
    if (!document) {
      return { valid: false, error: 'Document not found' };
    }

    // Basic validation of selection range
    if (request.selectionStart < 0) {
      return { valid: false, error: 'Selection start cannot be negative' };
    }

    if (request.selectionStart >= request.selectionEnd) {
      return { valid: false, error: 'Invalid selection range' };
    }

    // Validate selected text is not empty
    if (!request.selectedText || request.selectedText.trim().length === 0) {
      return { valid: false, error: 'Selected text cannot be empty' };
    }

    // More flexible validation - allow for document changes
    // Instead of strict bounds checking, we'll try to find the text in the document
    const currentContent = document.content;
    
    // If the exact selection bounds are still valid, use them
    if (request.selectionEnd <= currentContent.length) {
      const currentSelectedText = currentContent.substring(request.selectionStart, request.selectionEnd);
      if (currentSelectedText === request.selectedText) {
        return { valid: true };
      }
    }

    // If exact bounds don't work, try to find the text nearby
    const searchStart = Math.max(0, request.selectionStart - 100);
    const searchEnd = Math.min(currentContent.length, request.selectionEnd + 100);
    const searchArea = currentContent.substring(searchStart, searchEnd);
    
    if (searchArea.includes(request.selectedText)) {
      // Update the request with the correct position
      const relativeIndex = searchArea.indexOf(request.selectedText);
      const actualStart = searchStart + relativeIndex;
      const actualEnd = actualStart + request.selectedText.length;
      
      // Update the request coordinates
      request.selectionStart = actualStart;
      request.selectionEnd = actualEnd;
      
      console.log(`Adjusted selection bounds for request ${request.id}: ${actualStart}-${actualEnd}`);
      return { valid: true };
    }

    // If we can't find the text, it may have been edited - allow the request but warn
    console.warn(`Selected text not found in document for request ${request.id}, proceeding anyway`);
    return { valid: true };
  }

  /**
   * Calculate priority for AI request
   */
  private calculatePriority(request: AIRequest): number {
    // Higher priority for shorter text (faster processing)
    const textLength = request.selectedText.length;
    if (textLength < 100) return 5;
    if (textLength < 500) return 3;
    return 1;
  }

  /**
   * Update request status
   */
  private async updateRequestStatus(requestId: string, status: AIRequestStatus): Promise<void> {
    if (this.config.enableStatusTracking) {
      this.requestStatuses.set(requestId, status);
    }
  }

  /**
   * Set processing timeout for request
   */
  private setProcessingTimeout(requestId: string): void {
    const timeout = setTimeout(() => {
      this.handleRequestFailure(requestId, 'Processing timeout exceeded');
    }, this.config.maxProcessingTimeMs);

    this.processingTimeouts.set(requestId, timeout);
  }

  /**
   * Clear processing timeout
   */
  private clearProcessingTimeout(requestId: string): void {
    const timeout = this.processingTimeouts.get(requestId);
    if (timeout) {
      clearTimeout(timeout);
      this.processingTimeouts.delete(requestId);
    }
  }

  /**
   * Monitor request progress
   */
  private async monitorRequest(requestId: string): Promise<void> {
    // Poll for request completion
    const checkInterval = setInterval(async () => {
      try {
        const result = await this.aiQueue.getRequestResult(requestId);
        if (result.found) {
          clearInterval(checkInterval);
          
          if (result.result.status === 'completed') {
            await this.handleAICompletion(requestId, result.result.result);
          } else if (result.result.status === 'failed') {
            await this.handleRequestFailure(requestId, result.result.error || 'AI processing failed');
          }
        }
      } catch (error) {
        console.error(`Error monitoring request ${requestId}:`, error);
        clearInterval(checkInterval);
        await this.handleRequestFailure(requestId, 'Monitoring error');
      }
    }, 2000); // Check every 2 seconds

    // Clear interval after max processing time
    setTimeout(() => {
      clearInterval(checkInterval);
    }, this.config.maxProcessingTimeMs);
  }

  /**
   * Get original request details
   */
  private async getOriginalRequest(requestId: string): Promise<AIRequest | null> {
    const status = this.requestStatuses.get(requestId);
    if (!status || !status.originalRequest) {
      console.error(`No original request found for ${requestId}`);
      return null;
    }

    return status.originalRequest;
  }

  /**
   * Notify users that request has started
   */
  private async notifyRequestStarted(request: AIRequest): Promise<void> {
    const message: AIRequestMessage = {
      type: 'ai_request',
      payload: request,
      timestamp: new Date()
    };

    await this.operationBroadcaster.broadcastToDocument(request.documentId, 'ai_request_started', message);
  }

  /**
   * Notify users that request has completed
   */
  private async notifyRequestCompleted(requestId: string, result: string): Promise<void> {
    const status = this.requestStatuses.get(requestId);
    if (!status) return;

    const message: AIResponseMessage = {
      type: 'ai_response',
      payload: {
        requestId,
        result,
        status: 'completed'
      },
      timestamp: new Date()
    };

    // Use callback if registered
    const callback = this.responseCallbacks.get(requestId);
    if (callback) {
      callback(message);
      this.responseCallbacks.delete(requestId);
    } else {
      // Fallback to broadcasting
      await this.operationBroadcaster.broadcastToDocument(status.documentId, 'ai_request_completed', message);
    }
  }

  /**
   * Notify users that request has failed
   */
  private async notifyRequestFailed(requestId: string, error: string): Promise<void> {
    const status = this.requestStatuses.get(requestId);
    if (!status) return;

    const message: AIResponseMessage = {
      type: 'ai_response',
      payload: {
        requestId,
        result: '',
        status: 'failed',
        error
      },
      timestamp: new Date()
    };

    // Use callback if registered
    const callback = this.responseCallbacks.get(requestId);
    if (callback) {
      callback(message);
      this.responseCallbacks.delete(requestId);
    } else {
      // Fallback to broadcasting
      await this.operationBroadcaster.broadcastToDocument(status.documentId, 'ai_request_failed', message);
    }
  }

  /**
   * Clean up completed and failed requests older than specified time
   */
  async cleanupOldRequests(maxAgeMs: number = 3600000): Promise<void> { // Default 1 hour
    const cutoffTime = new Date(Date.now() - maxAgeMs);
    
    for (const [requestId, status] of this.requestStatuses.entries()) {
      if ((status.status === 'completed' || status.status === 'failed') && 
          status.updatedAt < cutoffTime) {
        this.requestStatuses.delete(requestId);
        this.clearProcessingTimeout(requestId);
      }
    }
  }

  /**
   * Get service statistics
   */
  getStatistics(): {
    totalRequests: number;
    pendingRequests: number;
    processingRequests: number;
    completedRequests: number;
    failedRequests: number;
  } {
    const statuses = Array.from(this.requestStatuses.values());
    
    return {
      totalRequests: statuses.length,
      pendingRequests: statuses.filter(s => s.status === 'pending').length,
      processingRequests: statuses.filter(s => s.status === 'processing').length,
      completedRequests: statuses.filter(s => s.status === 'completed').length,
      failedRequests: statuses.filter(s => s.status === 'failed').length
    };
  }
}