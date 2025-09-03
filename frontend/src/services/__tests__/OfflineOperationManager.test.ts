import { OfflineOperationManager, QueuedOperation, OfflineOperationManagerCallbacks } from '../OfflineOperationManager';
import { Operation } from '../../../../shared/types';

// Mock localStorage
const localStorageMock = (() => {
  let store: Record<string, string> = {};

  return {
    getItem: (key: string) => store[key] || null,
    setItem: (key: string, value: string) => {
      store[key] = value.toString();
    },
    removeItem: (key: string) => {
      delete store[key];
    },
    clear: () => {
      store = {};
    }
  };
})();

Object.defineProperty(window, 'localStorage', {
  value: localStorageMock
});

// Mock navigator.onLine
Object.defineProperty(navigator, 'onLine', {
  writable: true,
  value: true
});

describe('OfflineOperationManager', () => {
  let manager: OfflineOperationManager;
  let callbacks: OfflineOperationManagerCallbacks;
  const documentId = 'test-doc-123';

  beforeEach(() => {
    localStorageMock.clear();
    
    callbacks = {
      onOperationQueued: jest.fn(),
      onOperationSynced: jest.fn(),
      onSyncError: jest.fn(),
      onOfflineStateChange: jest.fn()
    };

    manager = new OfflineOperationManager(documentId, callbacks);
  });

  afterEach(() => {
    manager.destroy();
  });

  describe('Operation Queuing', () => {
    it('should queue operations correctly', () => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      const queuedOp = manager.queueOperation(operation);

      expect(queuedOp.id).toBeDefined();
      expect(queuedOp.localTimestamp).toBeDefined();
      expect(queuedOp.retryCount).toBe(0);
      expect(queuedOp.maxRetries).toBe(3);
      expect(callbacks.onOperationQueued).toHaveBeenCalledWith(queuedOp);
      expect(manager.getQueueSize()).toBe(1);
    });

    it('should persist queued operations to localStorage', () => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      manager.queueOperation(operation);

      const stored = localStorageMock.getItem(`offline_operations_${documentId}`);
      expect(stored).toBeTruthy();
      
      const parsedState = JSON.parse(stored!);
      expect(parsedState.operations).toHaveLength(1);
      expect(parsedState.documentId).toBe(documentId);
    });

    it('should load persisted operations on initialization', () => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      // Queue operation with first manager
      manager.queueOperation(operation);
      manager.destroy();

      // Create new manager - should load persisted operations
      const newManager = new OfflineOperationManager(documentId, callbacks);
      expect(newManager.getQueueSize()).toBe(1);
      
      newManager.destroy();
    });
  });

  describe('Operation Management', () => {
    let queuedOperation: QueuedOperation;

    beforeEach(() => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };
      queuedOperation = manager.queueOperation(operation);
    });

    it('should remove operations after successful sync', () => {
      manager.removeOperation(queuedOperation.id);

      expect(manager.getQueueSize()).toBe(0);
      expect(callbacks.onOperationSynced).toHaveBeenCalledWith(queuedOperation.id);
    });

    it('should handle operation failures and retry logic', () => {
      const error = new Error('Sync failed');
      
      // First failure
      manager.markOperationFailed(queuedOperation.id, error);
      expect(manager.getQueueSize()).toBe(1);
      expect(callbacks.onSyncError).toHaveBeenCalledWith(queuedOperation.id, error);

      const operations = manager.getQueuedOperations();
      expect(operations[0].retryCount).toBe(1);

      // Second failure
      manager.markOperationFailed(queuedOperation.id, error);
      expect(operations[0].retryCount).toBe(2);

      // Third failure
      manager.markOperationFailed(queuedOperation.id, error);
      expect(operations[0].retryCount).toBe(3);

      // Fourth failure should remove the operation
      manager.markOperationFailed(queuedOperation.id, error);
      expect(manager.getQueueSize()).toBe(0);
    });

    it('should return retryable operations correctly', () => {
      const error = new Error('Sync failed');
      
      // Mark as failed twice (still retryable)
      manager.markOperationFailed(queuedOperation.id, error);
      manager.markOperationFailed(queuedOperation.id, error);

      const retryable = manager.getRetryableOperations();
      expect(retryable).toHaveLength(1);
      expect(retryable[0].retryCount).toBe(2);

      // Mark as failed one more time (reaches max retries)
      manager.markOperationFailed(queuedOperation.id, error);
      manager.markOperationFailed(queuedOperation.id, error);

      const retryableAfter = manager.getRetryableOperations();
      expect(retryableAfter).toHaveLength(0);
    });
  });

  describe('Offline State Management', () => {
    it('should track offline state correctly', () => {
      expect(manager.getOfflineState()).toBe(false); // Initially online

      manager.setOfflineState(true);
      expect(manager.getOfflineState()).toBe(true);
      expect(callbacks.onOfflineStateChange).toHaveBeenCalledWith(true);

      manager.setOfflineState(false);
      expect(manager.getOfflineState()).toBe(false);
      expect(callbacks.onOfflineStateChange).toHaveBeenCalledWith(false);
    });

    it('should not trigger callback if state does not change', () => {
      manager.setOfflineState(false); // Same as initial state
      expect(callbacks.onOfflineStateChange).not.toHaveBeenCalled();
    });

    it('should persist offline state', () => {
      manager.setOfflineState(true);

      const stored = localStorageMock.getItem(`offline_operations_${documentId}`);
      const parsedState = JSON.parse(stored!);
      expect(parsedState.isOffline).toBe(true);
    });
  });

  describe('Sync Version Management', () => {
    it('should track last sync version', () => {
      expect(manager.getLastSyncVersion()).toBe(0);

      manager.updateLastSyncVersion(5);
      expect(manager.getLastSyncVersion()).toBe(5);
    });

    it('should persist sync version', () => {
      manager.updateLastSyncVersion(10);

      const stored = localStorageMock.getItem(`offline_operations_${documentId}`);
      const parsedState = JSON.parse(stored!);
      expect(parsedState.lastSyncVersion).toBe(10);
    });
  });

  describe('Operations for Sync', () => {
    it('should return operations sorted by local timestamp', () => {
      const op1: Operation = {
        type: 'insert',
        position: 0,
        content: 'First',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      const op2: Operation = {
        type: 'insert',
        position: 5,
        content: 'Second',
        userId: 'user1',
        timestamp: new Date(),
        version: 2
      };

      // Queue operations
      const queuedOp1 = manager.queueOperation(op1);
      const queuedOp2 = manager.queueOperation(op2);

      const forSync = manager.getOperationsForSync();
      expect(forSync).toHaveLength(2);
      
      // Should be sorted by localTimestamp (FIFO order)
      expect(forSync[0].localTimestamp.getTime()).toBeLessThanOrEqual(forSync[1].localTimestamp.getTime());
      expect(forSync[0].content).toBe('First'); // Queued first
      expect(forSync[1].content).toBe('Second'); // Queued second
    });

    it('should exclude operations that exceeded max retries', () => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      const queuedOp = manager.queueOperation(operation);
      const error = new Error('Sync failed');

      // Fail it max times
      for (let i = 0; i < 3; i++) {
        manager.markOperationFailed(queuedOp.id, error);
      }

      const forSync = manager.getOperationsForSync();
      expect(forSync).toHaveLength(0);
    });
  });

  describe('Network Event Handling', () => {
    it('should handle online/offline events', () => {
      // Simulate going offline
      const offlineEvent = new Event('offline');
      window.dispatchEvent(offlineEvent);
      
      expect(manager.getOfflineState()).toBe(true);
      expect(callbacks.onOfflineStateChange).toHaveBeenCalledWith(true);

      // Simulate going online
      const onlineEvent = new Event('online');
      window.dispatchEvent(onlineEvent);
      
      expect(manager.getOfflineState()).toBe(false);
      expect(callbacks.onOfflineStateChange).toHaveBeenCalledWith(false);
    });
  });

  describe('Utility Methods', () => {
    it('should clear queue correctly', () => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      manager.queueOperation(operation);
      expect(manager.getQueueSize()).toBe(1);

      manager.clearQueue();
      expect(manager.getQueueSize()).toBe(0);
    });

    it('should track sync in progress state', () => {
      expect(manager.isSyncInProgress()).toBe(false);

      manager.setSyncInProgress(true);
      expect(manager.isSyncInProgress()).toBe(true);

      manager.setSyncInProgress(false);
      expect(manager.isSyncInProgress()).toBe(false);
    });
  });

  describe('Error Handling', () => {
    it('should handle localStorage errors gracefully', () => {
      // Mock localStorage to throw error
      const originalSetItem = localStorageMock.setItem;
      localStorageMock.setItem = jest.fn(() => {
        throw new Error('Storage quota exceeded');
      });

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      // Should not throw error
      expect(() => manager.queueOperation(operation)).not.toThrow();
      expect(consoleSpy).toHaveBeenCalledWith('Failed to save offline state:', expect.any(Error));

      // Restore
      localStorageMock.setItem = originalSetItem;
      consoleSpy.mockRestore();
    });

    it('should handle corrupted localStorage data', () => {
      // Set corrupted data
      localStorageMock.setItem(`offline_operations_${documentId}`, 'invalid json');

      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      // Should not throw error and should initialize with defaults
      const newManager = new OfflineOperationManager(documentId, callbacks);
      expect(newManager.getQueueSize()).toBe(0);
      expect(newManager.getLastSyncVersion()).toBe(0);
      expect(consoleSpy).toHaveBeenCalledWith('Failed to load offline state:', expect.any(Error));

      newManager.destroy();
      consoleSpy.mockRestore();
    });
  });
});