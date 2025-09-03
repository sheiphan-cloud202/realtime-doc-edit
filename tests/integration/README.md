# Integration Tests

This directory contains comprehensive integration tests for the Realtime AI Document Editor. These tests validate complete user workflows, multi-user scenarios, network failure recovery, and performance benchmarks.

## Test Structure

### Test Suites

1. **User Workflows** (`user-workflows.test.ts`)
   - Complete user journey: join, edit, AI assist, leave
   - Undo/redo operations
   - Error handling scenarios
   - Performance validation for individual users

2. **Multi-User Scenarios** (`multi-user-scenarios.test.ts`)
   - Concurrent editing from multiple users
   - Operational transformation conflict resolution
   - Concurrent AI requests
   - User presence and collaboration features
   - Scalability stress tests

3. **Network Failure Recovery** (`network-failure-recovery.test.ts`)
   - Client disconnection and reconnection
   - Offline operation queuing and sync
   - Server failure recovery
   - AI service failure handling
   - Data consistency resolution

4. **Performance Benchmarks** (`performance-benchmarks.test.ts`)
   - Latency measurements for text operations
   - Throughput testing with concurrent users
   - Memory usage monitoring
   - Connection scaling tests
   - AI processing performance

## Requirements Validation

These integration tests validate all requirements from the specification:

### Requirement 1: AI Text Selection and Editing
- ✅ Text selection and AI prompt functionality
- ✅ AI content replacement for selected text only
- ✅ Loading indicators during AI processing

### Requirement 2: Real-time Collaboration
- ✅ Real-time change synchronization
- ✅ Operational transformation for conflict resolution
- ✅ Cursor and selection tracking
- ✅ Automatic conflict resolution

### Requirement 3: User Presence and Coordination
- ✅ Active collaborator display
- ✅ Cursor position and name display
- ✅ AI editing status broadcasting
- ✅ User join/leave notifications

### Requirement 4: Network Resilience
- ✅ Offline operation queuing
- ✅ Reconnection and sync
- ✅ Conflict resolution after reconnection
- ✅ AI request retry mechanisms

### Requirement 5: Editorial Control
- ✅ AI suggestion accept/reject
- ✅ Undo/redo for AI changes
- ✅ Individual AI edit tracking

### Requirement 6: Performance and Scalability
- ✅ Sub-100ms latency for text operations
- ✅ AI request queuing and processing
- ✅ Memory management for long sessions
- ✅ Connection scaling and load balancing

## Setup and Prerequisites

### Required Services

1. **Redis Server**
   ```bash
   # macOS
   brew install redis
   brew services start redis
   
   # Linux
   sudo apt-get install redis-server
   sudo systemctl start redis
   ```

2. **Node.js Dependencies**
   ```bash
   npm run install:all
   ```

### Environment Configuration

The tests use the following environment variables:
- `NODE_ENV=test`
- `REDIS_DB=1` (separate test database)
- `LOG_LEVEL=error` (reduce test noise)

## Running Tests

### Full Test Suite
```bash
# Run all integration tests with setup and reporting
npm run test:integration

# Quick run without setup script
npm run test:integration:quick
```

### Individual Test Suites
```bash
# User workflow tests
npm run test:workflows

# Multi-user scenario tests
npm run test:multi-user

# Network failure recovery tests
npm run test:network

# Performance benchmark tests
npm run test:performance
```

### Development Testing
```bash
cd tests/integration

# Watch mode for development
npm run test:watch

# Coverage report
npm run test:coverage
```

## Test Configuration

### Jest Configuration
- **Timeout**: 60 seconds per test (for AI processing)
- **Workers**: 1 (sequential execution to avoid port conflicts)
- **Environment**: Node.js
- **Coverage**: Includes backend, frontend, and shared code

### Test Setup
- Redis test database (DB 1) is used and cleaned between test runs
- Mock AI responses for consistent testing
- Automatic server and client cleanup after each test

## Performance Benchmarks

The performance tests establish baseline metrics:

### Latency Requirements
- **Average latency**: < 100ms for text operations
- **95th percentile**: < 200ms
- **High load degradation**: < 300% increase

### Throughput Requirements
- **Concurrent operations**: > 100 ops/sec
- **Multi-user scaling**: Linear scaling up to 20 users
- **Document size**: < 5x latency increase for large documents

### Memory Requirements
- **Long sessions**: < 100MB heap usage
- **Connection scaling**: < 1 second average connection time

### AI Processing Requirements
- **Concurrent requests**: < 10 seconds average processing time
- **Success rate**: 100% for valid requests
- **Rate limiting**: Graceful handling of limits

## Troubleshooting

### Common Issues

1. **Redis Connection Errors**
   ```bash
   # Check Redis status
   redis-cli ping
   
   # Start Redis if not running
   brew services start redis  # macOS
   sudo systemctl start redis # Linux
   ```

2. **Port Conflicts**
   - Tests use random ports to avoid conflicts
   - If issues persist, run tests sequentially: `--maxWorkers=1`

3. **Timeout Errors**
   - AI processing tests have longer timeouts (30s)
   - Network tests simulate delays and may take time
   - Increase timeout in jest.config.js if needed

4. **Memory Issues**
   - Tests clean up resources automatically
   - If memory leaks occur, check for unclosed connections
   - Use `--detectOpenHandles` to identify issues

### Debug Mode

Enable verbose logging:
```bash
export LOG_LEVEL=debug
npm run test:integration
```

## Continuous Integration

These tests are designed to run in CI environments:

```yaml
# Example GitHub Actions configuration
- name: Start Redis
  run: |
    sudo apt-get install redis-server
    sudo systemctl start redis

- name: Run Integration Tests
  run: npm run test:integration
  env:
    NODE_ENV: test
    REDIS_DB: 1
```

## Contributing

When adding new integration tests:

1. Follow the existing test structure and naming conventions
2. Use the `IntegrationTestSetup` class for consistent setup/teardown
3. Include performance assertions where applicable
4. Add appropriate timeouts for async operations
5. Clean up resources in test teardown
6. Update this README with new test descriptions

## Test Data and Mocking

- AI responses are mocked for consistent testing
- Redis uses a separate test database (DB 1)
- WebSocket connections use random ports
- Test documents are automatically cleaned up
- User sessions are isolated per test