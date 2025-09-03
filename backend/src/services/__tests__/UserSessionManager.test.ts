import { UserSessionManager, UserSession } from '../UserSessionManager';
import { createClient } from 'redis';

// Mock Redis client
jest.mock('redis', () => ({
  createClient: jest.fn(() => ({
    connect: jest.fn(),
    disconnect: jest.fn(),
    setEx: jest.fn(),
    get: jest.fn(),
    del: jest.fn(),
    keys: jest.fn(() => [])
  }))
}));

describe('UserSessionManager', () => {
  let userSessionManager: UserSessionManager;
  let mockRedisClient: any;

  beforeEach(() => {
    mockRedisClient = {
      connect: jest.fn(),
      disconnect: jest.fn(),
      setEx: jest.fn(),
      get: jest.fn(),
      del: jest.fn(),
      keys: jest.fn(() => [])
    };
    
    (createClient as jest.Mock).mockReturnValue(mockRedisClient);
    
    userSessionManager = new UserSessionManager({
      sessionTimeout: 3600
    });
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  describe('initialize', () => {
    it('should connect to Redis', async () => {
      await userSessionManager.initialize();
      expect(mockRedisClient.connect).toHaveBeenCalled();
    });
  });

  describe('disconnect', () => {
    it('should disconnect from Redis', async () => {
      await userSessionManager.disconnect();
      expect(mockRedisClient.disconnect).toHaveBeenCalled();
    });
  });

  describe('createSession', () => {
    it('should create a new user session', async () => {
      const userId = 'user123';
      const userName = 'John Doe';
      const documentId = 'doc456';
      const socketId = 'socket789';
      const avatar = 'avatar.jpg';

      const session = await userSessionManager.createSession(
        userId,
        userName,
        documentId,
        socketId,
        avatar
      );

      expect(session).toMatchObject({
        userId,
        userName,
        documentId,
        socketId,
        avatar,
        isActive: true
      });
      expect(session.id).toBeDefined();
      expect(session.joinedAt).toBeInstanceOf(Date);
      expect(session.lastActivity).toBeInstanceOf(Date);
      expect(mockRedisClient.setEx).toHaveBeenCalled();
    });

    it('should create session without avatar', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      expect(session.avatar).toBeUndefined();
      expect(session.userId).toBe('user123');
    });
  });

  describe('getSession', () => {
    it('should return session from memory cache', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      const retrievedSession = await userSessionManager.getSession(session.id);
      expect(retrievedSession).toEqual(session);
    });

    it('should return session from Redis cache when not in memory', async () => {
      const sessionData = {
        id: 'session123',
        userId: 'user123',
        userName: 'John Doe',
        documentId: 'doc456',
        socketId: 'socket789',
        joinedAt: new Date().toISOString(),
        lastActivity: new Date().toISOString(),
        isActive: true
      };

      mockRedisClient.get.mockResolvedValue(JSON.stringify(sessionData));

      const session = await userSessionManager.getSession('session123');
      expect(session).toMatchObject({
        id: 'session123',
        userId: 'user123',
        userName: 'John Doe'
      });
      expect(session?.joinedAt).toBeInstanceOf(Date);
      expect(session?.lastActivity).toBeInstanceOf(Date);
    });

    it('should return null for non-existent session', async () => {
      mockRedisClient.get.mockResolvedValue(null);
      const session = await userSessionManager.getSession('nonexistent');
      expect(session).toBeNull();
    });
  });

  describe('getSessionBySocketId', () => {
    it('should return session by socket ID from memory', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      const retrievedSession = await userSessionManager.getSessionBySocketId('socket789');
      expect(retrievedSession).toEqual(session);
    });

    it('should return null for non-existent socket ID', async () => {
      const session = await userSessionManager.getSessionBySocketId('nonexistent');
      expect(session).toBeNull();
    });
  });

  describe('getDocumentSessions', () => {
    it('should return all sessions for a document', async () => {
      const session1 = await userSessionManager.createSession(
        'user1',
        'User One',
        'doc123',
        'socket1'
      );

      const session2 = await userSessionManager.createSession(
        'user2',
        'User Two',
        'doc123',
        'socket2'
      );

      const session3 = await userSessionManager.createSession(
        'user3',
        'User Three',
        'doc456',
        'socket3'
      );

      const documentSessions = await userSessionManager.getDocumentSessions('doc123');
      expect(documentSessions).toHaveLength(2);
      expect(documentSessions.map(s => s.userId)).toContain('user1');
      expect(documentSessions.map(s => s.userId)).toContain('user2');
      expect(documentSessions.map(s => s.userId)).not.toContain('user3');
    });

    it('should return empty array for document with no sessions', async () => {
      const sessions = await userSessionManager.getDocumentSessions('nonexistent');
      expect(sessions).toEqual([]);
    });
  });

  describe('updateSessionActivity', () => {
    it('should update session activity timestamp', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      const originalActivity = session.lastActivity;
      
      // Wait a bit to ensure timestamp difference
      await new Promise(resolve => setTimeout(resolve, 10));
      
      const updatedSession = await userSessionManager.updateSessionActivity(session.id);
      
      expect(updatedSession).toBeTruthy();
      expect(updatedSession!.lastActivity.getTime()).toBeGreaterThan(originalActivity.getTime());
      expect(updatedSession!.isActive).toBe(true);
    });

    it('should return null for non-existent session', async () => {
      const result = await userSessionManager.updateSessionActivity('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('deactivateSession', () => {
    it('should mark session as inactive', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      const deactivatedSession = await userSessionManager.deactivateSession(session.id);
      
      expect(deactivatedSession).toBeTruthy();
      expect(deactivatedSession!.isActive).toBe(false);
    });

    it('should return null for non-existent session', async () => {
      const result = await userSessionManager.deactivateSession('nonexistent');
      expect(result).toBeNull();
    });
  });

  describe('removeSession', () => {
    it('should remove session from memory and Redis', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      const result = await userSessionManager.removeSession(session.id);
      expect(result).toBe(true);
      expect(mockRedisClient.del).toHaveBeenCalledWith(`session:${session.id}`);

      // Session should no longer be retrievable
      const retrievedSession = await userSessionManager.getSession(session.id);
      expect(retrievedSession).toBeNull();
    });
  });

  describe('removeSessionBySocketId', () => {
    it('should remove session by socket ID', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789'
      );

      const result = await userSessionManager.removeSessionBySocketId('socket789');
      expect(result).toBe(true);

      // Session should no longer be retrievable
      const retrievedSession = await userSessionManager.getSessionBySocketId('socket789');
      expect(retrievedSession).toBeNull();
    });

    it('should return false for non-existent socket ID', async () => {
      const result = await userSessionManager.removeSessionBySocketId('nonexistent');
      expect(result).toBe(false);
    });
  });

  describe('sessionToCollaborator', () => {
    it('should convert session to collaborator', async () => {
      const session = await userSessionManager.createSession(
        'user123',
        'John Doe',
        'doc456',
        'socket789',
        'avatar.jpg'
      );

      const collaborator = userSessionManager.sessionToCollaborator(session);
      
      expect(collaborator).toMatchObject({
        id: 'user123',
        name: 'John Doe',
        avatar: 'avatar.jpg',
        cursor: 0,
        isActive: true,
        lastSeen: session.lastActivity
      });
    });
  });

  describe('getDocumentCollaborators', () => {
    it('should return active collaborators for a document', async () => {
      const session1 = await userSessionManager.createSession(
        'user1',
        'User One',
        'doc123',
        'socket1'
      );

      const session2 = await userSessionManager.createSession(
        'user2',
        'User Two',
        'doc123',
        'socket2'
      );

      // Deactivate one session
      await userSessionManager.deactivateSession(session2.id);

      const collaborators = await userSessionManager.getDocumentCollaborators('doc123');
      
      expect(collaborators).toHaveLength(1);
      expect(collaborators[0].id).toBe('user1');
      expect(collaborators[0].name).toBe('User One');
    });
  });

  describe('validateUser', () => {
    it('should validate user with valid credentials', async () => {
      const isValid = await userSessionManager.validateUser('user123', 'John Doe');
      expect(isValid).toBe(true);
    });

    it('should reject user with empty userId', async () => {
      const isValid = await userSessionManager.validateUser('', 'John Doe');
      expect(isValid).toBe(false);
    });

    it('should reject user with empty userName', async () => {
      const isValid = await userSessionManager.validateUser('user123', '');
      expect(isValid).toBe(false);
    });

    it('should reject user with whitespace-only credentials', async () => {
      const isValid1 = await userSessionManager.validateUser('   ', 'John Doe');
      const isValid2 = await userSessionManager.validateUser('user123', '   ');
      
      expect(isValid1).toBe(false);
      expect(isValid2).toBe(false);
    });
  });

  describe('error handling', () => {
    it('should handle Redis errors gracefully', async () => {
      mockRedisClient.get.mockRejectedValue(new Error('Redis error'));
      
      const session = await userSessionManager.getSession('session123');
      expect(session).toBeNull();
    });

    it('should handle JSON parsing errors', async () => {
      mockRedisClient.get.mockResolvedValue('invalid json');
      
      const session = await userSessionManager.getSession('session123');
      expect(session).toBeNull();
    });
  });
});