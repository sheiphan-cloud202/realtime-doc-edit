import { Server as SocketIOServer, Socket } from 'socket.io';
import { DocumentManager } from './DocumentManager';
import { OperationBroadcaster } from './OperationBroadcaster';
import { UserSessionManager } from './UserSessionManager';
import { AIIntegrationService } from './AIIntegrationService';
import { 
  Operation, 
  Collaborator, 
  OperationMessage, 
  PresenceMessage, 
  AIRequestMessage,
  UserJoinedMessage,
  UserLeftMessage,
  WebSocketMessage 
} from '../../../shared/types';

export interface AuthenticatedSocket extends Socket {
  userId?: string;
  userName?: string;
  documentId?: string;
}

export interface JoinDocumentPayload {
  documentId: string;
  userId: string;
  userName: string;
  avatar?: string;
}

export interface LeaveDocumentPayload {
  documentId: string;
  userId: string;
}

export class WebSocketHandler {
  private io: SocketIOServer;
  private documentManager: DocumentManager;
  private operationBroadcaster: OperationBroadcaster;
  private userSessionManager: UserSessionManager;
  private aiIntegrationService?: AIIntegrationService;
  private connectedUsers: Map<string, AuthenticatedSocket> = new Map();

  constructor(io: SocketIOServer, documentManager: DocumentManager, userSessionManager: UserSessionManager, aiIntegrationService?: AIIntegrationService) {
    this.io = io;
    this.documentManager = documentManager;
    this.userSessionManager = userSessionManager;
    this.aiIntegrationService = aiIntegrationService;
    this.operationBroadcaster = new OperationBroadcaster(io, documentManager);
  }

  async initialize(): Promise<void> {
    this.io.on('connection', (socket: AuthenticatedSocket) => {
      console.log(`Client connected: ${socket.id}`);

      // Handle user authentication and document joining
      socket.on('join_document', async (payload: JoinDocumentPayload) => {
        await this.handleJoinDocument(socket, payload);
      });

      // Handle leaving document
      socket.on('leave_document', async (payload: LeaveDocumentPayload) => {
        await this.handleLeaveDocument(socket, payload);
      });

      // Handle document operations (acknowledge receipt to support client retries)
      socket.on('operation', async (message: OperationMessage, ack?: (resp: { success: boolean; error?: string }) => void) => {
        try {
          await this.handleOperation(socket, message);
          if (ack) ack({ success: true });
        } catch (e) {
          if (ack) ack({ success: false, error: (e as Error).message });
        }
      });

      // Handle presence updates (cursor, selection)
      socket.on('presence', async (message: PresenceMessage) => {
        await this.handlePresenceUpdate(socket, message);
      });

      // Handle AI requests (acknowledge immediately so client does not timeout)
      socket.on('ai_request', async (message: AIRequestMessage, ack?: (resp: { success: boolean; error?: string }) => void) => {
        try {
          // Acknowledge receipt right away; processing and final result are delivered via events
          if (ack) ack({ success: true });
          await this.handleAIRequest(socket, message);
        } catch (e) {
          if (ack) ack({ success: false, error: (e as Error).message });
        }
      });

      // Handle disconnection
      socket.on('disconnect', async () => {
        await this.handleDisconnect(socket);
      });
    });
  }

  /**
   * Handle user joining a document
   */
  private async handleJoinDocument(socket: AuthenticatedSocket, payload: JoinDocumentPayload): Promise<void> {
    try {
      const { documentId, userId, userName, avatar } = payload;

      // Validate user authentication
      const isValidUser = await this.userSessionManager.validateUser(userId, userName);
      if (!isValidUser) {
        socket.emit('error', { message: 'Invalid user credentials' });
        return;
      }

      // Create user session
      const session = await this.userSessionManager.createSession(
        userId,
        userName,
        documentId,
        socket.id,
        avatar
      );

      // Set socket properties
      socket.userId = userId;
      socket.userName = userName;
      socket.documentId = documentId;

      // Join the document room
      await socket.join(documentId);

      // Add to connected users map (ensure only one active session per user in this process)
      for (const [sid, s] of this.connectedUsers.entries()) {
        if (s.userId === userId && s.documentId === documentId) {
          try { s.disconnect(true); } catch {}
          this.connectedUsers.delete(sid);
        }
      }
      this.connectedUsers.set(socket.id, socket);

      // Get or create document
      let document = await this.documentManager.getDocument(documentId);
      if (!document) {
        document = await this.documentManager.createDocumentWithId(documentId, '# Welcome to Realtime AI Document Editor\n\nStart typing to begin collaborative editing...', userId);
      }

      // Create collaborator from session
      const collaborator = this.userSessionManager.sessionToCollaborator(session);

      // Add collaborator to document
      await this.documentManager.addCollaborator(documentId, collaborator);

      // Get all active collaborators for the document
      const allCollaborators = await this.userSessionManager.getDocumentCollaborators(documentId);

      // Send current document state to the joining user
      socket.emit('document_state', {
        document: {
          ...document,
          collaborators: allCollaborators
        },
        collaborators: allCollaborators
      });

      // Send user list update to all users in the document (standardized message shape)
      socket.to(documentId).emit('collaborators_updated', {
        type: 'collaborators_updated',
        payload: {
          collaborators: allCollaborators
        },
        timestamp: new Date()
      });

      // Broadcast user joined event with enhanced notification
      const joinMessage: UserJoinedMessage = {
        type: 'user_joined',
        payload: {
          collaborator,
          documentId
        },
        timestamp: new Date()
      };

      socket.to(documentId).emit('user_joined', joinMessage);

      // Send join notification
      socket.to(documentId).emit('notification', {
        type: 'user_joined',
        message: `${userName} joined the document`,
        userId,
        timestamp: new Date()
      });

      console.log(`User ${userName} (${userId}) joined document ${documentId} with session ${session.id}`);
    } catch (error) {
      console.error('Error handling join document:', error);
      socket.emit('error', { message: 'Failed to join document' });
    }
  }

  /**
   * Handle user leaving a document
   */
  private async handleLeaveDocument(socket: AuthenticatedSocket, payload: LeaveDocumentPayload): Promise<void> {
    try {
      const { documentId, userId } = payload;

      // Get user session
      const session = await this.userSessionManager.getSessionBySocketId(socket.id);
      
      // Leave the document room
      await socket.leave(documentId);

      // Remove session
      if (session) {
        await this.userSessionManager.removeSession(session.id);
      }

      // Remove collaborator from document
      await this.documentManager.removeCollaborator(documentId, userId);

      // Get updated collaborators list
      const remainingCollaborators = await this.userSessionManager.getDocumentCollaborators(documentId);

      // Send updated collaborators list to remaining users (standardized message shape)
      socket.to(documentId).emit('collaborators_updated', {
        type: 'collaborators_updated',
        payload: {
          collaborators: remainingCollaborators
        },
        timestamp: new Date()
      });

      // Broadcast user left event
      const leftMessage: UserLeftMessage = {
        type: 'user_left',
        payload: {
          userId,
          documentId
        },
        timestamp: new Date()
      };

      socket.to(documentId).emit('user_left', leftMessage);

      // Send leave notification
      socket.to(documentId).emit('notification', {
        type: 'user_left',
        message: `${socket.userName || 'User'} left the document`,
        userId,
        timestamp: new Date()
      });

      // Clear socket properties
      socket.userId = undefined;
      socket.userName = undefined;
      socket.documentId = undefined;

      console.log(`User ${userId} left document ${documentId}`);
    } catch (error) {
      console.error('Error handling leave document:', error);
      socket.emit('error', { message: 'Failed to leave document' });
    }
  }

  /**
   * Handle document operations (insert, delete, retain)
   */
  private async handleOperation(socket: AuthenticatedSocket, message: OperationMessage): Promise<void> {
    try {
      const { operation, documentId } = message.payload;

      // Validate user is authenticated and in the document
      if (!socket.userId || socket.documentId !== documentId || operation.userId !== socket.userId) {
        socket.emit('error', { message: 'Unauthorized operation' });
        return;
      }

      // Use operation broadcaster for validation, transformation, and broadcasting
      const success = await this.operationBroadcaster.handleConcurrentOperation(documentId, operation);
      
      if (!success) {
        socket.emit('error', { message: 'Failed to process operation' });
        return;
      }

      // Send acknowledgment to the sender
      socket.emit('operation_ack', {
        operationId: operation.version,
        timestamp: new Date()
      });

      console.log(`Operation processed by ${socket.userId} in document ${documentId}`);
    } catch (error) {
      console.error('Error handling operation:', error);
      socket.emit('error', { message: 'Failed to process operation' });
    }
  }

  /**
   * Handle presence updates (cursor position, text selection)
   */
  private async handlePresenceUpdate(socket: AuthenticatedSocket, message: PresenceMessage): Promise<void> {
    try {
      const { collaborator, documentId } = message.payload;

      // Validate user is authenticated and in the document
      if (!socket.userId || socket.documentId !== documentId || collaborator.id !== socket.userId) {
        socket.emit('error', { message: 'Unauthorized presence update' });
        return;
      }

      // Use operation broadcaster for presence updates
      await this.operationBroadcaster.broadcastPresence(documentId, collaborator, socket.id);
    } catch (error) {
      console.error('Error handling presence update:', error);
      socket.emit('error', { message: 'Failed to update presence' });
    }
  }

  /**
   * Handle AI requests using the AI integration service
   */
  private async handleAIRequest(socket: AuthenticatedSocket, message: AIRequestMessage): Promise<void> {
    try {
      const aiRequest = message.payload;

      // Validate user is authenticated and in the document
      if (!socket.userId || socket.documentId !== aiRequest.documentId || aiRequest.userId !== socket.userId) {
        socket.emit('error', { message: 'Unauthorized AI request' });
        return;
      }

      // Check if AI integration service is available
      if (!this.aiIntegrationService) {
        socket.emit('ai_response', {
          type: 'ai_response',
          payload: {
            requestId: aiRequest.id,
            result: '',
            status: 'failed',
            error: 'AI service not available'
          },
          timestamp: new Date()
        });
        return;
      }

      console.log(`AI request received from ${socket.userId} in document ${aiRequest.documentId}`);

      // Process the AI request
      const result = await this.aiIntegrationService.processAIRequest(aiRequest);
      
      if (result.success && result.requestId) {
        // Register callback for AI response
        this.aiIntegrationService.registerResponseCallback(result.requestId, (response) => {
          socket.emit('ai_response', response);
        });
      } else {
        socket.emit('ai_response', {
          type: 'ai_response',
          payload: {
            requestId: aiRequest.id,
            result: '',
            status: 'failed',
            error: result.error || 'AI processing failed'
          },
          timestamp: new Date()
        });
      }
      // If successful, the response will come through the callback when AI processing completes

    } catch (error) {
      console.error('Error handling AI request:', error);
      socket.emit('error', { message: 'Failed to process AI request' });
    }
  }

  /**
   * Handle client disconnection
   */
  private async handleDisconnect(socket: AuthenticatedSocket): Promise<void> {
    try {
      console.log(`Client disconnected: ${socket.id}`);

      // Remove from connected users map
      this.connectedUsers.delete(socket.id);

      // Get user session
      const session = await this.userSessionManager.getSessionBySocketId(socket.id);

      // If user was in a document, handle cleanup
      if (session && socket.documentId && socket.userId) {
        // Remove session
        await this.userSessionManager.removeSession(session.id);

        // Remove collaborator from document
        await this.documentManager.removeCollaborator(socket.documentId, socket.userId);

        // Get updated collaborators list
        const remainingCollaborators = await this.userSessionManager.getDocumentCollaborators(socket.documentId);

        // Send updated collaborators list to remaining users (standardized message shape)
        socket.to(socket.documentId).emit('collaborators_updated', {
          type: 'collaborators_updated',
          payload: {
            collaborators: remainingCollaborators
          },
          timestamp: new Date()
        });

        // Broadcast user left event
        const leftMessage: UserLeftMessage = {
          type: 'user_left',
          payload: {
            userId: socket.userId,
            documentId: socket.documentId
          },
          timestamp: new Date()
        };

        socket.to(socket.documentId).emit('user_left', leftMessage);

        // Send disconnect notification
        socket.to(socket.documentId).emit('notification', {
          type: 'user_disconnected',
          message: `${socket.userName || 'User'} disconnected`,
          userId: socket.userId,
          timestamp: new Date()
        });

        console.log(`User ${socket.userId} disconnected from document ${socket.documentId}`);
      }
    } catch (error) {
      console.error('Error handling disconnect:', error);
    }
  }

  /**
   * Get connected users count for a document
   */
  public getConnectedUsersCount(documentId: string): number {
    let count = 0;
    this.connectedUsers.forEach(socket => {
      if (socket.documentId === documentId) {
        count++;
      }
    });
    return count;
  }

  /**
   * Get all connected users for a document
   */
  public getConnectedUsers(documentId: string): AuthenticatedSocket[] {
    const users: AuthenticatedSocket[] = [];
    this.connectedUsers.forEach(socket => {
      if (socket.documentId === documentId) {
        users.push(socket);
      }
    });
    return users;
  }

  /**
   * Broadcast message to all users in a document
   */
  public broadcastToDocument(documentId: string, event: string, data: any): void {
    this.io.to(documentId).emit(event, data);
  }
}