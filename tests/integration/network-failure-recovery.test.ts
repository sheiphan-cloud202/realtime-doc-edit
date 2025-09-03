import { IntegrationTestSetup, TestServer, TestClient } from './setup';
import { Operation } from '../../shared/types';

describe('Network Failure and Recovery Integration Tests', () => {
  let testSetup: IntegrationTestSetup;
  let server: TestServer;

  beforeAll(async () => {
    testSetup = new IntegrationTestSetup();
    server = await testSetup.createTestServer();
  });

  afterAll(async () => {
    await testSetup.cleanup();
  });

  describe('Connection Loss and Reconnection', () => {
    it('should handle client disconnection and reconnection gracefully', async () => {
      const client = await testSetup.createTestClient(server.port, 'reconnect-user-1');
      const documentId = 'reconnect-doc-1';

      // Initial connection and document join
      client.socket.emit('join_document', { documentId });
      const initialJoin = await testSetup.waitForEvent(client, 'document_joined');
      
      expect(initialJoin.documentId).toBe(documentId);
      const initialVersion = initialJoin.version;

      // Make some changes before disconnection
      const preDisconnectOp: Operation = {
        type: 'insert',
        position: 0,
        content: 'Before disconnect',
        userId: 'reconnect-user-1',
        timestamp: new Date(),
        version: initialVersion + 1
      };

      client.socket.emit('operation', preDisconnectOp);
      await testSetup.waitForEvent(client, 'operation_applied');

      // Simulate network disconnection
      client.socket.disconnect();
      await testSetup.simulateNetworkDelay(1000);

      // Reconnect
      client.socket.connect();
      await new Promise<void>((resolve) => {
        client.socket.on('connect', () => resolve());
      });

      // Re-authenticate and rejoin document
      client.socket.emit('authenticate', { userId: 'reconnect-user-1', name: 'Reconnect User 1' });
      await testSetup.waitForEvent(client, 'authenticated');

      client.socket.emit('join_document', { documentId });
      const rejoinResponse = await testSetup.waitForEvent(client, 'document_joined');

      // Should receive updated document state
      expect(rejoinResponse.documentId).toBe(documentId);
      expect(rejoinResponse.version).toBeGreaterThan(initialVersion);

      client.disconnect();
    });

    it('should queue operations during offline mode and sync on reconnection', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'offline-user-1');
      const client2 = await testSetup.createTestClient(server.port, 'offline-user-2');
      const documentId = 'offline-sync-doc-1';

      // Both clients join document
      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      // Client1 goes offline
      client1.socket.disconnect();

      // Client2 makes changes while client1 is offline
      const offlineChanges = [
        { type: 'insert', position: 0, content: 'Change 1', userId: 'offline-user-2' },
        { type: 'insert', position: 8, content: ' Change 2', userId: 'offline-user-2' },
        { type: 'insert', position: 17, content: ' Change 3', userId: 'offline-user-2' }
      ];

      for (const change of offlineChanges) {
        client2.socket.emit('operation', change);
        await testSetup.waitForEvent(client2, 'operation_applied');
      }

      // Client1 reconnects
      client1.socket.connect();
      await new Promise<void>((resolve) => {
        client1.socket.on('connect', () => resolve());
      });

      // Re-authenticate and rejoin
      client1.socket.emit('authenticate', { userId: 'offline-user-1', name: 'Offline User 1' });
      await testSetup.waitForEvent(client1, 'authenticated');

      client1.socket.emit('join_document', { documentId });
      const syncResponse = await testSetup.waitForEvent(client1, 'document_synced');

      // Should receive all missed operations
      expect(syncResponse.missedOperations).toHaveLength(offlineChanges.length);
      expect(syncResponse.currentContent).toContain('Change 1 Change 2 Change 3');

      client1.disconnect();
      client2.disconnect();
    });

    it('should handle partial message loss and request retransmission', async () => {
      const client = await testSetup.createTestClient(server.port, 'retry-user-1');
      const documentId = 'retry-doc-1';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Send operation but simulate message loss by not waiting for ack
      const operation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Test retry',
        userId: 'retry-user-1',
        timestamp: new Date(),
        version: 1
      };

      // Send operation multiple times to simulate retry mechanism
      client.socket.emit('operation', operation);
      
      // Wait for acknowledgment with timeout
      try {
        const ack = await testSetup.waitForEvent(client, 'operation_applied', 2000);
        expect(ack.success).toBe(true);
      } catch (error) {
        // If first attempt fails, retry
        client.socket.emit('operation_retry', { ...operation, retryCount: 1 });
        const retryAck = await testSetup.waitForEvent(client, 'operation_applied');
        expect(retryAck.success).toBe(true);
      }

      client.disconnect();
    });
  });

  describe('Server Failure Recovery', () => {
    it('should handle server restart and client reconnection', async () => {
      const client = await testSetup.createTestClient(server.port, 'server-restart-user');
      const documentId = 'server-restart-doc';

      // Initial setup
      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Make some changes
      client.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'Before server restart',
        userId: 'server-restart-user',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client, 'operation_applied');

      // Simulate server restart by creating new server instance
      const originalPort = server.port;
      await server.close();
      
      // Wait for restart simulation
      await testSetup.simulateNetworkDelay(2000);
      
      // Create new server instance
      server = await testSetup.createTestServer(originalPort);

      // Client should detect disconnection and attempt reconnection
      await new Promise<void>((resolve) => {
        client.socket.on('disconnect', () => {
          // Simulate client reconnection logic
          setTimeout(() => {
            client.socket.connect();
            resolve();
          }, 1000);
        });
      });

      // Wait for reconnection
      await new Promise<void>((resolve) => {
        client.socket.on('connect', () => resolve());
      });

      // Re-authenticate and rejoin
      client.socket.emit('authenticate', { userId: 'server-restart-user', name: 'Server Restart User' });
      await testSetup.waitForEvent(client, 'authenticated');

      client.socket.emit('join_document', { documentId });
      const recoveryResponse = await testSetup.waitForEvent(client, 'document_recovered');

      expect(recoveryResponse.success).toBe(true);
      expect(recoveryResponse.documentId).toBe(documentId);

      client.disconnect();
    });
  });

  describe('AI Service Failure Recovery', () => {
    it('should handle AI service timeouts and retries', async () => {
      const client = await testSetup.createTestClient(server.port, 'ai-timeout-user');
      const documentId = 'ai-timeout-doc';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Add content for AI processing
      client.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'Test content for AI timeout',
        userId: 'ai-timeout-user',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client, 'operation_applied');

      // Send AI request that will timeout
      const aiRequest = {
        documentId,
        selectedText: 'Test content for AI timeout',
        prompt: 'This request will timeout',
        selectionStart: 0,
        selectionEnd: 27,
        timeout: 1000 // Short timeout for testing
      };

      client.socket.emit('ai_request', aiRequest);

      // Should receive timeout error
      const timeoutError = await testSetup.waitForEvent(client, 'ai_timeout', 5000);
      expect(timeoutError).toMatchObject({
        requestId: expect.any(String),
        error: 'Request timeout',
        retryable: true
      });

      // Retry the request
      client.socket.emit('ai_retry', { requestId: timeoutError.requestId });
      
      // Should eventually succeed or fail definitively
      const retryResult = await testSetup.waitForEvent(client, 'ai_retry_result', 10000);
      expect(retryResult.requestId).toBe(timeoutError.requestId);
      expect(['completed', 'failed']).toContain(retryResult.status);

      client.disconnect();
    });

    it('should handle AI service rate limiting gracefully', async () => {
      const client = await testSetup.createTestClient(server.port, 'rate-limit-user');
      const documentId = 'rate-limit-doc';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Add content
      client.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'Content for rate limiting test',
        userId: 'rate-limit-user',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client, 'operation_applied');

      // Send multiple AI requests rapidly to trigger rate limiting
      const requests = [];
      for (let i = 0; i < 10; i++) {
        const request = {
          documentId,
          selectedText: `Content ${i}`,
          prompt: `Request ${i}`,
          selectionStart: i * 3,
          selectionEnd: i * 3 + 10
        };
        requests.push(request);
        client.socket.emit('ai_request', request);
      }

      // Should receive rate limit error for some requests
      const rateLimitError = await testSetup.waitForEvent(client, 'ai_rate_limited', 5000);
      expect(rateLimitError).toMatchObject({
        error: 'Rate limit exceeded',
        retryAfter: expect.any(Number)
      });

      client.disconnect();
    });
  });

  describe('Data Consistency Recovery', () => {
    it('should detect and resolve document state inconsistencies', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'consistency-user-1');
      const client2 = await testSetup.createTestClient(server.port, 'consistency-user-2');
      const documentId = 'consistency-doc';

      // Both clients join
      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      // Simulate state divergence by having client1 disconnect during operation
      const operation = {
        type: 'insert',
        position: 0,
        content: 'Divergent content',
        userId: 'consistency-user-1',
        timestamp: new Date(),
        version: 1
      };

      client1.socket.emit('operation', operation);
      
      // Disconnect client1 immediately to simulate partial operation
      client1.socket.disconnect();

      // Client2 makes different changes
      client2.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: 'Different content',
        userId: 'consistency-user-2',
        timestamp: new Date(),
        version: 1
      });
      await testSetup.waitForEvent(client2, 'operation_applied');

      // Client1 reconnects
      client1.socket.connect();
      await new Promise<void>((resolve) => {
        client1.socket.on('connect', () => resolve());
      });

      client1.socket.emit('authenticate', { userId: 'consistency-user-1', name: 'Consistency User 1' });
      await testSetup.waitForEvent(client1, 'authenticated');

      client1.socket.emit('join_document', { documentId });
      
      // Should trigger consistency check and resolution
      const consistencyResolution = await testSetup.waitForEvent(client1, 'consistency_resolved');
      expect(consistencyResolution).toMatchObject({
        resolved: true,
        finalVersion: expect.any(Number),
        conflictsResolved: expect.any(Number)
      });

      client1.disconnect();
      client2.disconnect();
    });
  });
});