import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { OperationBroadcaster } from '../OperationBroadcaster';
import { DocumentManager } from '../DocumentManager';
import { Operation, Collaborator, Document } from '../../../../shared/types';

// Mock DocumentManager
jest.mock('../DocumentManager');

describe('OperationBroadcaster', () => {
  let httpServer: any;
  let io: SocketIOServer;
  let operationBroadcaster: OperationBroadcaster;
  let mockDocumentManager: jest.Mocked<DocumentManager>;

  beforeEach(() => {
    // Create HTTP server and Socket.IO server
    httpServer = createServer();
    io = new SocketIOServer(httpServer);

    // Create mock document manager
    mockDocumentManager = new DocumentManager() as jest.Mocked<DocumentManager>;
    mockDocumentManager.getDocument = jest.fn();
    mockDocumentManager.applyOperation = jest.fn();
    mockDocumentManager.updateCollaboratorPresence = jest.fn();

    // Initialize operation broadcaster
    operationBroadcaster = new OperationBroadcaster(io, mockDocumentManager);

    // Mock Socket.IO methods - will be overridden in individual tests
  });

  afterEach(() => {
    io.close();
    httpServer.close();
    jest.clearAllMocks();
  });

  describe('Operation Validation', () => {
    test('should validate operation successfully', async () => {
      const mockDocument: Document = {
        id: 'doc123',
        content: 'Hello World',
        version: 5,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 6
      };

      const result = await operationBroadcaster.validateOperation('doc123', operation);

      expect(result.isValid).toBe(true);
      expect(result.transformedOperation).toBeDefined();
      expect(mockDocumentManager.getDocument).toHaveBeenCalledWith('doc123');
    });

    test('should reject operation for non-existent document', async () => {
      mockDocumentManager.getDocument.mockResolvedValue(null);

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 6
      };

      const result = await operationBroadcaster.validateOperation('doc123', operation);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Document not found');
    });

    test('should reject outdated operation', async () => {
      const mockDocument: Document = {
        id: 'doc123',
        content: 'Hello World',
        version: 10,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 5 // Outdated version
      };

      const result = await operationBroadcaster.validateOperation('doc123', operation);

      expect(result.isValid).toBe(false);
      expect(result.error).toBe('Operation version is outdated');
    });

    test('should transform operation against conflicting operations', async () => {
      const conflictingOp: Operation = {
        type: 'insert',
        position: 3,
        content: 'X',
        userId: 'user456',
        timestamp: new Date(Date.now() - 1000), // Earlier timestamp
        version: 6
      };

      const mockDocument: Document = {
        id: 'doc123',
        content: 'Hello World',
        version: 6,
        operations: [conflictingOp],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 7
      };

      const result = await operationBroadcaster.validateOperation('doc123', operation);

      expect(result.isValid).toBe(true);
      expect(result.transformedOperation).toBeDefined();
      // The position should be adjusted due to the conflicting insert at position 3
      expect(result.transformedOperation!.position).toBeGreaterThanOrEqual(5);
    });
  });

  describe('Operation Broadcasting', () => {
    test('should broadcast valid operation', async () => {
      const mockDocument: Document = {
        id: 'doc123',
        content: 'Hello World',
        version: 5,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const updatedDocument: Document = {
        ...mockDocument,
        content: 'Hello, Beautiful World',
        version: 6
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.applyOperation.mockResolvedValue(updatedDocument);

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 6
      };

      const mockEmit = jest.fn();
      const mockExcept = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockToResult = { except: mockExcept };
      jest.spyOn(io, 'to').mockReturnValue(mockToResult as any);

      await operationBroadcaster.broadcastOperation('doc123', operation, {
        excludeSocket: 'socket123'
      });

      expect(mockDocumentManager.applyOperation).toHaveBeenCalledWith('doc123', operation);
      expect(io.to).toHaveBeenCalledWith('doc123');
      expect(mockExcept).toHaveBeenCalledWith('socket123');
      expect(mockEmit).toHaveBeenCalledWith('operation', expect.objectContaining({
        type: 'operation',
        payload: expect.objectContaining({
          operation,
          documentId: 'doc123'
        })
      }));
    });

    test('should not broadcast invalid operation', async () => {
      mockDocumentManager.getDocument.mockResolvedValue(null);

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 6
      };

      const mockEmit = jest.fn();
      jest.spyOn(io, 'to').mockReturnValue({ emit: mockEmit } as any);

      await operationBroadcaster.broadcastOperation('doc123', operation);

      expect(mockDocumentManager.applyOperation).not.toHaveBeenCalled();
      expect(io.to).not.toHaveBeenCalled();
    });
  });

  describe('Presence Broadcasting', () => {
    test('should broadcast presence update', async () => {
      const collaborator: Collaborator = {
        id: 'user123',
        name: 'John Doe',
        cursor: 10,
        selection: { start: 5, end: 15 },
        isActive: true,
        lastSeen: new Date()
      };

      mockDocumentManager.updateCollaboratorPresence.mockResolvedValue({} as any);

      const mockEmit = jest.fn();
      const mockExcept = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockToResult = { except: mockExcept };
      jest.spyOn(io, 'to').mockReturnValue(mockToResult as any);

      await operationBroadcaster.broadcastPresence('doc123', collaborator, 'socket123');

      expect(mockDocumentManager.updateCollaboratorPresence).toHaveBeenCalledWith(
        'doc123',
        'user123',
        10,
        { start: 5, end: 15 }
      );
      expect(io.to).toHaveBeenCalledWith('doc123');
      expect(mockExcept).toHaveBeenCalledWith('socket123');
      expect(mockEmit).toHaveBeenCalledWith('presence', expect.objectContaining({
        type: 'presence',
        payload: expect.objectContaining({
          collaborator: expect.objectContaining({
            id: 'user123',
            cursor: 10,
            selection: { start: 5, end: 15 }
          }),
          documentId: 'doc123'
        })
      }));
    });
  });

  describe('User Events Broadcasting', () => {
    test('should broadcast user joined event', async () => {
      const collaborator: Collaborator = {
        id: 'user123',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      const mockEmit = jest.fn();
      const mockExcept = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockToResult = { except: mockExcept };
      jest.spyOn(io, 'to').mockReturnValue(mockToResult as any);

      await operationBroadcaster.broadcastUserJoined('doc123', collaborator, 'socket123');

      expect(io.to).toHaveBeenCalledWith('doc123');
      expect(mockExcept).toHaveBeenCalledWith('socket123');
      expect(mockEmit).toHaveBeenCalledWith('user_joined', expect.objectContaining({
        type: 'user_joined',
        payload: expect.objectContaining({
          collaborator,
          documentId: 'doc123'
        })
      }));
    });

    test('should broadcast user left event', async () => {
      const mockEmit = jest.fn();
      const mockExcept = jest.fn().mockReturnValue({ emit: mockEmit });
      const mockToResult = { except: mockExcept };
      jest.spyOn(io, 'to').mockReturnValue(mockToResult as any);

      await operationBroadcaster.broadcastUserLeft('doc123', 'user123', 'socket123');

      expect(io.to).toHaveBeenCalledWith('doc123');
      expect(mockExcept).toHaveBeenCalledWith('socket123');
      expect(mockEmit).toHaveBeenCalledWith('user_left', expect.objectContaining({
        type: 'user_left',
        payload: expect.objectContaining({
          userId: 'user123',
          documentId: 'doc123'
        })
      }));
    });
  });

  describe('Concurrent Operations Handling', () => {
    test('should handle concurrent operations', async () => {
      const mockDocument: Document = {
        id: 'doc123',
        content: 'Hello World',
        version: 5,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.applyOperation.mockResolvedValue({
        ...mockDocument,
        version: 6
      });

      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 6
      };

      const result = await operationBroadcaster.handleConcurrentOperation('doc123', operation);

      expect(result).toBe(true);
      expect(mockDocumentManager.applyOperation).toHaveBeenCalled();
    });

    test('should queue multiple operations for same document', async () => {
      const mockDocument: Document = {
        id: 'doc123',
        content: 'Hello World',
        version: 5,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.applyOperation.mockResolvedValue({
        ...mockDocument,
        version: 6
      });

      const operation1: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 6
      };

      const operation2: Operation = {
        type: 'insert',
        position: 18,
        content: ' World',
        userId: 'user456',
        timestamp: new Date(),
        version: 7
      };

      // Handle both operations concurrently
      const [result1, result2] = await Promise.all([
        operationBroadcaster.handleConcurrentOperation('doc123', operation1),
        operationBroadcaster.handleConcurrentOperation('doc123', operation2)
      ]);

      expect(result1).toBe(true);
      expect(result2).toBe(true);
      expect(mockDocumentManager.applyOperation).toHaveBeenCalledTimes(2);
    });
  });

  describe('Utility Methods', () => {
    test('should get pending operations stats', () => {
      const stats = operationBroadcaster.getPendingOperationsStats();
      expect(typeof stats).toBe('object');
    });

    test('should clear pending operations for document', () => {
      operationBroadcaster.clearPendingOperations('doc123');
      const stats = operationBroadcaster.getPendingOperationsStats();
      expect(stats['doc123']).toBeUndefined();
    });
  });
});