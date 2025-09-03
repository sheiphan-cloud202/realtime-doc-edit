import { IntegrationTestSetup, TestServer, TestClient } from './setup';
import { Operation } from '../../shared/types';

describe('Multi-User Scenarios Integration Tests', () => {
  let testSetup: IntegrationTestSetup;
  let server: TestServer;

  beforeAll(async () => {
    testSetup = new IntegrationTestSetup();
    server = await testSetup.createTestServer();
  });

  afterAll(async () => {
    await testSetup.cleanup();
  });

  describe('Concurrent Editing Scenarios', () => {
    it('should handle simultaneous edits from multiple users', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'user1');
      const client2 = await testSetup.createTestClient(server.port, 'user2');
      const documentId = 'multi-user-doc-1';

      // Both users join the same document
      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      // Verify both users see each other as collaborators
      const collaborators1 = await testSetup.waitForEvent(client1, 'collaborators_updated');
      const collaborators2 = await testSetup.waitForEvent(client2, 'collaborators_updated');

      expect(collaborators1.collaborators).toHaveLength(2);
      expect(collaborators2.collaborators).toHaveLength(2);

      // Simultaneous edits at different positions
      const operation1: Operation = {
        type: 'insert',
        position: 0,
        content: 'User1 edit',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      const operation2: Operation = {
        type: 'insert',
        position: 100,
        content: 'User2 edit',
        userId: 'user2',
        timestamp: new Date(),
        version: 1
      };

      // Send operations simultaneously
      client1.socket.emit('operation', operation1);
      client2.socket.emit('operation', operation2);

      // Both operations should be applied successfully
      await testSetup.waitForEvent(client1, 'operation_applied');
      await testSetup.waitForEvent(client2, 'operation_applied');

      // Both users should receive the other's operation
      const remoteOp1 = await testSetup.waitForEvent(client1, 'remote_operation');
      const remoteOp2 = await testSetup.waitForEvent(client2, 'remote_operation');

      expect(remoteOp1.userId).toBe('user2');
      expect(remoteOp2.userId).toBe('user1');

      client1.disconnect();
      client2.disconnect();
    });

    it('should resolve conflicts using operational transformation', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'user1');
      const client2 = await testSetup.createTestClient(server.port, 'user2');
      const documentId = 'conflict-doc-1';

      // Both users join document
      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      // Create conflicting operations at the same position
      const conflictOp1: Operation = {
        type: 'insert',
        position: 0,
        content: 'Conflict A',
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      };

      const conflictOp2: Operation = {
        type: 'insert',
        position: 0,
        content: 'Conflict B',
        userId: 'user2',
        timestamp: new Date(),
        version: 1
      };

      // Send conflicting operations
      client1.socket.emit('operation', conflictOp1);
      client2.socket.emit('operation', conflictOp2);

      // Wait for conflict resolution
      const resolution1 = await testSetup.waitForEvent(client1, 'conflict_resolved');
      const resolution2 = await testSetup.waitForEvent(client2, 'conflict_resolved');

      // Both clients should have consistent final state
      expect(resolution1.finalContent).toBe(resolution2.finalContent);
      expect(resolution1.version).toBe(resolution2.version);

      client1.disconnect();
      client2.disconnect();
    });

    it('should handle concurrent AI requests from multiple users', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'user1');
      const client2 = await testSetup.createTestClient(server.port, 'user2');
      const documentId = 'ai-concurrent-doc-1';

      // Setup document with initial content
      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      // Add initial content
      const initialContent = 'This is a test document for AI editing.';
      client1.socket.emit('operation', {
        type: 'insert',
        position: 0,
        content: initialContent,
        userId: 'user1',
        timestamp: new Date(),
        version: 1
      });

      await testSetup.waitForEvent(client1, 'operation_applied');
      await testSetup.waitForEvent(client2, 'remote_operation');

      // Concurrent AI requests on different text selections
      const aiRequest1 = {
        documentId,
        selectedText: 'This is a test',
        prompt: 'Make this more formal',
        selectionStart: 0,
        selectionEnd: 14
      };

      const aiRequest2 = {
        documentId,
        selectedText: 'document for AI editing',
        prompt: 'Make this more technical',
        selectionStart: 17,
        selectionEnd: 40
      };

      // Send AI requests simultaneously
      client1.socket.emit('ai_request', aiRequest1);
      client2.socket.emit('ai_request', aiRequest2);

      // Both requests should be processed
      const aiResponse1 = await testSetup.waitForEvent(client1, 'ai_response', 15000);
      const aiResponse2 = await testSetup.waitForEvent(client2, 'ai_response', 15000);

      expect(aiResponse1.status).toBe('completed');
      expect(aiResponse2.status).toBe('completed');
      expect(aiResponse1.result).toBeDefined();
      expect(aiResponse2.result).toBeDefined();

      client1.disconnect();
      client2.disconnect();
    });
  });

  describe('User Presence and Collaboration Features', () => {
    it('should track cursor positions and selections across users', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'user1');
      const client2 = await testSetup.createTestClient(server.port, 'user2');
      const documentId = 'presence-doc-1';

      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      // User1 updates cursor position
      client1.socket.emit('cursor_update', {
        documentId,
        position: 10,
        selection: { start: 5, end: 15 }
      });

      // User2 should receive cursor update
      const cursorUpdate = await testSetup.waitForEvent(client2, 'cursor_updated');
      expect(cursorUpdate).toMatchObject({
        userId: 'user1',
        position: 10,
        selection: { start: 5, end: 15 }
      });

      client1.disconnect();
      client2.disconnect();
    });

    it('should handle user join/leave notifications', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'user1');
      const documentId = 'join-leave-doc-1';

      client1.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client1, 'document_joined');

      // Second user joins
      const client2 = await testSetup.createTestClient(server.port, 'user2');
      client2.socket.emit('join_document', { documentId });

      // First user should be notified of new collaborator
      const userJoined = await testSetup.waitForEvent(client1, 'user_joined');
      expect(userJoined).toMatchObject({
        userId: 'user2',
        name: expect.any(String)
      });

      // Second user leaves
      client2.disconnect();

      // First user should be notified of user leaving
      const userLeft = await testSetup.waitForEvent(client1, 'user_left');
      expect(userLeft).toMatchObject({
        userId: 'user2'
      });

      client1.disconnect();
    });
  });

  describe('Scalability Tests', () => {
    it('should handle multiple concurrent users (stress test)', async () => {
      const documentId = 'stress-test-doc-1';
      const userCount = 10;
      const clients: TestClient[] = [];

      // Create multiple clients
      for (let i = 0; i < userCount; i++) {
        const client = await testSetup.createTestClient(server.port, `stress-user-${i}`);
        clients.push(client);
      }

      // All users join the same document
      const joinPromises = clients.map(client => {
        client.socket.emit('join_document', { documentId });
        return testSetup.waitForEvent(client, 'document_joined');
      });

      await Promise.all(joinPromises);

      // Each user makes multiple operations
      const operationPromises = clients.map((client, index) => {
        return new Promise<void>((resolve) => {
          let opsCompleted = 0;
          const totalOps = 5;

          client.socket.on('operation_applied', () => {
            opsCompleted++;
            if (opsCompleted === totalOps) {
              resolve();
            }
          });

          // Send operations
          for (let i = 0; i < totalOps; i++) {
            client.socket.emit('operation', {
              type: 'insert',
              position: index * 100 + i * 10,
              content: `User${index}-Op${i}`,
              userId: client.userId,
              timestamp: new Date(),
              version: index * totalOps + i + 1
            });
          }
        });
      });

      const startTime = Date.now();
      await Promise.all(operationPromises);
      const endTime = Date.now();

      const totalTime = endTime - startTime;
      console.log(`Stress test completed in ${totalTime}ms with ${userCount} users`);

      // Should complete within reasonable time (< 5 seconds)
      expect(totalTime).toBeLessThan(5000);

      // Cleanup
      clients.forEach(client => client.disconnect());
    });

    it('should maintain performance with high-frequency operations', async () => {
      const client1 = await testSetup.createTestClient(server.port, 'perf-user-1');
      const client2 = await testSetup.createTestClient(server.port, 'perf-user-2');
      const documentId = 'perf-test-doc-1';

      client1.socket.emit('join_document', { documentId });
      client2.socket.emit('join_document', { documentId });

      await testSetup.waitForEvent(client1, 'document_joined');
      await testSetup.waitForEvent(client2, 'document_joined');

      const operationsPerUser = 50;
      const startTime = Date.now();

      // High-frequency operations from both users
      const promises = [client1, client2].map((client, userIndex) => {
        return new Promise<void>((resolve) => {
          let opsCompleted = 0;

          client.socket.on('operation_applied', () => {
            opsCompleted++;
            if (opsCompleted === operationsPerUser) {
              resolve();
            }
          });

          // Rapid-fire operations
          for (let i = 0; i < operationsPerUser; i++) {
            setTimeout(() => {
              client.socket.emit('operation', {
                type: 'insert',
                position: userIndex * 1000 + i,
                content: `${client.userId}-${i}`,
                userId: client.userId,
                timestamp: new Date(),
                version: userIndex * operationsPerUser + i + 1
              });
            }, i * 10); // 10ms intervals
          }
        });
      });

      await Promise.all(promises);
      const endTime = Date.now();

      const totalTime = endTime - startTime;
      const totalOperations = operationsPerUser * 2;
      const avgLatency = totalTime / totalOperations;

      console.log(`High-frequency test: ${totalOperations} ops in ${totalTime}ms, avg latency: ${avgLatency}ms`);

      // Performance requirement: maintain sub-100ms average latency
      expect(avgLatency).toBeLessThan(100);

      client1.disconnect();
      client2.disconnect();
    });
  });
});