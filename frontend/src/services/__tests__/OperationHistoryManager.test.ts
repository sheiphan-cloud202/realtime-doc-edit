/**
 * Tests for OperationHistoryManager
 */

import { OperationHistoryManager, OperationHistoryManagerCallbacks } from '../OperationHistoryManager';
import { Operation, HistoryEntry } from '../../../../shared/types';

describe('OperationHistoryManager', () => {
  let historyManager: OperationHistoryManager;
  let mockCallbacks: jest.Mocked<OperationHistoryManagerCallbacks>;
  const documentId = 'test-doc-123';
  const userId = 'user-456';

  beforeEach(() => {
    mockCallbacks = {
      onHistoryChanged: jest.fn(),
      onOperationUndone: jest.fn(),
      onOperationRedone: jest.fn(),
      onHistoryCleared: jest.fn()
    };

    historyManager = new OperationHistoryManager(
      documentId,
      userId,
      mockCallbacks,
      10 // Small max size for testing
    );
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialization', () => {
    it('should initialize with empty history', () => {
      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(0);
      expect(state.currentIndex).toBe(-1);
      expect(state.maxSize).toBe(10);
    });

    it('should not allow undo or redo initially', () => {
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(false);
    });
  });

  describe('adding operations', () => {
    const createTestOperation = (type: 'insert' | 'delete' | 'retain', content?: string, length?: number): Operation => ({
      type,
      position: 0,
      content,
      length,
      userId,
      timestamp: new Date(),
      version: 1
    });

    it('should add insert operation to history', () => {
      const operation = createTestOperation('insert', 'Hello');
      const docBefore = '';
      const docAfter = 'Hello';

      historyManager.addOperation(operation, docBefore, docAfter);

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(1);
      expect(state.currentIndex).toBe(0);
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);

      expect(mockCallbacks.onHistoryChanged).toHaveBeenCalledWith(true, false, 1);
    });

    it('should add delete operation to history', () => {
      const operation = createTestOperation('delete', undefined, 5);
      const docBefore = 'Hello';
      const docAfter = '';

      historyManager.addOperation(operation, docBefore, docAfter);

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].operation.type).toBe('delete');
      expect(state.entries[0].inverseOperation.type).toBe('insert');
      expect((state.entries[0].inverseOperation as any).content).toBe('Hello');
    });

    it('should ignore operations from other users', () => {
      const operation = createTestOperation('insert', 'Hello');
      operation.userId = 'other-user';

      historyManager.addOperation(operation, '', 'Hello');

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(0);
      expect(mockCallbacks.onHistoryChanged).not.toHaveBeenCalled();
    });

    it('should mark AI operations correctly', () => {
      const operation = createTestOperation('insert', 'AI generated text');
      const aiRequestId = 'ai-request-123';

      historyManager.addOperation(
        operation,
        '',
        'AI generated text',
        true,
        aiRequestId,
        'AI: Generated text'
      );

      const state = historyManager.getHistoryState();
      expect(state.entries[0].isAIOperation).toBe(true);
      expect(state.entries[0].aiRequestId).toBe(aiRequestId);
      expect(state.entries[0].description).toBe('AI: Generated text');
    });

    it('should maintain max history size', () => {
      // Add more operations than max size
      for (let i = 0; i < 15; i++) {
        const operation = createTestOperation('insert', `text${i}`);
        historyManager.addOperation(operation, `prev${i}`, `prev${i}text${i}`);
      }

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(10); // Max size
      expect(state.currentIndex).toBe(9);
    });

    it('should truncate future history when adding after undo', () => {
      // Add three operations
      for (let i = 0; i < 3; i++) {
        const operation = createTestOperation('insert', `text${i}`);
        historyManager.addOperation(operation, `prev${i}`, `prev${i}text${i}`);
      }

      // Undo twice
      historyManager.undo();
      historyManager.undo();

      // Add new operation
      const newOperation = createTestOperation('insert', 'new text');
      historyManager.addOperation(newOperation, 'prev0', 'prev0new text');

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(2); // Original first + new operation
      expect(state.currentIndex).toBe(1);
    });
  });

  describe('undo functionality', () => {
    beforeEach(() => {
      // Add some test operations
      const op1 = { type: 'insert' as const, position: 0, content: 'Hello', userId, timestamp: new Date(), version: 1 };
      const op2 = { type: 'insert' as const, position: 5, content: ' World', userId, timestamp: new Date(), version: 2 };
      
      historyManager.addOperation(op1, '', 'Hello');
      historyManager.addOperation(op2, 'Hello', 'Hello World');
    });

    it('should undo last operation', () => {
      const result = historyManager.undo();

      expect(result).not.toBeNull();
      expect(result!.operation.content).toBe(' World');
      expect(result!.inverseOperation.type).toBe('delete');
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(true);

      expect(mockCallbacks.onOperationUndone).toHaveBeenCalledWith(
        result!.inverseOperation,
        result!
      );
      expect(mockCallbacks.onHistoryChanged).toHaveBeenCalledWith(true, true, 2);
    });

    it('should not undo when no operations available', () => {
      // Undo all operations
      historyManager.undo();
      historyManager.undo();

      const result = historyManager.undo();
      expect(result).toBeNull();
      expect(historyManager.canUndo()).toBe(false);
    });

    it('should handle multiple undos', () => {
      const result1 = historyManager.undo();
      const result2 = historyManager.undo();

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(true);
    });
  });

  describe('redo functionality', () => {
    beforeEach(() => {
      // Add operations and undo them
      const op1 = { type: 'insert' as const, position: 0, content: 'Hello', userId, timestamp: new Date(), version: 1 };
      const op2 = { type: 'insert' as const, position: 5, content: ' World', userId, timestamp: new Date(), version: 2 };
      
      historyManager.addOperation(op1, '', 'Hello');
      historyManager.addOperation(op2, 'Hello', 'Hello World');
      historyManager.undo();
      historyManager.undo();
    });

    it('should redo undone operation', () => {
      const result = historyManager.redo();

      expect(result).not.toBeNull();
      expect(result!.operation.content).toBe('Hello');
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(true);

      expect(mockCallbacks.onOperationRedone).toHaveBeenCalledWith(
        result!.operation,
        result!
      );
    });

    it('should not redo when no operations available', () => {
      // Redo all operations
      historyManager.redo();
      historyManager.redo();

      const result = historyManager.redo();
      expect(result).toBeNull();
      expect(historyManager.canRedo()).toBe(false);
    });

    it('should handle multiple redos', () => {
      const result1 = historyManager.redo();
      const result2 = historyManager.redo();

      expect(result1).not.toBeNull();
      expect(result2).not.toBeNull();
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(false);
    });
  });

  describe('jump to history point', () => {
    beforeEach(() => {
      // Add multiple operations
      for (let i = 0; i < 5; i++) {
        const operation = { 
          type: 'insert' as const, 
          position: i * 5, 
          content: `text${i}`, 
          userId, 
          timestamp: new Date(), 
          version: i + 1 
        };
        historyManager.addOperation(operation, `prev${i}`, `prev${i}text${i}`);
      }
    });

    it('should jump to earlier point in history', () => {
      const operations = historyManager.jumpToHistoryPoint(2);

      expect(operations).toHaveLength(2); // Undid 2 operations
      expect(historyManager.getHistoryState().currentIndex).toBe(2);
      expect(historyManager.canUndo()).toBe(true);
      expect(historyManager.canRedo()).toBe(true);
    });

    it('should jump to later point in history', () => {
      // First go back
      historyManager.jumpToHistoryPoint(1);
      
      // Then jump forward
      const operations = historyManager.jumpToHistoryPoint(3);

      expect(operations).toHaveLength(2); // Redid 2 operations
      expect(historyManager.getHistoryState().currentIndex).toBe(3);
    });

    it('should handle invalid history indices', () => {
      expect(() => historyManager.jumpToHistoryPoint(-2)).toThrow('Invalid history index');
      expect(() => historyManager.jumpToHistoryPoint(10)).toThrow('Invalid history index');
    });

    it('should do nothing when jumping to current position', () => {
      const currentIndex = historyManager.getHistoryState().currentIndex;
      const operations = historyManager.jumpToHistoryPoint(currentIndex);

      expect(operations).toHaveLength(0);
      expect(historyManager.getHistoryState().currentIndex).toBe(currentIndex);
    });
  });

  describe('AI operation management', () => {
    it('should track AI operations separately', () => {
      const userOp = { type: 'insert' as const, position: 0, content: 'user text', userId, timestamp: new Date(), version: 1 };
      const aiOp = { type: 'insert' as const, position: 9, content: 'AI text', userId, timestamp: new Date(), version: 2 };

      historyManager.addOperation(userOp, '', 'user text');
      historyManager.addOperation(aiOp, 'user text', 'user textAI text', true, 'ai-123');

      const aiOperations = historyManager.getAIOperations();
      expect(aiOperations).toHaveLength(1);
      expect(aiOperations[0].isAIOperation).toBe(true);
      expect(aiOperations[0].aiRequestId).toBe('ai-123');
    });

    it('should mark AI operation as completed', () => {
      const aiOp = { type: 'insert' as const, position: 0, content: 'initial', userId, timestamp: new Date(), version: 1 };
      historyManager.addOperation(aiOp, '', 'initial', true, 'ai-123');

      const finalOp = { type: 'insert' as const, position: 0, content: 'final', userId, timestamp: new Date(), version: 2 };
      historyManager.markAIOperationCompleted('ai-123', finalOp);

      const entries = historyManager.getHistoryEntries();
      expect(entries[0].operation.content).toBe('final');
    });

    it('should remove rejected AI operation', () => {
      const userOp = { type: 'insert' as const, position: 0, content: 'user', userId, timestamp: new Date(), version: 1 };
      const aiOp = { type: 'insert' as const, position: 4, content: 'AI', userId, timestamp: new Date(), version: 2 };

      historyManager.addOperation(userOp, '', 'user');
      historyManager.addOperation(aiOp, 'user', 'userAI', true, 'ai-123');

      expect(historyManager.getHistoryState().entries).toHaveLength(2);

      historyManager.removeAIOperation('ai-123');

      expect(historyManager.getHistoryState().entries).toHaveLength(1);
      expect(historyManager.getHistoryState().entries[0].isAIOperation).toBe(false);
    });
  });

  describe('history statistics', () => {
    beforeEach(() => {
      // Add mixed operations
      const userOp1 = { type: 'insert' as const, position: 0, content: 'user1', userId, timestamp: new Date(), version: 1 };
      const aiOp1 = { type: 'insert' as const, position: 5, content: 'ai1', userId, timestamp: new Date(), version: 2 };
      const userOp2 = { type: 'insert' as const, position: 8, content: 'user2', userId, timestamp: new Date(), version: 3 };

      historyManager.addOperation(userOp1, '', 'user1');
      historyManager.addOperation(aiOp1, 'user1', 'user1ai1', true, 'ai-1');
      historyManager.addOperation(userOp2, 'user1ai1', 'user1ai1user2');
    });

    it('should provide accurate statistics', () => {
      const stats = historyManager.getHistoryStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.aiOperations).toBe(1);
      expect(stats.userOperations).toBe(2);
      expect(stats.currentPosition).toBe(3);
    });

    it('should update statistics after undo', () => {
      historyManager.undo();
      const stats = historyManager.getHistoryStats();

      expect(stats.totalOperations).toBe(3);
      expect(stats.currentPosition).toBe(2);
    });
  });

  describe('clear history', () => {
    beforeEach(() => {
      // Add some operations
      for (let i = 0; i < 3; i++) {
        const operation = { 
          type: 'insert' as const, 
          position: 0, 
          content: `text${i}`, 
          userId, 
          timestamp: new Date(), 
          version: i + 1 
        };
        historyManager.addOperation(operation, '', `text${i}`);
      }
    });

    it('should clear all history', () => {
      historyManager.clearHistory();

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(0);
      expect(state.currentIndex).toBe(-1);
      expect(historyManager.canUndo()).toBe(false);
      expect(historyManager.canRedo()).toBe(false);

      expect(mockCallbacks.onHistoryCleared).toHaveBeenCalled();
      expect(mockCallbacks.onHistoryChanged).toHaveBeenCalledWith(false, false, 0);
    });
  });

  describe('export and import', () => {
    beforeEach(() => {
      // Add some test data
      const operation = { type: 'insert' as const, position: 0, content: 'test', userId, timestamp: new Date(), version: 1 };
      historyManager.addOperation(operation, '', 'test');
    });

    it('should export history data', () => {
      const exported = historyManager.exportHistory();
      const data = JSON.parse(exported);

      expect(data.documentId).toBe(documentId);
      expect(data.userId).toBe(userId);
      expect(data.history.entries).toHaveLength(1);
      expect(data.timestamp).toBeDefined();
    });

    it('should import matching history data', () => {
      const exported = historyManager.exportHistory();
      
      // Clear and import
      historyManager.clearHistory();
      historyManager.importHistory(exported);

      const state = historyManager.getHistoryState();
      expect(state.entries).toHaveLength(1);
      expect(state.entries[0].operation.content).toBe('test');
    });

    it('should reject mismatched history data', () => {
      const wrongData = JSON.stringify({
        documentId: 'wrong-doc',
        userId: 'wrong-user',
        history: { entries: [], currentIndex: -1, maxSize: 10 }
      });

      expect(() => historyManager.importHistory(wrongData)).toThrow(
        'History data does not match current document/user'
      );
    });

    it('should handle invalid import data', () => {
      expect(() => historyManager.importHistory('invalid json')).toThrow();
    });
  });

  describe('operation descriptions', () => {
    it('should generate appropriate descriptions for user operations', () => {
      const insertOp = { type: 'insert' as const, position: 0, content: 'Hello', userId, timestamp: new Date(), version: 1 };
      const deleteOp = { type: 'delete' as const, position: 0, length: 5, userId, timestamp: new Date(), version: 2 };

      historyManager.addOperation(insertOp, '', 'Hello');
      historyManager.addOperation(deleteOp, 'Hello', '');

      const entries = historyManager.getHistoryEntries();
      expect(entries[0].description).toBe('Insert 5 characters');
      expect(entries[1].description).toBe('Delete 5 characters');
    });

    it('should generate appropriate descriptions for AI operations', () => {
      const aiOp = { type: 'insert' as const, position: 0, content: 'AI text', userId, timestamp: new Date(), version: 1 };
      historyManager.addOperation(aiOp, '', 'AI text', true, 'ai-123');

      const entries = historyManager.getHistoryEntries();
      expect(entries[0].description).toBe('AI: Insert 7 characters');
    });

    it('should use custom descriptions when provided', () => {
      const operation = { type: 'insert' as const, position: 0, content: 'test', userId, timestamp: new Date(), version: 1 };
      historyManager.addOperation(operation, '', 'test', false, undefined, 'Custom description');

      const entries = historyManager.getHistoryEntries();
      expect(entries[0].description).toBe('Custom description');
    });
  });
});