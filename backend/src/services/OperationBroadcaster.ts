import { Server as SocketIOServer } from 'socket.io';
import { DocumentManager } from './DocumentManager';
import { Operation, Collaborator } from '../../../shared/types';
import { OTOperation, InsertOperation, DeleteOperation, RetainOperation } from '../../../shared/ot/operations';
import { transform } from '../../../shared/ot/transform';

export interface OperationValidationResult {
  isValid: boolean;
  transformedOperation?: Operation;
  error?: string;
}

export interface BroadcastOptions {
  excludeSocket?: string;
  includeAck?: boolean;
}

export class OperationBroadcaster {
  private io: SocketIOServer;
  private documentManager: DocumentManager;
  private pendingOperations: Map<string, Operation[]> = new Map();

  constructor(io: SocketIOServer, documentManager: DocumentManager) {
    this.io = io;
    this.documentManager = documentManager;
  }

  /**
   * Validate and transform an operation against the current document state
   */
  async validateOperation(documentId: string, operation: Operation): Promise<OperationValidationResult> {
    try {
      const document = await this.documentManager.getDocument(documentId);
      if (!document) {
        return {
          isValid: false,
          error: 'Document not found'
        };
      }

      // Accept operations that are exactly the next version
      if (operation.version < document.version + 1) {
        return {
          isValid: false,
          error: 'Operation version is outdated'
        };
      }

      // Get operations that happened after this operation's base version
      const conflictingOperations = document.operations.filter(
        op => op.version >= (operation.version - 1)
      );

      let transformedOperation = operation;

      // Transform against conflicting operations
      for (const conflictOp of conflictingOperations) {
        const result = this.transformOperations(transformedOperation, conflictOp);
        transformedOperation = result.transformedOp1;
      }

      return {
        isValid: true,
        transformedOperation
      };
    } catch (error) {
      return {
        isValid: false,
        error: `Validation failed: ${error}`
      };
    }
  }

  /**
   * Transform two operations using operational transformation
   */
  private transformOperations(op1: Operation, op2: Operation): { transformedOp1: Operation; transformedOp2: Operation } {
    try {
      const otOp1 = this.convertToOTOperation(op1);
      const otOp2 = this.convertToOTOperation(op2);

      // Use priority based on timestamp (earlier operations have priority)
      const getTs = (op: Operation): number => {
        const t: any = (op as any).timestamp;
        if (t instanceof Date) return t.getTime();
        const ms = new Date(t).getTime();
        return isNaN(ms) ? 0 : ms;
      };
      const priority = getTs(op1) < getTs(op2);
      
      const [transformedOT1, transformedOT2] = transform(otOp1, otOp2, priority);

      return {
        transformedOp1: this.convertFromOTOperation(transformedOT1, op1),
        transformedOp2: this.convertFromOTOperation(transformedOT2, op2)
      };
    } catch (error) {
      console.error('Error transforming operations:', error);
      // Fallback: return original operations
      return {
        transformedOp1: op1,
        transformedOp2: op2
      };
    }
  }

  /**
   * Broadcast operation to all clients in a document room
   */
  async broadcastOperation(
    documentId: string, 
    operation: Operation, 
    options: BroadcastOptions = {}
  ): Promise<void> {
    try {
      // Validate and transform the operation
      const validation = await this.validateOperation(documentId, operation);
      
      if (!validation.isValid) {
        console.error(`Operation validation failed: ${validation.error}`);
        return;
      }

      const finalOperation = validation.transformedOperation || operation;

      // Apply the operation to the document
      const updatedDocument = await this.documentManager.applyOperation(documentId, finalOperation);
      if (!updatedDocument) {
        console.error('Failed to apply operation to document');
        return;
      }

      // Broadcast to all clients in the room except the sender
      const broadcastData = {
        type: 'operation',
        payload: {
          operation: finalOperation,
          documentId
        },
        timestamp: new Date()
      };

      // Send the final operation to ALL clients including the sender so everyone reconciles with the same op
      this.io.to(documentId).emit('operation', broadcastData);

      // Send acknowledgment if requested
      if (options.includeAck && options.excludeSocket) {
        this.io.to(options.excludeSocket).emit('operation_ack', {
          operationId: finalOperation.version,
          timestamp: new Date()
        });
      }

      console.log(`Operation broadcasted for document ${documentId}, version ${finalOperation.version}`);
    } catch (error) {
      console.error('Error broadcasting operation:', error);
    }
  }

  /**
   * Broadcast presence update to all clients in a document room
   */
  async broadcastPresence(
    documentId: string,
    collaborator: Collaborator,
    excludeSocket?: string
  ): Promise<void> {
    try {
      // Update presence in document
      await this.documentManager.updateCollaboratorPresence(
        documentId,
        collaborator.id,
        collaborator.cursor,
        collaborator.selection
      );

      // Broadcast presence update
      const presenceData = {
        type: 'presence',
        payload: {
          collaborator: {
            id: collaborator.id,
            name: collaborator.name,
            avatar: collaborator.avatar,
            cursor: collaborator.cursor,
            selection: collaborator.selection,
            isActive: collaborator.isActive
          },
          documentId
        },
        timestamp: new Date()
      };

      if (excludeSocket) {
        this.io.to(documentId).except(excludeSocket).emit('presence', presenceData);
      } else {
        this.io.to(documentId).emit('presence', presenceData);
      }

      console.log(`Presence updated for user ${collaborator.id} in document ${documentId}`);
    } catch (error) {
      console.error('Error broadcasting presence:', error);
    }
  }

  /**
   * Broadcast user join event
   */
  async broadcastUserJoined(
    documentId: string,
    collaborator: Collaborator,
    excludeSocket?: string
  ): Promise<void> {
    try {
      const joinData = {
        type: 'user_joined',
        payload: {
          collaborator,
          documentId
        },
        timestamp: new Date()
      };

      if (excludeSocket) {
        this.io.to(documentId).except(excludeSocket).emit('user_joined', joinData);
      } else {
        this.io.to(documentId).emit('user_joined', joinData);
      }

      console.log(`User joined broadcast for ${collaborator.name} in document ${documentId}`);
    } catch (error) {
      console.error('Error broadcasting user joined:', error);
    }
  }

  /**
   * Broadcast user leave event
   */
  async broadcastUserLeft(
    documentId: string,
    userId: string,
    excludeSocket?: string
  ): Promise<void> {
    try {
      const leaveData = {
        type: 'user_left',
        payload: {
          userId,
          documentId
        },
        timestamp: new Date()
      };

      if (excludeSocket) {
        this.io.to(documentId).except(excludeSocket).emit('user_left', leaveData);
      } else {
        this.io.to(documentId).emit('user_left', leaveData);
      }

      console.log(`User left broadcast for ${userId} in document ${documentId}`);
    } catch (error) {
      console.error('Error broadcasting user left:', error);
    }
  }

  /**
   * Handle concurrent operations by queuing and processing them sequentially
   */
  async handleConcurrentOperation(documentId: string, operation: Operation): Promise<boolean> {
    try {
      // Get or create pending operations queue for this document
      if (!this.pendingOperations.has(documentId)) {
        this.pendingOperations.set(documentId, []);
      }

      const queue = this.pendingOperations.get(documentId)!;
      queue.push(operation);

      // Process the queue
      await this.processPendingOperations(documentId);

      return true;
    } catch (error) {
      console.error('Error handling concurrent operation:', error);
      return false;
    }
  }

  /**
   * Process pending operations for a document sequentially
   */
  private async processPendingOperations(documentId: string): Promise<void> {
    const queue = this.pendingOperations.get(documentId);
    if (!queue || queue.length === 0) {
      return;
    }

    // Process operations one by one
    while (queue.length > 0) {
      const operation = queue.shift()!;
      
      try {
        await this.broadcastOperation(documentId, operation, {
          excludeSocket: operation.userId // Exclude the sender
        });
      } catch (error) {
        console.error('Error processing pending operation:', error);
      }
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
   * Convert OTOperation class back to Operation interface
   */
  private convertFromOTOperation(otOperation: OTOperation, originalOperation: Operation): Operation {
    const baseOperation: Operation = {
      ...originalOperation,
      type: otOperation.type,
      timestamp: new Date()
    };

    if (otOperation instanceof InsertOperation) {
      return {
        ...baseOperation,
        content: otOperation.content,
        length: otOperation.length
      };
    } else if (otOperation instanceof DeleteOperation || otOperation instanceof RetainOperation) {
      return {
        ...baseOperation,
        length: otOperation.length
      };
    }

    return baseOperation;
  }

  /**
   * Get statistics about pending operations
   */
  getPendingOperationsStats(): { [documentId: string]: number } {
    const stats: { [documentId: string]: number } = {};
    
    this.pendingOperations.forEach((queue, documentId) => {
      stats[documentId] = queue.length;
    });

    return stats;
  }

  /**
   * Clear pending operations for a document (useful for cleanup)
   */
  clearPendingOperations(documentId: string): void {
    this.pendingOperations.delete(documentId);
  }

  /**
   * Generic method to broadcast any message to all clients in a document room
   */
  async broadcastToDocument(documentId: string, eventName: string, data: any, options: BroadcastOptions = {}): Promise<void> {
    try {
      const { excludeSocket } = options;

      if (excludeSocket) {
        this.io.to(documentId).except(excludeSocket).emit(eventName, data);
      } else {
        this.io.to(documentId).emit(eventName, data);
      }

      console.log(`Broadcasted ${eventName} to document ${documentId}`);
    } catch (error) {
      console.error(`Error broadcasting ${eventName} to document ${documentId}:`, error);
    }
  }
}