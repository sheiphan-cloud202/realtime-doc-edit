import { Server } from 'socket.io';
import { createServer } from 'http';
import { Client as SocketIOClient } from 'socket.io-client';
import express from 'express';
import { DocumentManager } from '../../backend/src/services/DocumentManager';
import { WebSocketHandler } from '../../backend/src/services/WebSocketHandler';
import { AIIntegrationService } from '../../backend/src/services/AIIntegrationService';

export interface TestServer {
  server: Server;
  httpServer: any;
  port: number;
  documentManager: DocumentManager;
  wsHandler: WebSocketHandler;
  aiService: AIIntegrationService;
  close: () => Promise<void>;
}

export interface TestClient {
  socket: SocketIOClient;
  userId: string;
  disconnect: () => void;
}

export class IntegrationTestSetup {
  private servers: TestServer[] = [];
  private clients: TestClient[] = [];

  async createTestServer(port: number = 0): Promise<TestServer> {
    const app = express();
    const httpServer = createServer(app);
    const io = new Server(httpServer, {
      cors: {
        origin: "*",
        methods: ["GET", "POST"]
      }
    });

    // Initialize services with test configuration
    const documentManager = new DocumentManager({
      redis: {
        host: 'localhost',
        port: 6379,
        db: 1 // Use test database
      }
    });

    const aiService = new AIIntegrationService({
      openai: {
        apiKey: 'test-key',
        model: 'gpt-3.5-turbo'
      },
      mock: true // Use mock responses for testing
    });

    const wsHandler = new WebSocketHandler(io, documentManager, aiService);

    return new Promise((resolve, reject) => {
      httpServer.listen(port, () => {
        const actualPort = (httpServer.address() as any)?.port || port;
        
        const testServer: TestServer = {
          server: io,
          httpServer,
          port: actualPort,
          documentManager,
          wsHandler,
          aiService,
          close: async () => {
            await new Promise<void>((resolve) => {
              io.close(() => {
                httpServer.close(() => resolve());
              });
            });
          }
        };

        this.servers.push(testServer);
        resolve(testServer);
      });

      httpServer.on('error', reject);
    });
  }

  async createTestClient(serverPort: number, userId: string): Promise<TestClient> {
    const socket = new SocketIOClient(`http://localhost:${serverPort}`, {
      transports: ['websocket'],
      forceNew: true
    });

    await new Promise<void>((resolve, reject) => {
      socket.on('connect', () => resolve());
      socket.on('connect_error', reject);
      
      setTimeout(() => reject(new Error('Connection timeout')), 5000);
    });

    // Authenticate user
    await new Promise<void>((resolve, reject) => {
      socket.emit('authenticate', { userId, name: `User ${userId}` });
      socket.on('authenticated', () => resolve());
      socket.on('auth_error', reject);
      
      setTimeout(() => reject(new Error('Auth timeout')), 5000);
    });

    const testClient: TestClient = {
      socket,
      userId,
      disconnect: () => {
        socket.disconnect();
        this.clients = this.clients.filter(c => c !== testClient);
      }
    };

    this.clients.push(testClient);
    return testClient;
  }

  async cleanup(): Promise<void> {
    // Disconnect all clients
    this.clients.forEach(client => client.disconnect());
    this.clients = [];

    // Close all servers
    await Promise.all(this.servers.map(server => server.close()));
    this.servers = [];
  }

  // Helper method to wait for a specific event
  waitForEvent(client: TestClient, event: string, timeout: number = 5000): Promise<any> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        reject(new Error(`Timeout waiting for event: ${event}`));
      }, timeout);

      client.socket.once(event, (data) => {
        clearTimeout(timer);
        resolve(data);
      });
    });
  }

  // Helper method to simulate network delay
  async simulateNetworkDelay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}