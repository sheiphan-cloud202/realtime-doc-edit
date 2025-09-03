import { IntegrationTestSetup, TestServer, TestClient } from './setup';
import { Operation } from '../../shared/types';

describe('Performance Benchmarks Integration Tests', () => {
    let testSetup: IntegrationTestSetup;
    let server: TestServer;

    beforeAll(async () => {
        testSetup = new IntegrationTestSetup();
        server = await testSetup.createTestServer();
    });

    afterAll(async () => {
        await testSetup.cleanup();
    });

    describe('Latency Benchmarks', () => {
        it('should maintain sub-100ms latency for text operations under normal load', async () => {
            const client = await testSetup.createTestClient(server.port, 'latency-user');
            const documentId = 'latency-test-doc';

            client.socket.emit('join_document', { documentId });
            await testSetup.waitForEvent(client, 'document_joined');

            const operationCount = 100;
            const latencies: number[] = [];

            for (let i = 0; i < operationCount; i++) {
                const startTime = Date.now();

                const operation: Operation = {
                    type: 'insert',
                    position: i * 10,
                    content: `Op${i}`,
                    userId: 'latency-user',
                    timestamp: new Date(),
                    version: i + 1
                };

                client.socket.emit('operation', operation);
                await testSetup.waitForEvent(client, 'operation_applied');

                const endTime = Date.now();
                latencies.push(endTime - startTime);
            }

            const avgLatency = latencies.reduce((sum, lat) => sum + lat, 0) / latencies.length;
            const maxLatency = Math.max(...latencies);
            const p95Latency = latencies.sort((a, b) => a - b)[Math.floor(latencies.length * 0.95)];

            console.log(`Latency Benchmark Results:
        Average: ${avgLatency.toFixed(2)}ms
        Maximum: ${maxLatency}ms
        95th Percentile: ${p95Latency}ms`);

            // Performance requirements
            expect(avgLatency).toBeLessThan(100);
            expect(p95Latency).toBeLessThan(200);

            client.disconnect();
        });

        it('should handle high-frequency operations with acceptable latency degradation', async () => {
            const client = await testSetup.createTestClient(server.port, 'high-freq-user');
            const documentId = 'high-freq-doc';

            client.socket.emit('join_document', { documentId });
            await testSetup.waitForEvent(client, 'document_joined');

            const batchSizes = [10, 50, 100, 200];
            const results: { batchSize: number; avgLatency: number; throughput: number }[] = [];

            for (const batchSize of batchSizes) {
                const startTime = Date.now();
                const promises: Promise<void>[] = [];

                for (let i = 0; i < batchSize; i++) {
                    const promise = new Promise<void>((resolve) => {
                        const operation: Operation = {
                            type: 'insert',
                            position: i,
                            content: `B${batchSize}-${i}`,
                            userId: 'high-freq-user',
                            timestamp: new Date(),
                            version: i + 1
                        };

                        client.socket.emit('operation', operation);
                        client.socket.once('operation_applied', () => resolve());
                    });
                    promises.push(promise);
                }

                await Promise.all(promises);
                const endTime = Date.now();

                const totalTime = endTime - startTime;
                const avgLatency = totalTime / batchSize;
                const throughput = (batchSize / totalTime) * 1000; // ops per second

                results.push({ batchSize, avgLatency, throughput });

                console.log(`Batch ${batchSize}: ${avgLatency.toFixed(2)}ms avg latency, ${throughput.toFixed(2)} ops/sec`);
            }

            // Latency should not degrade too much with increased load
            const baselineLatency = results[0].avgLatency;
            const highLoadLatency = results[results.length - 1].avgLatency;
            const latencyIncrease = (highLoadLatency - baselineLatency) / baselineLatency;

            expect(latencyIncrease).toBeLessThan(3.0); // Less than 300% increase

            client.disconnect();
        });
    });

    describe('Throughput Benchmarks', () => {
        it('should handle concurrent operations from multiple users efficiently', async () => {
            const userCount = 20;
            const operationsPerUser = 25;
            const documentId = 'throughput-doc';

            const clients: TestClient[] = [];

            // Create multiple clients
            for (let i = 0; i < userCount; i++) {
                const client = await testSetup.createTestClient(server.port, `throughput-user-${i}`);
                clients.push(client);
            }

            // All clients join document
            const joinPromises = clients.map(client => {
                client.socket.emit('join_document', { documentId });
                return testSetup.waitForEvent(client, 'document_joined');
            });
            await Promise.all(joinPromises);

            const startTime = Date.now();
            const totalOperations = userCount * operationsPerUser;

            // Each client sends operations concurrently
            const operationPromises = clients.map((client, userIndex) => {
                return Promise.all(
                    Array.from({ length: operationsPerUser }, (_, opIndex) => {
                        return new Promise<void>((resolve) => {
                            const operation: Operation = {
                                type: 'insert',
                                position: userIndex * 1000 + opIndex * 10,
                                content: `U${userIndex}-O${opIndex}`,
                                userId: client.userId,
                                timestamp: new Date(),
                                version: userIndex * operationsPerUser + opIndex + 1
                            };

                            client.socket.emit('operation', operation);
                            client.socket.once('operation_applied', () => resolve());
                        });
                    })
                );
            });

            await Promise.all(operationPromises);
            const endTime = Date.now();

            const totalTime = endTime - startTime;
            const throughput = (totalOperations / totalTime) * 1000; // ops per second

            console.log(`Throughput Benchmark:
        Users: ${userCount}
        Operations per user: ${operationsPerUser}
        Total operations: ${totalOperations}
        Total time: ${totalTime}ms
        Throughput: ${throughput.toFixed(2)} ops/sec`);

            // Should handle at least 100 operations per second
            expect(throughput).toBeGreaterThan(100);

            // Cleanup
            clients.forEach(client => client.disconnect());
        });

        it('should maintain performance with large document sizes', async () => {
            const client = await testSetup.createTestClient(server.port, 'large-doc-user');
            const documentId = 'large-doc-test';

            client.socket.emit('join_document', { documentId });
            await testSetup.waitForEvent(client, 'document_joined');

            // Create progressively larger documents and measure performance
            const documentSizes = [1000, 10000, 100000, 500000]; // characters
            const results: { size: number; latency: number; memoryUsage?: number }[] = [];

            for (const targetSize of documentSizes) {
                // Build document to target size
                let currentSize = 0;
                const buildStartTime = Date.now();

                while (currentSize < targetSize) {
                    const chunkSize = Math.min(1000, targetSize - currentSize);
                    const content = 'A'.repeat(chunkSize);

                    const operation: Operation = {
                        type: 'insert',
                        position: currentSize,
                        content,
                        userId: 'large-doc-user',
                        timestamp: new Date(),
                        version: currentSize + 1
                    };

                    client.socket.emit('operation', operation);
                    await testSetup.waitForEvent(client, 'operation_applied');

                    currentSize += chunkSize;
                }

                const buildTime = Date.now() - buildStartTime;

                // Test operation latency on large document
                const testStartTime = Date.now();
                const testOperation: Operation = {
                    type: 'insert',
                    position: Math.floor(currentSize / 2),
                    content: 'TEST',
                    userId: 'large-doc-user',
                    timestamp: new Date(),
                    version: currentSize + 1000
                };

                client.socket.emit('operation', testOperation);
                await testSetup.waitForEvent(client, 'operation_applied');
                const testLatency = Date.now() - testStartTime;

                results.push({ size: currentSize, latency: testLatency });

                console.log(`Document size ${currentSize}: build time ${buildTime}ms, operation latency ${testLatency}ms`);
            }

            // Latency should not increase dramatically with document size
            const smallDocLatency = results[0].latency;
            const largeDocLatency = results[results.length - 1].latency;
            const latencyRatio = largeDocLatency / smallDocLatency;

            expect(latencyRatio).toBeLessThan(5.0); // Less than 5x increase

            client.disconnect();
        });
    });

    describe('Memory and Resource Benchmarks', () => {
        it('should manage memory efficiently during long-running sessions', async () => {
            const client = await testSetup.createTestClient(server.port, 'memory-test-user');
            const documentId = 'memory-test-doc';

            client.socket.emit('join_document', { documentId });
            await testSetup.waitForEvent(client, 'document_joined');

            const sessionDuration = 30000; // 30 seconds
            const operationInterval = 100; // 100ms between operations
            const startTime = Date.now();
            let operationCount = 0;

            // Simulate long-running editing session
            const sessionPromise = new Promise<void>((resolve) => {
                const interval = setInterval(() => {
                    if (Date.now() - startTime >= sessionDuration) {
                        clearInterval(interval);
                        resolve();
                        return;
                    }

                    const operation: Operation = {
                        type: 'insert',
                        position: operationCount * 5,
                        content: `Op${operationCount}`,
                        userId: 'memory-test-user',
                        timestamp: new Date(),
                        version: operationCount + 1
                    };

                    client.socket.emit('operation', operation);
                    operationCount++;
                }, operationInterval);
            });

            await sessionPromise;

            // Request memory usage statistics
            client.socket.emit('get_memory_stats');
            const memoryStats = await testSetup.waitForEvent(client, 'memory_stats');

            console.log(`Memory Usage After ${sessionDuration}ms session:
        Operations: ${operationCount}
        Heap Used: ${memoryStats.heapUsed / 1024 / 1024}MB
        Heap Total: ${memoryStats.heapTotal / 1024 / 1024}MB
        External: ${memoryStats.external / 1024 / 1024}MB`);

            // Memory usage should be reasonable (less than 100MB for test session)
            expect(memoryStats.heapUsed).toBeLessThan(100 * 1024 * 1024);

            client.disconnect();
        });

        it('should handle connection scaling efficiently', async () => {
            const maxConnections = 50;
            const documentId = 'scaling-test-doc';
            const clients: TestClient[] = [];

            const connectionTimes: number[] = [];

            // Create connections and measure connection time
            for (let i = 0; i < maxConnections; i++) {
                const startTime = Date.now();
                const client = await testSetup.createTestClient(server.port, `scaling-user-${i}`);
                const connectionTime = Date.now() - startTime;

                connectionTimes.push(connectionTime);
                clients.push(client);

                // Join document
                client.socket.emit('join_document', { documentId });
                await testSetup.waitForEvent(client, 'document_joined');

                if (i % 10 === 0) {
                    console.log(`Connected ${i + 1} clients, last connection time: ${connectionTime}ms`);
                }
            }

            const avgConnectionTime = connectionTimes.reduce((sum, time) => sum + time, 0) / connectionTimes.length;
            const maxConnectionTime = Math.max(...connectionTimes);

            console.log(`Connection Scaling Results:
        Total connections: ${maxConnections}
        Average connection time: ${avgConnectionTime.toFixed(2)}ms
        Maximum connection time: ${maxConnectionTime}ms`);

            // Connection time should not degrade significantly
            expect(avgConnectionTime).toBeLessThan(1000); // Less than 1 second average
            expect(maxConnectionTime).toBeLessThan(5000); // Less than 5 seconds maximum

            // Test broadcast performance with all connections
            const broadcastStartTime = Date.now();

            // One client sends operation, all others should receive it
            const operation: Operation = {
                type: 'insert',
                position: 0,
                content: 'Broadcast test',
                userId: 'scaling-user-0',
                timestamp: new Date(),
                version: 1
            };

            clients[0].socket.emit('operation', operation);

            // Wait for all other clients to receive the operation
            const receivePromises = clients.slice(1).map(client =>
                testSetup.waitForEvent(client, 'remote_operation')
            );

            await Promise.all(receivePromises);
            const broadcastTime = Date.now() - broadcastStartTime;

            console.log(`Broadcast to ${maxConnections - 1} clients took ${broadcastTime}ms`);

            // Broadcast should complete within reasonable time
            expect(broadcastTime).toBeLessThan(2000);

            // Cleanup
            clients.forEach(client => client.disconnect());
        });
    });

    describe('AI Processing Performance', () => {
        it('should handle concurrent AI requests efficiently', async () => {
            const userCount = 10;
            const requestsPerUser = 3;
            const documentId = 'ai-perf-doc';

            const clients: TestClient[] = [];

            // Create clients and join document
            for (let i = 0; i < userCount; i++) {
                const client = await testSetup.createTestClient(server.port, `ai-perf-user-${i}`);
                clients.push(client);

                client.socket.emit('join_document', { documentId });
                await testSetup.waitForEvent(client, 'document_joined');
            }

            // Add initial content
            const initialContent = 'This is test content for AI processing performance evaluation. '.repeat(10);
            clients[0].socket.emit('operation', {
                type: 'insert',
                position: 0,
                content: initialContent,
                userId: 'ai-perf-user-0',
                timestamp: new Date(),
                version: 1
            });

            await testSetup.waitForEvent(clients[0], 'operation_applied');

            // Wait for content to propagate to all clients
            await testSetup.simulateNetworkDelay(500);

            const startTime = Date.now();
            const aiRequestPromises: Promise<any>[] = [];

            // Send concurrent AI requests
            clients.forEach((client, userIndex) => {
                for (let reqIndex = 0; reqIndex < requestsPerUser; reqIndex++) {
                    const selectionStart = (userIndex * requestsPerUser + reqIndex) * 20;
                    const selectionEnd = selectionStart + 15;

                    const aiRequest = {
                        documentId,
                        selectedText: initialContent.substring(selectionStart, selectionEnd),
                        prompt: `Request ${userIndex}-${reqIndex}: improve this text`,
                        selectionStart,
                        selectionEnd
                    };

                    client.socket.emit('ai_request', aiRequest);
                    aiRequestPromises.push(testSetup.waitForEvent(client, 'ai_response', 30000));
                }
            });

            const responses = await Promise.all(aiRequestPromises);
            const endTime = Date.now();

            const totalTime = endTime - startTime;
            const totalRequests = userCount * requestsPerUser;
            const avgProcessingTime = totalTime / totalRequests;

            console.log(`AI Processing Performance:
        Concurrent users: ${userCount}
        Requests per user: ${requestsPerUser}
        Total requests: ${totalRequests}
        Total time: ${totalTime}ms
        Average processing time: ${avgProcessingTime.toFixed(2)}ms per request`);

            // Verify all requests completed successfully
            const successfulRequests = responses.filter(r => r.status === 'completed').length;
            expect(successfulRequests).toBe(totalRequests);

            // AI processing should complete within reasonable time
            expect(avgProcessingTime).toBeLessThan(10000); // Less than 10 seconds per request

            // Cleanup
            clients.forEach(client => client.disconnect());
        });
    });
});