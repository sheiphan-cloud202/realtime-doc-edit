import { Server as SocketIOServer } from 'socket.io';
import { createServer } from 'http';
import { AddressInfo } from 'net';
import { io as Client, Socket as ClientSocket } from 'socket.io-client';
import { WebSocketHandler } from '../WebSocketHandler';
import { DocumentManager } from '../DocumentManager';
import { UserSessionManager } from '../UserSessionManager';
import { Operation, Collaborator, UserJoinedMessage, UserLeftMessage } from '../../../../shared/types';

// Mock DocumentManager and UserSessionManager
jest.mock('../DocumentManager');
jest.mock('../UserSessionManager');

describe('WebSocketHandler Integration Tests', () => {
  let httpServer: any;
  let io: SocketIOServer;
  let webSocketHandler: WebSocketHandler;
  let mockDocumentManager: jest.Mocked<DocumentManager>;
  let mockUserSessionManager: jest.Mocked<UserSessionManager>;
  let clientSocket: ClientSocket;
  let serverPort: number;

  beforeEach(async () => {
    // Create HTTP server and Socket.IO server
    httpServer = createServer();
    io = new SocketIOServer(httpServer, {
      cors: {
        origin: '*',
        methods: ['GET', 'POST']
      }
    });

    // Create mock document manager
    mockDocumentManager = new DocumentManager() as jest.Mocked<DocumentManager>;
    mockDocumentManager.getDocument = jest.fn();
    mockDocumentManager.createDocument = jest.fn();
    mockDocumentManager.addCollaborator = jest.fn();
    mockDocumentManager.removeCollaborator = jest.fn();
    mockDocumentManager.updateCollaboratorPresence = jest.fn();
    mockDocumentManager.applyOperation = jest.fn();

    // Create mock user session manager
    mockUserSessionManager = new UserSessionManager() as jest.Mocked<UserSessionManager>;
    mockUserSessionManager.validateUser = jest.fn().mockResolvedValue(true);
    mockUserSessionManager.createSession = jest.fn();
    mockUserSessionManager.getSessionBySocketId = jest.fn();
    mockUserSessionManager.removeSession = jest.fn();
    mockUserSessionManager.getDocumentCollaborators = jest.fn().mockResolvedValue([]);
    mockUserSessionManager.sessionToCollaborator = jest.fn();

    // Initialize WebSocket handler
    webSocketHandler = new WebSocketHandler(io, mockDocumentManager, mockUserSessionManager);
    await webSocketHandler.initialize();

    // Start server
    await new Promise<void>((resolve) => {
      httpServer.listen(() => {
        serverPort = (httpServer.address() as AddressInfo).port;
        resolve();
      });
    });
  });

  afterEach(async () => {
    if (clientSocket) {
      clientSocket.disconnect();
    }
    io.close();
    httpServer.close();
    jest.clearAllMocks();
  });

  describe('Connection and Authentication', () => {
    test('should handle client connection', (done) => {
      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        expect(clientSocket.connected).toBe(true);
        done();
      });
    });

    test('should handle join document event', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        userName: 'John Doe',
        avatar: 'avatar.jpg',
        documentId: 'doc123',
        socketId: 'socket123',
        joinedAt: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      const mockCollaborator = {
        id: 'user123',
        name: 'John Doe',
        avatar: 'avatar.jpg',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockUserSessionManager.createSession.mockResolvedValue(mockSession);
      mockUserSessionManager.sessionToCollaborator.mockReturnValue(mockCollaborator);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe',
          avatar: 'avatar.jpg'
        });
      });

      clientSocket.on('document_state', (data: any) => {
        expect(data.document.id).toBe('doc123');
        expect(data.document.content).toBe('Test content');
        expect(data.document.version).toBe(1);
        expect(mockDocumentManager.getDocument).toHaveBeenCalledWith('doc123');
        expect(mockDocumentManager.addCollaborator).toHaveBeenCalled();
        expect(mockUserSessionManager.validateUser).toHaveBeenCalledWith('user123', 'John Doe');
        expect(mockUserSessionManager.createSession).toHaveBeenCalledWith(
          'user123',
          'John Doe',
          'doc123',
          expect.any(String),
          'avatar.jpg'
        );
        done();
      });
    });

    test('should create document if it does not exist', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: '',
        version: 0,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(null);
      mockDocumentManager.createDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', (data: any) => {
        expect(mockDocumentManager.createDocument).toHaveBeenCalledWith('', 'user123');
        expect(mockDocumentManager.addCollaborator).toHaveBeenCalled();
        done();
      });
    });
  });

  describe('Document Operations', () => {
    beforeEach((done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', () => {
        done();
      });
    });

    test('should handle operation events', (done) => {
      const mockUpdatedDocument = {
        id: 'doc123',
        content: 'Test content updated',
        version: 2,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.applyOperation.mockResolvedValue(mockUpdatedDocument);

      const operation: Operation = {
        type: 'insert',
        position: 12,
        content: ' updated',
        userId: 'user123',
        timestamp: new Date(),
        version: 2
      };

      clientSocket.emit('operation', {
        type: 'operation',
        payload: {
          operation,
          documentId: 'doc123'
        },
        timestamp: new Date()
      });

      clientSocket.on('operation_ack', (data: any) => {
        expect(data.operationId).toBe(2);
        expect(mockDocumentManager.applyOperation).toHaveBeenCalledWith('doc123', expect.objectContaining({
          type: 'insert',
          position: 12,
          content: ' updated',
          userId: 'user123',
          version: 2
        }));
        done();
      });
    });

    test('should reject unauthorized operations', (done) => {
      const operation: Operation = {
        type: 'insert',
        position: 12,
        content: ' updated',
        userId: 'user456', // Different user
        timestamp: new Date(),
        version: 2
      };

      clientSocket.emit('operation', {
        type: 'operation',
        payload: {
          operation,
          documentId: 'doc123'
        },
        timestamp: new Date()
      });

      clientSocket.on('error', (data: any) => {
        expect(data.message).toBe('Unauthorized operation');
        expect(mockDocumentManager.applyOperation).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('Presence Updates', () => {
    beforeEach((done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', () => {
        done();
      });
    });

    test('should handle presence updates', (done) => {
      mockDocumentManager.updateCollaboratorPresence.mockResolvedValue({} as any);

      const collaborator: Collaborator = {
        id: 'user123',
        name: 'John Doe',
        cursor: 10,
        selection: { start: 5, end: 15 },
        isActive: true,
        lastSeen: new Date()
      };

      clientSocket.emit('presence', {
        type: 'presence',
        payload: {
          collaborator,
          documentId: 'doc123'
        },
        timestamp: new Date()
      });

      // Wait a bit to ensure the presence update is processed
      setTimeout(() => {
        expect(mockDocumentManager.updateCollaboratorPresence).toHaveBeenCalledWith(
          'doc123',
          'user123',
          10,
          { start: 5, end: 15 }
        );
        done();
      }, 100);
    });

    test('should reject unauthorized presence updates', (done) => {
      const collaborator: Collaborator = {
        id: 'user456', // Different user
        name: 'Jane Doe',
        cursor: 10,
        isActive: true,
        lastSeen: new Date()
      };

      clientSocket.emit('presence', {
        type: 'presence',
        payload: {
          collaborator,
          documentId: 'doc123'
        },
        timestamp: new Date()
      });

      clientSocket.on('error', (data: any) => {
        expect(data.message).toBe('Unauthorized presence update');
        expect(mockDocumentManager.updateCollaboratorPresence).not.toHaveBeenCalled();
        done();
      });
    });
  });

  describe('Disconnection Handling', () => {
    test('should handle client disconnection', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockDocumentManager.removeCollaborator.mockResolvedValue(mockDocument);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', () => {
        // Disconnect the client
        clientSocket.disconnect();
        
        // Wait a bit for the disconnect to be processed
        setTimeout(() => {
          expect(mockDocumentManager.removeCollaborator).toHaveBeenCalledWith('doc123', 'user123');
          done();
        }, 100);
      });
    });
  });

  describe('User Join/Leave Events', () => {
    test('should broadcast user joined event when user joins document', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);

      // Create a second client to receive the broadcast
      const secondClient = Client(`http://localhost:${serverPort}`);
      
      // First client joins
      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      // Second client should receive user_joined event
      secondClient.on('connect', () => {
        secondClient.emit('join_document', {
          documentId: 'doc123',
          userId: 'user456',
          userName: 'Jane Doe'
        });
      });

      secondClient.on('user_joined', (message: UserJoinedMessage) => {
        expect(message.type).toBe('user_joined');
        expect(message.payload.collaborator.name).toBe('Jane Doe');
        expect(message.payload.documentId).toBe('doc123');
        secondClient.disconnect();
        done();
      });
    });

    test('should broadcast user left event when user leaves document', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockDocumentManager.removeCollaborator.mockResolvedValue(mockDocument);

      // Create a second client to receive the broadcast
      const secondClient = Client(`http://localhost:${serverPort}`);
      
      // Both clients join first
      clientSocket = Client(`http://localhost:${serverPort}`);
      
      let joinedCount = 0;
      const checkBothJoined = () => {
        joinedCount++;
        if (joinedCount === 2) {
          // Now leave the first client
          clientSocket.emit('leave_document', {
            documentId: 'doc123',
            userId: 'user123'
          });
        }
      };

      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', checkBothJoined);

      secondClient.on('connect', () => {
        secondClient.emit('join_document', {
          documentId: 'doc123',
          userId: 'user456',
          userName: 'Jane Doe'
        });
      });

      secondClient.on('document_state', checkBothJoined);

      // Second client should receive user_left event
      secondClient.on('user_left', (message: UserLeftMessage) => {
        expect(message.type).toBe('user_left');
        expect(message.payload.userId).toBe('user123');
        expect(message.payload.documentId).toBe('doc123');
        secondClient.disconnect();
        done();
      });
    });

    test('should broadcast user left event on disconnect', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockDocumentManager.removeCollaborator.mockResolvedValue(mockDocument);

      // Create a second client to receive the broadcast
      const secondClient = Client(`http://localhost:${serverPort}`);
      
      // Both clients join first
      clientSocket = Client(`http://localhost:${serverPort}`);
      
      let joinedCount = 0;
      const checkBothJoined = () => {
        joinedCount++;
        if (joinedCount === 2) {
          // Now disconnect the first client
          clientSocket.disconnect();
        }
      };

      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', checkBothJoined);

      secondClient.on('connect', () => {
        secondClient.emit('join_document', {
          documentId: 'doc123',
          userId: 'user456',
          userName: 'Jane Doe'
        });
      });

      secondClient.on('document_state', checkBothJoined);

      // Second client should receive user_left event
      secondClient.on('user_left', (message: UserLeftMessage) => {
        expect(message.type).toBe('user_left');
        expect(message.payload.userId).toBe('user123');
        expect(message.payload.documentId).toBe('doc123');
        secondClient.disconnect();
        done();
      });
    });
  });

  describe('Multi-User Presence Features', () => {
    test('should handle multiple users with different cursor positions', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockDocumentManager.updateCollaboratorPresence.mockResolvedValue(mockDocument);

      // Create multiple clients
      const clients: ClientSocket[] = [];
      const userIds = ['user1', 'user2', 'user3'];
      let connectedCount = 0;
      let presenceUpdatesReceived = 0;

      const checkAllConnected = () => {
        connectedCount++;
        if (connectedCount === userIds.length) {
          // All connected, now send presence updates
          clients.forEach((client, index) => {
            const collaborator: Collaborator = {
              id: userIds[index],
              name: `User ${index + 1}`,
              cursor: (index + 1) * 10,
              selection: { start: index * 5, end: (index + 1) * 15 },
              isActive: true,
              lastSeen: new Date()
            };

            client.emit('presence', {
              type: 'presence',
              payload: {
                collaborator,
                documentId: 'doc123'
              },
              timestamp: new Date()
            });
          });
        }
      };

      userIds.forEach((userId, index) => {
        const client = Client(`http://localhost:${serverPort}`);
        clients.push(client);

        client.on('connect', () => {
          client.emit('join_document', {
            documentId: 'doc123',
            userId,
            userName: `User ${index + 1}`
          });
        });

        client.on('document_state', checkAllConnected);

        client.on('presence', () => {
          presenceUpdatesReceived++;
          // Each client should receive presence updates from other clients
          if (presenceUpdatesReceived >= userIds.length * (userIds.length - 1)) {
            // Clean up
            clients.forEach(c => c.disconnect());
            done();
          }
        });
      });
    });

    test('should handle rapid presence updates without conflicts', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockDocumentManager.updateCollaboratorPresence.mockResolvedValue(mockDocument);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', () => {
        // Send rapid presence updates
        for (let i = 0; i < 10; i++) {
          const collaborator: Collaborator = {
            id: 'user123',
            name: 'John Doe',
            cursor: i * 5,
            selection: { start: i * 2, end: i * 7 },
            isActive: true,
            lastSeen: new Date()
          };

          clientSocket.emit('presence', {
            type: 'presence',
            payload: {
              collaborator,
              documentId: 'doc123'
            },
            timestamp: new Date()
          });
        }

        // Wait for all updates to be processed
        setTimeout(() => {
          expect(mockDocumentManager.updateCollaboratorPresence).toHaveBeenCalledTimes(10);
          done();
        }, 200);
      });
    });
  });

  describe('User Session Lifecycle', () => {
    test('should create session on join and remove on disconnect', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        userName: 'John Doe',
        documentId: 'doc123',
        socketId: 'socket123',
        joinedAt: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      const mockCollaborator = {
        id: 'user123',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockDocumentManager.removeCollaborator.mockResolvedValue(mockDocument);
      mockUserSessionManager.createSession.mockResolvedValue(mockSession);
      mockUserSessionManager.sessionToCollaborator.mockReturnValue(mockCollaborator);
      mockUserSessionManager.getSessionBySocketId.mockResolvedValue(mockSession);
      mockUserSessionManager.removeSession.mockResolvedValue(true);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      clientSocket.on('document_state', () => {
        // Verify session was created
        expect(mockUserSessionManager.createSession).toHaveBeenCalled();
        
        // Now disconnect
        clientSocket.disconnect();
        
        // Wait for disconnect to be processed
        setTimeout(() => {
          expect(mockUserSessionManager.getSessionBySocketId).toHaveBeenCalled();
          expect(mockUserSessionManager.removeSession).toHaveBeenCalledWith('session123');
          expect(mockDocumentManager.removeCollaborator).toHaveBeenCalledWith('doc123', 'user123');
          done();
        }, 100);
      });
    });

    test('should reject invalid user credentials', (done) => {
      mockUserSessionManager.validateUser.mockResolvedValue(false);

      clientSocket = Client(`http://localhost:${serverPort}`);
      
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: '',
          userName: 'John Doe'
        });
      });

      clientSocket.on('error', (data: any) => {
        expect(data.message).toBe('Invalid user credentials');
        expect(mockUserSessionManager.createSession).not.toHaveBeenCalled();
        done();
      });
    });

    test('should send notifications on user join/leave', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        userName: 'John Doe',
        documentId: 'doc123',
        socketId: 'socket123',
        joinedAt: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      const mockCollaborator = {
        id: 'user123',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockUserSessionManager.createSession.mockResolvedValue(mockSession);
      mockUserSessionManager.sessionToCollaborator.mockReturnValue(mockCollaborator);

      // Create two clients
      const secondClient = Client(`http://localhost:${serverPort}`);
      clientSocket = Client(`http://localhost:${serverPort}`);

      let notificationsReceived = 0;

      // First client joins
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      // Second client should receive notification when first client joins
      secondClient.on('connect', () => {
        secondClient.emit('join_document', {
          documentId: 'doc123',
          userId: 'user456',
          userName: 'Jane Doe'
        });
      });

      secondClient.on('notification', (data: any) => {
        notificationsReceived++;
        if (notificationsReceived === 1) {
          expect(data.type).toBe('user_joined');
          expect(data.message).toContain('joined the document');
          secondClient.disconnect();
          done();
        }
      });
    });

    test('should update collaborators list on user join/leave', (done) => {
      const mockDocument = {
        id: 'doc123',
        content: 'Test content',
        version: 1,
        operations: [],
        collaborators: [],
        createdAt: new Date(),
        updatedAt: new Date()
      };

      const mockSession = {
        id: 'session123',
        userId: 'user123',
        userName: 'John Doe',
        documentId: 'doc123',
        socketId: 'socket123',
        joinedAt: new Date(),
        lastActivity: new Date(),
        isActive: true
      };

      const mockCollaborator = {
        id: 'user123',
        name: 'John Doe',
        cursor: 0,
        isActive: true,
        lastSeen: new Date()
      };

      mockDocumentManager.getDocument.mockResolvedValue(mockDocument);
      mockDocumentManager.addCollaborator.mockResolvedValue(mockDocument);
      mockUserSessionManager.createSession.mockResolvedValue(mockSession);
      mockUserSessionManager.sessionToCollaborator.mockReturnValue(mockCollaborator);
      mockUserSessionManager.getDocumentCollaborators.mockResolvedValue([mockCollaborator]);

      // Create two clients
      const secondClient = Client(`http://localhost:${serverPort}`);
      clientSocket = Client(`http://localhost:${serverPort}`);

      // First client joins
      clientSocket.on('connect', () => {
        clientSocket.emit('join_document', {
          documentId: 'doc123',
          userId: 'user123',
          userName: 'John Doe'
        });
      });

      // Second client should receive collaborators update
      secondClient.on('connect', () => {
        secondClient.emit('join_document', {
          documentId: 'doc123',
          userId: 'user456',
          userName: 'Jane Doe'
        });
      });

      secondClient.on('collaborators_updated', (data: any) => {
        expect(data.collaborators).toEqual([mockCollaborator]);
        expect(mockUserSessionManager.getDocumentCollaborators).toHaveBeenCalledWith('doc123');
        secondClient.disconnect();
        done();
      });
    });
  });

  describe('Utility Methods', () => {
    test('should track connected users count', () => {
      expect(webSocketHandler.getConnectedUsersCount('doc123')).toBe(0);
    });

    test('should get connected users for document', () => {
      const users = webSocketHandler.getConnectedUsers('doc123');
      expect(users).toEqual([]);
    });
  });
});