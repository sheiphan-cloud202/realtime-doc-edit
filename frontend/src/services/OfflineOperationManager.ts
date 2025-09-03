import { Operation } from '../shared/types';

export interface QueuedOperation extends Operation {
  id: string;
  localTimestamp: Date;
  retryCount: number;
  maxRetries: number;
}

export interface OfflineState {
  documentId: string;
  operations: QueuedOperation[];
  lastSyncVersion: number;
  isOffline: boolean;
  lastSyncTimestamp: Date;
}

export interface OfflineOperationManagerCallbacks {
  onOperationQueued: (operation: QueuedOperation) => void;
  onOperationSynced: (operationId: string) => void;
  onSyncError: (operationId: string, error: Error) => void;
  onOfflineStateChange: (isOffline: boolean) => void;
}

export class OfflineOperationManager {
  private documentId: string;
  private callbacks: OfflineOperationManagerCallbacks;
  private storageKey: string;
  private isOffline: boolean = false;
  private operationQueue: QueuedOperation[] = [];
  private lastSyncVersion: number = 0;
  private syncInProgress: boolean = false;

  constructor(documentId: string, callbacks: OfflineOperationManagerCallbacks) {
    this.documentId = documentId;
    this.callbacks = callbacks;
    this.storageKey = `offline_operations_${documentId}`;
    
    this.loadOfflineState();
    this.setupNetworkListeners();
  }

  /**
   * Queue an operation for offline storage and later synchronization
   */
  public queueOperation(operation: Operation): QueuedOperation {
    const queuedOperation: QueuedOperation = {
      ...operation,
      id: this.generateOperationId(),
      localTimestamp: new Date(),
      retryCount: 0,
      maxRetries: 3
    };

    this.operationQueue.push(queuedOperation);
    this.saveOfflineState();
    this.callbacks.onOperationQueued(queuedOperation);

    return queuedOperation;
  }

  /**
   * Get all queued operations
   */
  public getQueuedOperations(): QueuedOperation[] {
    return [...this.operationQueue];
  }

  /**
   * Remove an operation from the queue (after successful sync)
   */
  public removeOperation(operationId: string): void {
    const index = this.operationQueue.findIndex(op => op.id === operationId);
    if (index !== -1) {
      this.operationQueue.splice(index, 1);
      this.saveOfflineState();
      this.callbacks.onOperationSynced(operationId);
    }
  }

  /**
   * Mark an operation as failed and increment retry count
   */
  public markOperationFailed(operationId: string, error: Error): void {
    const operation = this.operationQueue.find(op => op.id === operationId);
    if (operation) {
      operation.retryCount++;
      
      if (operation.retryCount >= operation.maxRetries) {
        // Remove operation after max retries
        this.removeOperation(operationId);
      } else {
        this.saveOfflineState();
      }
      
      this.callbacks.onSyncError(operationId, error);
    }
  }

  /**
   * Get operations that are ready for retry
   */
  public getRetryableOperations(): QueuedOperation[] {
    return this.operationQueue.filter(op => op.retryCount < op.maxRetries);
  }

  /**
   * Set offline state
   */
  public setOfflineState(isOffline: boolean): void {
    if (this.isOffline !== isOffline) {
      this.isOffline = isOffline;
      this.saveOfflineState();
      this.callbacks.onOfflineStateChange(isOffline);
    }
  }

  /**
   * Get current offline state
   */
  public getOfflineState(): boolean {
    return this.isOffline;
  }

  /**
   * Update the last synchronized version
   */
  public updateLastSyncVersion(version: number): void {
    this.lastSyncVersion = version;
    this.saveOfflineState();
  }

  /**
   * Get the last synchronized version
   */
  public getLastSyncVersion(): number {
    return this.lastSyncVersion;
  }

  /**
   * Clear all queued operations (use with caution)
   */
  public clearQueue(): void {
    this.operationQueue = [];
    this.saveOfflineState();
  }

  /**
   * Get queue size
   */
  public getQueueSize(): number {
    return this.operationQueue.length;
  }

  /**
   * Check if sync is in progress
   */
  public isSyncInProgress(): boolean {
    return this.syncInProgress;
  }

  /**
   * Set sync in progress state
   */
  public setSyncInProgress(inProgress: boolean): void {
    this.syncInProgress = inProgress;
  }

  /**
   * Get operations that need to be synchronized (sorted by timestamp)
   */
  public getOperationsForSync(): QueuedOperation[] {
    return this.operationQueue
      .filter(op => op.retryCount < op.maxRetries)
      .sort((a, b) => {
        // Ensure timestamps are Date objects
        const aTime = a.localTimestamp instanceof Date ? a.localTimestamp.getTime() : new Date(a.localTimestamp).getTime();
        const bTime = b.localTimestamp instanceof Date ? b.localTimestamp.getTime() : new Date(b.localTimestamp).getTime();
        return aTime - bTime;
      });
  }

  /**
   * Save offline state to localStorage
   */
  private saveOfflineState(): void {
    try {
      const state: OfflineState = {
        documentId: this.documentId,
        operations: this.operationQueue,
        lastSyncVersion: this.lastSyncVersion,
        isOffline: this.isOffline,
        lastSyncTimestamp: new Date()
      };

      localStorage.setItem(this.storageKey, JSON.stringify(state, this.dateReplacer));
    } catch (error) {
      console.error('Failed to save offline state:', error);
    }
  }

  /**
   * Load offline state from localStorage
   */
  private loadOfflineState(): void {
    try {
      const stored = localStorage.getItem(this.storageKey);
      if (stored) {
        const state: OfflineState = JSON.parse(stored, this.dateReviver);
        
        // Ensure all operations have proper Date objects
        this.operationQueue = (state.operations || []).map(op => ({
          ...op,
          localTimestamp: op.localTimestamp instanceof Date ? op.localTimestamp : new Date(op.localTimestamp),
          timestamp: op.timestamp instanceof Date ? op.timestamp : new Date(op.timestamp)
        }));
        
        this.lastSyncVersion = state.lastSyncVersion || 0;
        this.isOffline = state.isOffline || false;
      }
    } catch (error) {
      console.error('Failed to load offline state:', error);
      this.operationQueue = [];
      this.lastSyncVersion = 0;
      this.isOffline = false;
    }
  }

  /**
   * Setup network status listeners
   */
  private setupNetworkListeners(): void {
    window.addEventListener('online', () => {
      this.setOfflineState(false);
    });

    window.addEventListener('offline', () => {
      this.setOfflineState(true);
    });

    // Initial network state
    this.setOfflineState(!navigator.onLine);
  }

  /**
   * Generate unique operation ID
   */
  private generateOperationId(): string {
    return `offline_${this.documentId}_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
  }

  /**
   * JSON replacer for Date objects
   */
  private dateReplacer(key: string, value: any): any {
    if (value instanceof Date) {
      return { __type: 'Date', value: value.toISOString() };
    }
    return value;
  }

  /**
   * JSON reviver for Date objects
   */
  private dateReviver(key: string, value: any): any {
    if (value && value.__type === 'Date') {
      return new Date(value.value);
    }
    return value;
  }

  /**
   * Cleanup resources
   */
  public destroy(): void {
    window.removeEventListener('online', () => {});
    window.removeEventListener('offline', () => {});
  }
}

export default OfflineOperationManager;