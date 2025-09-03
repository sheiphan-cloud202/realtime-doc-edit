import { createClient, RedisClientType } from 'redis';
import { v4 as uuidv4 } from 'uuid';
import { Collaborator } from '../../../shared/types';

export interface UserSession {
  id: string;
  userId: string;
  userName: string;
  avatar?: string;
  documentId: string;
  socketId: string;
  joinedAt: Date;
  lastActivity: Date;
  isActive: boolean;
}

export interface UserSessionManagerConfig {
  redisUrl?: string;
  sessionTimeout?: number; // in seconds
}

export class UserSessionManager {
  private redisClient: RedisClientType;
  private sessionTimeout: number;
  private sessions: Map<string, UserSession> = new Map();

  constructor(config: UserSessionManagerConfig = {}) {
    this.redisClient = createClient({
      url: config.redisUrl || process.env.REDIS_URL || 'redis://localhost:6379'
    });
    this.sessionTimeout = config.sessionTimeout || 3600; // 1 hour default
  }

  async initialize(): Promise<void> {
    await this.redisClient.connect();
    
    // Start cleanup interval for expired sessions
    setInterval(() => {
      this.cleanupExpiredSessions();
    }, 60000); // Check every minute

    // Development safety: clear any stale sessions from previous runs so collaborator lists don't accumulate
    // In a multi-instance production deployment, this should be replaced with a
    // heartbeat-based liveness check rather than a blanket delete.
    await this.clearAllSessions();
  }

  async disconnect(): Promise<void> {
    await this.redisClient.disconnect();
  }

  /**
   * Create a new user session
   */
  async createSession(
    userId: string,
    userName: string,
    documentId: string,
    socketId: string,
    avatar?: string
  ): Promise<UserSession> {
    const session: UserSession = {
      id: uuidv4(),
      userId,
      userName,
      avatar,
      documentId,
      socketId,
      joinedAt: new Date(),
      lastActivity: new Date(),
      isActive: true
    };

    // Store in memory cache
    this.sessions.set(session.id, session);

    // Store in Redis with expiration
    await this.cacheSession(session);

    return session;
  }

  /**
   * Get session by session ID
   */
  async getSession(sessionId: string): Promise<UserSession | null> {
    // Try memory cache first
    let session = this.sessions.get(sessionId);
    
    if (!session) {
      // Try Redis cache
      const cachedSession = await this.getCachedSession(sessionId);
      if (cachedSession) {
        session = cachedSession;
        this.sessions.set(sessionId, session);
      }
    }

    return session || null;
  }

  /**
   * Get session by socket ID
   */
  async getSessionBySocketId(socketId: string): Promise<UserSession | null> {
    // Check memory cache first
    for (const session of this.sessions.values()) {
      if (session.socketId === socketId) {
        return session;
      }
    }

    // Check Redis cache
    const sessionIds = await this.redisClient.keys('session:*');
    for (const key of sessionIds) {
      const cachedSession = await this.getCachedSession(key.replace('session:', ''));
      if (cachedSession && cachedSession.socketId === socketId) {
        this.sessions.set(cachedSession.id, cachedSession);
        return cachedSession;
      }
    }

    return null;
  }

  /**
   * Get all sessions for a document
   */
  async getDocumentSessions(documentId: string): Promise<UserSession[]> {
    const sessions: UserSession[] = [];

    // Check memory cache
    for (const session of this.sessions.values()) {
      if (session.documentId === documentId && session.isActive) {
        sessions.push(session);
      }
    }

    // Check Redis cache for any missing sessions
    const sessionIds = await this.redisClient.keys('session:*');
    for (const key of sessionIds) {
      const sessionId = key.replace('session:', '');
      if (!this.sessions.has(sessionId)) {
        const cachedSession = await this.getCachedSession(sessionId);
        if (cachedSession && cachedSession.documentId === documentId && cachedSession.isActive) {
          sessions.push(cachedSession);
          this.sessions.set(sessionId, cachedSession);
        }
      }
    }

    return sessions;
  }

  /**
   * Update session activity
   */
  async updateSessionActivity(sessionId: string): Promise<UserSession | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.lastActivity = new Date();
    session.isActive = true;

    // Update caches
    this.sessions.set(sessionId, session);
    await this.cacheSession(session);

    return session;
  }

  /**
   * Mark session as inactive
   */
  async deactivateSession(sessionId: string): Promise<UserSession | null> {
    const session = await this.getSession(sessionId);
    if (!session) {
      return null;
    }

    session.isActive = false;
    session.lastActivity = new Date();

    // Update caches
    this.sessions.set(sessionId, session);
    await this.cacheSession(session);

    return session;
  }

  /**
   * Remove session completely
   */
  async removeSession(sessionId: string): Promise<boolean> {
    // Remove from memory cache
    this.sessions.delete(sessionId);

    // Remove from Redis
    await this.redisClient.del(`session:${sessionId}`);

    return true;
  }

  /**
   * Remove session by socket ID
   */
  async removeSessionBySocketId(socketId: string): Promise<boolean> {
    const session = await this.getSessionBySocketId(socketId);
    if (!session) {
      return false;
    }

    return await this.removeSession(session.id);
  }

  /**
   * Clear all sessions from Redis and memory (used on server startup to avoid stale collaborators)
   */
  async clearAllSessions(): Promise<void> {
    try {
      const keys = await this.redisClient.keys('session:*');
      if (keys.length > 0) {
        await this.redisClient.del(keys);
      }
      this.sessions.clear();
    } catch (error) {
      console.error('Error clearing sessions:', error);
    }
  }

  /**
   * Convert session to collaborator
   */
  sessionToCollaborator(session: UserSession): Collaborator {
    return {
      id: session.userId,
      name: session.userName,
      avatar: session.avatar,
      cursor: 0,
      isActive: session.isActive,
      lastSeen: session.lastActivity
    };
  }

  /**
   * Get active collaborators for a document
   */
  async getDocumentCollaborators(documentId: string): Promise<Collaborator[]> {
    const sessions = await this.getDocumentSessions(documentId);
    return sessions
      .filter(session => session.isActive)
      .map(session => this.sessionToCollaborator(session));
  }

  /**
   * Validate user authentication (placeholder for real auth)
   */
  async validateUser(userId: string, userName: string): Promise<boolean> {
    // TODO: Implement real authentication logic
    // For now, just validate that userId and userName are provided
    return !!(userId && userName && userId.trim() && userName.trim());
  }

  /**
   * Clean up expired sessions
   */
  private async cleanupExpiredSessions(): Promise<void> {
    const now = new Date();
    const expiredSessions: string[] = [];

    // Check memory cache for expired sessions
    for (const [sessionId, session] of this.sessions.entries()) {
      const timeSinceActivity = (now.getTime() - session.lastActivity.getTime()) / 1000;
      if (timeSinceActivity > this.sessionTimeout) {
        expiredSessions.push(sessionId);
      }
    }

    // Remove expired sessions
    for (const sessionId of expiredSessions) {
      await this.removeSession(sessionId);
    }

    if (expiredSessions.length > 0) {
      console.log(`Cleaned up ${expiredSessions.length} expired sessions`);
    }
  }

  /**
   * Cache session in Redis
   */
  private async cacheSession(session: UserSession): Promise<void> {
    const key = `session:${session.id}`;
    const value = JSON.stringify(session);
    await this.redisClient.setEx(key, this.sessionTimeout, value);
  }

  /**
   * Get cached session from Redis
   */
  private async getCachedSession(sessionId: string): Promise<UserSession | null> {
    const key = `session:${sessionId}`;
    const value = await this.redisClient.get(key);
    
    if (!value) {
      return null;
    }

    try {
      const session = JSON.parse(value);
      // Convert date strings back to Date objects
      session.joinedAt = new Date(session.joinedAt);
      session.lastActivity = new Date(session.lastActivity);
      
      return session;
    } catch (error) {
      console.error('Error parsing cached session:', error);
      return null;
    }
  }
}