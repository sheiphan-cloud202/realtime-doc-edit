import { DocumentManager } from '../DocumentManager';
import { Document, Operation, Collaborator } from '../../../../shared/types';
import { createClient } from 'redis';

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    setEx: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    keys: jest.fn()
  }))
}));

describe('DocumentManager', () => {
  let documentManager: DocumentManager;
  let mockRedisClient: any;

  beforeEach(async () => {
    mockRedisClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      setEx: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      keys: jest.fn()
    };
    
    (createClient as jest.Mock).mockReturnValue(mockRedisClient);
    
    documentManager = new DocumentManager({
      redisUrl: 'redis://localhost:6379',
      maxOperationHistory: 100
    });
    
    await documentManager.initialize();
  });

  afterEach(async () => {
    await documentManager.disconnect();
    jest.clearAllMocks();
  });

  describe('Document CRUD Operations', () => {
    test('should create a new document', async () => {
      const content = 'Hello, World!';
      const userId = 'user123';

      const document = await documentManager.createDocument(content, userId);

      expect(document).toBeDefined();
      expect(document.id).toBeDefined();
      expect(document.content).toBe(content);
      expect(document.version).toBe(0);
      expect(document.operations).toEqual([]);
      expect(document.collaborators).toEqual([]);
      expect(document.createdAt).toBeInstanceOf(Date);
      expect(document.updatedAt).toBeInstanceOf(Date);
      expect(mockRedisClient.setEx).toHaveBeenCalled();
    });

    test('should create document with empty content by default', async () => {
      const userId = 'user123';

      const document = await documentManager.createDocument(undefined, userId);

      expect(document.content).toBe('');
    });

    test('should get existing document', async () => {
      const content = 'Test content';
      const userId = 'user123';
      const document = await documentManager.createDocument(content, userId);

      const retrievedDocument = await documentManager.getDocument(document.id);

      expect(retrievedDocument).toEqual(document);
    });

    test('should return null for non-existent document', async () => {
      const result = await documentManager.getDocument('non-existent-id');

      expect(result).toBeNull();
    });

    test('should update document content', async () => {
      const document = await documentManager.createDocument('Original content', 'user123');
      const newContent = 'Updated content';

      // Add small delay to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 1));

      const updatedDocument = await documentManager.updateDocument(document.id, newContent);

      expect(updatedDocument).toBeDefined();
      expect(updatedDocument!.content).toBe(newContent);
      expect(updatedDocument!.version).toBe(1);
      expect(updatedDocument!.updatedAt.getTime()).toBeGreaterThanOrEqual(document.updatedAt.getTime());
    });

    test('should return null when updating non-existent document', async () => {
      const result = await documentManager.updateDocument('non-existent-id', 'content');

      expect(result).toBeNull();
    });

    test('should delete document', async () => {
      const document = await documentManager.createDocument('Test content', 'user123');

      const result = await documentManager.deleteDocument(document.id);

      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith(`document:${document.id}`);

      // Verify document is no longer accessible
      const retrievedDocument = await documentManager.getDocument(document.id);
      expect(retrievedDocument).toBeNull();
    });
  });

  describe('Operation Management', () => {
    test('should apply insert operation', async () => {
      const document = await documentManager.createDocument('Hello World', 'user123');
      const operation: Operation = {
        type: 'insert',
        position: 5,
        content: ', Beautiful',
        userId: 'user123',
        timestamp: new Date(),
        version: 1
      };

      const updatedDocument = await documentManager.applyOperation(document.id, operation);

      expect(updatedDocument).toBeDefined();
      expect(updatedDocument!.content).toBe('Hello, Beautiful World');
      expect(updatedDocument!.version).toBe(1);
      expect(updatedDocument!.operations).toHaveLength(1);
      expect(updatedDocument!.operations[0]).toEqual(operation);
    });

    test('should apply delete operation', async () => {
      const document = await documentManager.createDocument('Hello, World!', 'user123');
      const operation: Operation = {
        type: 'delete',
        position: 5,
        length: 2,
        userId: 'user123',
        timestamp: new Date(),
        version: 1
      };

      const updatedDocument = await documentManager.applyOperation(document.id, operation);

      expect(updatedDocument).toBeDefined();
      expect(updatedDocument!.content).toBe('HelloWorld!');
      expect(updatedDocument!.version).toBe(1);
      expect(updatedDocument!.operations).toHaveLength(1);
    });

    test('should return null when applying operation to non-existent document', async () => {
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'test',
        userId: 'user123',
        timestamp: new Date(),
        version: 1
      };

      const result = await documentManager.applyOperation('non-existent-id', operation);

      expect(result).toBeNull();
    });

    test('should get operation history', async () => {
      const document = await documentManager.createDocument('Test', 'user123');
      const operation1: Operation = {
        type: 'insert',
        position: 4,
        content: ' content',
        userId: 'user123',
        timestamp: new Date(),
        version: 1
      };
      const operation2: Operation = {
        type: 'insert',
        position: 12,
        content: '!',
        userId: 'user123',
        timestamp: new Date(),
        version: 2
      };

      await documentManager.applyOperation(document.id, operation1);
      await documentManager.applyOperation(document.id, operation2);

      const history = await documentManager.getOperationHistory(document.id);

      expect(history).toHaveLength(2);
      expect(history[0]).toEqual(operation1);
      expect(history[1]).toEqual(operation2);
    });

    test('should get operation history from specific version', async () => {
      const document = await documentManager.createDocument('Test', 'user123');
      const operation1: Operation = {
        type: 'insert',
        position: 4,
        content: ' content',
        userId: 'user123',
        timestamp: new Date(),
        version: 1
      };
      const operation2: Operation = {
        type: 'insert',
        position: 12,
        content: '!',
        userId: 'user123',
        timestamp: new Date(),
        version: 2
      };

      await documentManager.applyOperation(document.id, operation1);
      await documentManager.applyOperation(document.id, operation2);

      const history = await documentManager.getOperationHistory(document.id, 2);

      expect(history).toHaveLength(1);
      expect(history[0]).toEqual(operation2);
    });

    test('should trim operation history when exceeding max length', async () => {
      const documentManager = new DocumentManager({ maxOperationHistory: 2 });
      await documentManager.initialize();

      const document = await documentManager.createDocument('Test', 'user123');
      
      // Add 3 operations (exceeds max of 2)
      for (let i = 1; i <= 3; i++) {
        const operation: Operation = {
          type: 'insert',
          position: 4,
          content: `${i}`,
          userId: 'user123',
          timestamp: new Date(),
          version: i
        };
        await documentManager.applyOperation(document.id, operation);
      }

      const history = await documentManager.getOperationHistory(document.id);

      expect(history).toHaveLength(2);
      expect(history[0].version).toBe(2);
      expect(history[1].version).toBe(3);

      await documentManager.disconnect();
    });
  });

  describe('Collaborator Management', () => {
    test('should add collaborator to document', async () => {
      const document = await documentManager.createDocument('Test content', 'user123');
      const collaborator: Collaborator = {
        id: 'user456',
        name: 'John Doe',
        avatar: 'avatar.jpg',
        cursor: 0,
        selection: { start: 0, end: 4 },
        isActive: true,
        lastSeen: new Date()
      };

      const updatedDocument = await documentManager.addCollaborator(document.id, collaborator);

      expect(updatedDocument).toBeDefined();
      expect(updatedDocument!.collaborators).toHaveLength(1);
      expect(updatedDocument!.collaborators[0]).toEqual(collaborator);
    });

    test('should replace existing collaborator with same ID', async () => {
      const document = await documentManager.createDocument('Test content', 'user123');
      const collaborator1: Collaborator = {
        id: 'user456',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };
      const collaborator2: Collaborator = {
        id: 'user456',
        name: 'John Smith',
        cursor: 5,
        isActive: true,
        lastSeen: new Date()
      };

      await documentManager.addCollaborator(document.id, collaborator1);
      const updatedDocument = await documentManager.addCollaborator(document.id, collaborator2);

      expect(updatedDocument!.collaborators).toHaveLength(1);
      expect(updatedDocument!.collaborators[0].name).toBe('John Smith');
      expect(updatedDocument!.collaborators[0].cursor).toBe(5);
    });

    test('should remove collaborator from document', async () => {
      const document = await documentManager.createDocument('Test content', 'user123');
      const collaborator: Collaborator = {
        id: 'user456',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      await documentManager.addCollaborator(document.id, collaborator);
      const updatedDocument = await documentManager.removeCollaborator(document.id, 'user456');

      expect(updatedDocument).toBeDefined();
      expect(updatedDocument!.collaborators).toHaveLength(0);
    });

    test('should update collaborator presence', async () => {
      const document = await documentManager.createDocument('Test content', 'user123');
      const collaborator: Collaborator = {
        id: 'user456',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      await documentManager.addCollaborator(document.id, collaborator);
      
      const newCursor = 10;
      const newSelection = { start: 5, end: 15 };
      const updatedDocument = await documentManager.updateCollaboratorPresence(
        document.id, 
        'user456', 
        newCursor, 
        newSelection
      );

      expect(updatedDocument).toBeDefined();
      const updatedCollaborator = updatedDocument!.collaborators[0];
      expect(updatedCollaborator.cursor).toBe(newCursor);
      expect(updatedCollaborator.selection).toEqual(newSelection);
      expect(updatedCollaborator.isActive).toBe(true);
    });

    test('should return null when updating presence for non-existent collaborator', async () => {
      const document = await documentManager.createDocument('Test content', 'user123');

      const result = await documentManager.updateCollaboratorPresence(
        document.id, 
        'non-existent-user', 
        10
      );

      expect(result).toBeNull();
    });
  });

  describe('Redis Caching', () => {
    test('should retrieve document from Redis cache when not in memory', async () => {
      const documentData = {
        id: 'test-doc-id',
        content: 'Cached content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(documentData));

      const document = await documentManager.getDocument('test-doc-id');

      expect(document).toBeDefined();
      expect(document!.content).toBe('Cached content');
      expect(document!.createdAt).toBeInstanceOf(Date);
      expect(document!.updatedAt).toBeInstanceOf(Date);
      expect(mockRedisClient.get).toHaveBeenCalledWith('document:test-doc-id');
    });

    test('should handle Redis cache miss gracefully', async () => {
      mockRedisClient.get.mockResolvedValue(null);

      const document = await documentManager.getDocument('non-existent-id');

      expect(document).toBeNull();
      expect(mockRedisClient.get).toHaveBeenCalledWith('document:non-existent-id');
    });

    test('should handle Redis parsing errors gracefully', async () => {
      mockRedisClient.get.mockResolvedValue('invalid-json');

      const document = await documentManager.getDocument('test-doc-id');

      expect(document).toBeNull();
    });

    test('should list all documents', async () => {
      mockRedisClient.keys.mockResolvedValue([
        'document:doc1',
        'document:doc2',
        'document:doc3'
      ]);

      const documentIds = await documentManager.listDocuments();

      expect(documentIds).toEqual(['doc1', 'doc2', 'doc3']);
      expect(mockRedisClient.keys).toHaveBeenCalledWith('document:*');
    });
  });

  describe('Error Handling', () => {
    test('should handle unknown operation type', async () => {
      const document = await documentManager.createDocument('Test', 'user123');
      const invalidOperation = {
        type: 'unknown' as any,
        position: 0,
        userId: 'user123',
        timestamp: new Date(),
        version: 1
      };

      await expect(
        documentManager.applyOperation(document.id, invalidOperation)
      ).rejects.toThrow('Unknown operation type: unknown');
    });
  });
});