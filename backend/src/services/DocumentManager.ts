import { createClient, RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { Document, Operation, Collaborator } from '../../../shared/types';
import { OTOperation, InsertOperation, DeleteOperation, RetainOperation } from '../../../shared/ot/operations';

export interface DocumentManagerConfig {
  redisUrl?: string;
  maxOperationHistory?: number;
}

export class DocumentManager {
  private redisClient: RedisClientType;
  private maxOperationHistory: number;
  private documents: Map<string, Document> = new Map();

  constructor(config: DocumentManagerConfig = {}) {
    this.redisClient = createClient({
      url: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });
    this.maxOperationHistory = config.maxOperationHistory || 1000;
  }

  async initialize(): Promise<void> {
    await this.redisClient.connect();
  }

  async disconnect(): Promise<void> {
    await this.redisClient.disconnect();
  }

  /**
   * Create a new document
   */
  async createDocument(content: string = '', userId: string): Promise<Document> {
    const document: Document = {
      id: uuidv4(),
      content,
      version: 0,
      operations: [],
      collaborators: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store in memory cache
    this.documents.set(document.id, document);

    // Store in Redis
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Create a new document with a specific ID
   */
  async createDocumentWithId(documentId: string, content: string = '', userId: string): Promise<Document> {
    const document: Document = {
      id: documentId,
      content,
      version: 0,
      operations: [],
      collaborators: [],
      createdAt: new Date(),
      updatedAt: new Date()
    };

    // Store in memory cache
    this.documents.set(document.id, document);

    // Store in Redis
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Get document by ID
   */
  async getDocument(documentId: string): Promise<Document | null> {
    // Try memory cache first
    let document = this.documents.get(documentId);

    if (!document) {
      // Try Redis cache
      const cachedDocument = await this.getCachedDocument(documentId);
      if (cachedDocument) {
        document = cachedDocument;
        this.documents.set(documentId, document);
      }
    }

    return document || null;
  }

  /**
   * Update document content and increment version
   */
  async updateDocument(documentId: string, content: string): Promise<Document | null> {
    const document = await this.getDocument(documentId);
    if (!document) {
      return null;
    }

    document.content = content;
    document.version += 1;
    document.updatedAt = new Date();

    // Update caches
    this.documents.set(documentId, document);
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Apply an operation to a document
   */
  async applyOperation(documentId: string, operation: Operation): Promise<Document | null> {
    const document = await this.getDocument(documentId);
    if (!document) {
      return null;
    }

    // Convert to OT operation and apply
    let newContent = document.content;

    // Support replacement semantics for insert operations with a non-zero length
    // by deleting the specified range before inserting the new content. This
    // ensures AI-driven replacements and editor replaces do not accumulate
    // previous text fragments over time.
    if (operation.type === 'insert' && (operation.length || 0) > 0) {
      const deleteLen = operation.length || 0;
      const pos = Math.max(0, Math.min(operation.position, newContent.length));
      const before = newContent.slice(0, pos);
      const after = newContent.slice(pos + deleteLen);
      newContent = before + (operation.content || '') + after;
    } else {
      const otOperation = this.convertToOTOperation(operation);
      const result = otOperation.apply(newContent, operation.position);
      newContent = result.result;
    }

    // Update document
    document.content = newContent;
    document.version += 1;
    document.updatedAt = new Date();

    // Adjust collaborator cursors and selections server-side to keep canonical
    // presence data consistent with the new content length.
    this.adjustCollaboratorsAfterOperation(document, operation);

    // Add to operation history
    document.operations.push(operation);

    // Trim operation history if it exceeds max length
    if (document.operations.length > this.maxOperationHistory) {
      document.operations = document.operations.slice(-this.maxOperationHistory);
    }

    // Update caches
    this.documents.set(documentId, document);
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Get operation history for a document
   */
  async getOperationHistory(documentId: string, fromVersion?: number): Promise<Operation[]> {
    const document = await this.getDocument(documentId);
    if (!document) {
      return [];
    }

    if (fromVersion !== undefined) {
      return document.operations.filter(op => op.version >= fromVersion);
    }

    return document.operations;
  }

  /**
   * Add collaborator to document
   */
  async addCollaborator(documentId: string, collaborator: Collaborator): Promise<Document | null> {
    const document = await this.getDocument(documentId);
    if (!document) {
      return null;
    }

    // Remove existing collaborator with same ID
    document.collaborators = document.collaborators.filter(c => c.id !== collaborator.id);

    // Add new collaborator
    document.collaborators.push(collaborator);
    document.updatedAt = new Date();

    // Update caches
    this.documents.set(documentId, document);
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Remove collaborator from document
   */
  async removeCollaborator(documentId: string, collaboratorId: string): Promise<Document | null> {
    const document = await this.getDocument(documentId);
    if (!document) {
      return null;
    }

    document.collaborators = document.collaborators.filter(c => c.id !== collaboratorId);
    document.updatedAt = new Date();

    // Update caches
    this.documents.set(documentId, document);
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Update collaborator presence (cursor, selection)
   */
  async updateCollaboratorPresence(
    documentId: string,
    collaboratorId: string,
    cursor: number,
    selection?: { start: number; end: number }
  ): Promise<Document | null> {
    const document = await this.getDocument(documentId);
    if (!document) {
      return null;
    }

    const collaborator = document.collaborators.find(c => c.id === collaboratorId);
    if (!collaborator) {
      return null;
    }

    collaborator.cursor = cursor;
    collaborator.selection = selection;
    collaborator.lastSeen = new Date();
    collaborator.isActive = true;

    // Update caches
    this.documents.set(documentId, document);
    await this.cacheDocument(document);

    return document;
  }

  /**
   * Delete a document
   */
  async deleteDocument(documentId: string): Promise<boolean> {
    // Remove from memory cache
    this.documents.delete(documentId);

    // Remove from Redis
    await this.redisClient.del(`document:${documentId}`);

    return true;
  }

  /**
   * List all document IDs (for debugging/admin purposes)
   */
  async listDocuments(): Promise<string[]> {
    const keys = await this.redisClient.keys('document:*');
    return keys.map(key => key.replace('document:', ''));
  }

  /**
   * Cache document in Redis
   */
  private async cacheDocument(document: Document): Promise<void> {
    const key = `document:${document.id}`;
    const value = JSON.stringify(document);
    await this.redisClient.setEx(key, 3600, value); // 1 hour TTL
  }

  /**
   * Get cached document from Redis
   */
  private async getCachedDocument(documentId: string): Promise<Document | null> {
    const key = `document:${documentId}`;
    const value = await this.redisClient.get(key);

    if (!value) {
      return null;
    }

    try {
      const document = JSON.parse(value);
      // Convert date strings back to Date objects
      document.createdAt = new Date(document.createdAt);
      document.updatedAt = new Date(document.updatedAt);
      document.operations.forEach((op: Operation) => {
        op.timestamp = new Date(op.timestamp);
      });
      document.collaborators.forEach((collab: Collaborator) => {
        collab.lastSeen = new Date(collab.lastSeen);
      });

      return document;
    } catch (error) {
      console.error('Error parsing cached document:', error);
      return null;
    }
  }

  /**
   * Convert Operation interface to OTOperation class
   */
  private convertToOTOperation(operation: Operation): OTOperation {
    switch (operation.type) {
      case 'insert':
        return new InsertOperation(operation.content || '');
      case 'delete':
        return new DeleteOperation(operation.length || 0);
      case 'retain':
        return new RetainOperation(operation.length || 0);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  /**
   * Shift collaborator cursors/selections after an operation so presence stays
   * aligned with the updated content on the server.
   */
  private adjustCollaboratorsAfterOperation(doc: Document, operation: Operation): void {
    const delta = operation.type === 'insert'
      ? (operation.content?.length || 0)
      : operation.type === 'delete'
        ? -(operation.length || 0)
        : 0;

    if (delta === 0) return;

    const position = operation.position;
    const actorId = operation.userId;

    doc.collaborators = doc.collaborators.map(collab => {
      if (collab.id === actorId) {
        // The actor's editor knows its own caret; keep as-is
        return collab;
      }

      const updated: Collaborator = { ...collab } as any;
      if (updated.cursor >= position) {
        updated.cursor = Math.max(0, updated.cursor + delta);
      }
      if (updated.selection) {
        const start = updated.selection.start;
        const end = updated.selection.end;
        const newStart = start >= position ? Math.max(0, start + delta) : start;
        const newEnd = end >= position ? Math.max(0, end + delta) : end;
        updated.selection = { start: newStart, end: newEnd } as any;
      }
      return updated;
    });
  }
}