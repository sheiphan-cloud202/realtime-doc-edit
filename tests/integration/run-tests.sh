#!/bin/bash

# Integration Test Runner Script
# This script sets up the environment and runs comprehensive integration tests

set -e

echo "🚀 Starting Integration Test Suite"
echo "=================================="

# Check if Redis is running
echo "📋 Checking Redis availability..."
if ! redis-cli ping > /dev/null 2>&1; then
    echo "❌ Redis is not running. Please start Redis server first."
    echo "   On macOS: brew services start redis"
    echo "   On Linux: sudo systemctl start redis"
    exit 1
fi
echo "✅ Redis is available"

# Install dependencies if needed
if [ ! -d "node_modules" ]; then
    echo "📦 Installing integration test dependencies..."
    npm install
fi

# Build the project
echo "🔨 Building project..."
cd ../../
npm run build
cd tests/integration

# Set environment variables for testing
export NODE_ENV=test
export REDIS_DB=1
export LOG_LEVEL=error

echo "🧪 Running Integration Tests..."
echo ""

# Run different test suites
echo "1️⃣  Running User Workflow Tests..."
npm run test:workflows

echo ""
echo "2️⃣  Running Multi-User Scenario Tests..."
npm run test:multi-user

echo ""
echo "3️⃣  Running Network Failure Recovery Tests..."
npm run test:network

echo ""
echo "4️⃣  Running Performance Benchmark Tests..."
npm run test:performance

echo ""
echo "📊 Generating Coverage Report..."
npm run test:coverage

echo ""
echo "✅ All Integration Tests Completed!"
echo "📈 Coverage report available in tests/integration/coverage/"
echo ""

# Optional: Open coverage report
if command -v open > /dev/null 2>&1; then
    echo "🌐 Opening coverage report..."
    open coverage/lcov-report/index.html
elif command -v xdg-open > /dev/null 2>&1; then
    echo "🌐 Opening coverage report..."
    xdg-open coverage/lcov-report/index.html
fi