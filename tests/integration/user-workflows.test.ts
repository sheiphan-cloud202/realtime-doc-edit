import { IntegrationTestSetup, TestServer, TestClient } from './setup';
import { Operation } from '../../shared/types';

describe('User Workflows Integration Tests', () => {
  let testSetup: IntegrationTestSetup;
  let server: TestServer;

  beforeAll(async () => {
    testSetup = new IntegrationTestSetup();
    server = await testSetup.createTestServer();
  });

  afterAll(async () => {
    await testSetup.cleanup();
  });

  describe('Complete User Journey: Join, Edit, AI Assist, Leave', () => {
    it('should handle complete user workflow successfully', async () => {
      const client = await testSetup.createTestClient(server.port, 'user1');
      const documentId = 'test-doc-1';

      // Step 1: Join document
      client.socket.emit('join_document', { documentId });
      const joinResponse = await testSetup.waitForEvent(client, 'document_joined');
      
      expect(joinResponse).toMatchObject({
        documentId,
        content: expect.any(String),
        version: expect.any(Number),
        collaborators: expect.any(Array)
      });

      // Step 2: Make text edit
      const editOperation: Operation = {
        type: 'insert',
        position: 0,
        content: 'Hello World',
        userId: 'user1',
        timestamp: new Date(),
        version: joinResponse.version + 1
      };

      client.socket.emit('operation', editOperation);
      const operationAck = await testSetup.waitForEvent(client, 'operation_applied');
      
      expect(operationAck).toMatchObject({
        success: true,
        version: editOperation.version
      });

      // Step 3: Select text and use AI assist
      const aiRequest = {
        documentId,
        selectedText: 'Hello World',
        prompt: 'Make this more formal',
        selectionStart: 0,
        selectionEnd: 11
      };

      client.socket.emit('ai_request', aiRequest);
      const aiResponse = await testSetup.waitForEvent(client, 'ai_response', 10000);
      
      expect(aiResponse).toMatchObject({
        requestId: expect.any(String),
        result: expect.any(String),
        status: 'completed'
      });

      // Step 4: Accept AI changes
      client.socket.emit('accept_ai_changes', { requestId: aiResponse.requestId });
      const changesApplied = await testSetup.waitForEvent(client, 'ai_changes_applied');
      
      expect(changesApplied).toMatchObject({
        success: true,
        newVersion: expect.any(Number)
      });

      // Step 5: Leave document
      client.socket.emit('leave_document', { documentId });
      const leaveResponse = await testSetup.waitForEvent(client, 'document_left');
      
      expect(leaveResponse).toMatchObject({
        documentId,
        success: true
      });

      client.disconnect();
    });

    it('should handle user workflow with undo/redo operations', async () => {
      const client = await testSetup.createTestClient(server.port, 'user2');
      const documentId = 'test-doc-2';

      // Join document
      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Make multiple edits
      const operations = [
        { type: 'insert', position: 0, content: 'First edit', userId: 'user2' },
        { type: 'insert', position: 10, content: ' Second edit', userId: 'user2' },
        { type: 'insert', position: 22, content: ' Third edit', userId: 'user2' }
      ];

      for (const op of operations) {
        client.socket.emit('operation', op);
        await testSetup.waitForEvent(client, 'operation_applied');
      }

      // Undo last operation
      client.socket.emit('undo');
      const undoResponse = await testSetup.waitForEvent(client, 'operation_applied');
      expect(undoResponse.success).toBe(true);

      // Redo operation
      client.socket.emit('redo');
      const redoResponse = await testSetup.waitForEvent(client, 'operation_applied');
      expect(redoResponse.success).toBe(true);

      client.disconnect();
    });
  });

  describe('Error Handling in User Workflows', () => {
    it('should handle invalid document access gracefully', async () => {
      const client = await testSetup.createTestClient(server.port, 'user3');
      
      // Try to join non-existent document with invalid permissions
      client.socket.emit('join_document', { documentId: 'invalid-doc-id' });
      const errorResponse = await testSetup.waitForEvent(client, 'error');
      
      expect(errorResponse).toMatchObject({
        type: 'document_access_error',
        message: expect.any(String)
      });

      client.disconnect();
    });

    it('should handle AI service failures gracefully', async () => {
      const client = await testSetup.createTestClient(server.port, 'user4');
      const documentId = 'test-doc-3';

      // Join document and add content
      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Simulate AI service failure by sending invalid request
      const invalidAiRequest = {
        documentId,
        selectedText: '', // Empty selection should cause error
        prompt: 'Test prompt',
        selectionStart: 0,
        selectionEnd: 0
      };

      client.socket.emit('ai_request', invalidAiRequest);
      const aiError = await testSetup.waitForEvent(client, 'ai_error');
      
      expect(aiError).toMatchObject({
        type: 'invalid_selection',
        message: expect.any(String)
      });

      client.disconnect();
    });
  });

  describe('Performance Benchmarks', () => {
    it('should handle rapid sequential operations within performance limits', async () => {
      const client = await testSetup.createTestClient(server.port, 'user5');
      const documentId = 'test-doc-4';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      const startTime = Date.now();
      const operationCount = 100;
      const operations = [];

      // Send 100 rapid operations
      for (let i = 0; i < operationCount; i++) {
        const operation = {
          type: 'insert',
          position: i,
          content: `${i}`,
          userId: 'user5',
          timestamp: new Date(),
          version: i + 1
        };
        operations.push(operation);
        client.socket.emit('operation', operation);
      }

      // Wait for all operations to be processed
      let processedCount = 0;
      await new Promise<void>((resolve) => {
        client.socket.on('operation_applied', () => {
          processedCount++;
          if (processedCount === operationCount) {
            resolve();
          }
        });
      });

      const endTime = Date.now();
      const totalTime = endTime - startTime;
      const avgLatency = totalTime / operationCount;

      // Performance requirement: sub-100ms latency for text operations
      expect(avgLatency).toBeLessThan(100);
      console.log(`Average operation latency: ${avgLatency}ms`);

      client.disconnect();
    });

    it('should maintain performance with large document content', async () => {
      const client = await testSetup.createTestClient(server.port, 'user6');
      const documentId = 'test-doc-5';

      client.socket.emit('join_document', { documentId });
      await testSetup.waitForEvent(client, 'document_joined');

      // Create large document content (1MB)
      const largeContent = 'A'.repeat(1024 * 1024);
      const startTime = Date.now();

      const operation = {
        type: 'insert',
        position: 0,
        content: largeContent,
        userId: 'user6',
        timestamp: new Date(),
        version: 1
      };

      client.socket.emit('operation', operation);
      await testSetup.waitForEvent(client, 'operation_applied');

      const endTime = Date.now();
      const processingTime = endTime - startTime;

      // Should handle large documents within reasonable time (< 1 second)
      expect(processingTime).toBeLessThan(1000);
      console.log(`Large document processing time: ${processingTime}ms`);

      client.disconnect();
    });
  });
});