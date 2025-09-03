# Monitoring and Logging System

This directory contains the complete monitoring and logging infrastructure for the Realtime AI Document Editor. The system provides comprehensive observability through metrics collection, logging, health checks, and alerting.

## Architecture Overview

```
┌─────────────────┐    ┌─────────────────┐    ┌─────────────────┐
│   Application   │───▶│   Prometheus    │───▶│     Grafana     │
│                 │    │                 │    │                 │
│ - Metrics API   │    │ - Metrics Store │    │ - Dashboards    │
│ - Health Checks │    │ - Alerting      │    │ - Visualization │
│ - Logging       │    │                 │    │                 │
└─────────────────┘    └─────────────────┘    └─────────────────┘
         │                       │
         │                       ▼
         │              ┌─────────────────┐
         │              │  AlertManager   │
         │              │                 │
         │              │ - Alert Routing │
         │              │ - Notifications │
         │              │                 │
         │              └─────────────────┘
         │
         ▼
┌─────────────────┐
│   Log Files     │
│                 │
│ - app.log       │
│ - error.log     │
│ - performance.log│
│ - audit.log     │
└─────────────────┘
```

## Components

### 1. Application Monitoring

#### Logger (`backend/src/utils/Logger.ts`)
- **Structured Logging**: JSON-formatted logs with metadata
- **Log Levels**: ERROR, WARN, INFO, DEBUG
- **Specialized Methods**: User actions, performance, AI requests, WebSocket events
- **File Output**: Separate log files for different types of events
- **Performance Metrics**: Built-in performance tracking and aggregation

#### MetricsCollector (`backend/src/utils/MetricsCollector.ts`)
- **Counter Metrics**: Incrementing values (requests, errors, connections)
- **Gauge Metrics**: Point-in-time values (memory usage, active users)
- **Histogram Metrics**: Distribution tracking (latencies, response times)
- **System Metrics**: Automatic collection of memory, CPU, and application metrics
- **Prometheus Export**: Native Prometheus format support

#### HealthController (`backend/src/controllers/HealthController.ts`)
- **Basic Health Check**: `/health` - Overall system status
- **Detailed Health Check**: `/health/detailed` - Comprehensive system information
- **Readiness Probe**: `/health/ready` - Kubernetes readiness check
- **Liveness Probe**: `/health/live` - Kubernetes liveness check
- **Metrics Endpoint**: `/metrics` - Prometheus metrics and JSON format
- **Performance Metrics**: `/metrics/performance` - Application performance data

### 2. External Monitoring Stack

#### Prometheus
- **Metrics Collection**: Scrapes application metrics every 15 seconds
- **Alerting Rules**: Comprehensive alert definitions for various failure scenarios
- **Data Retention**: 200 hours of metrics data
- **Service Discovery**: Automatic discovery of application instances

#### Grafana
- **Dashboards**: Pre-configured dashboard for system monitoring
- **Visualization**: Real-time charts and graphs
- **Alerting**: Visual alerts and notifications
- **User Management**: Role-based access control

#### AlertManager
- **Alert Routing**: Routes alerts based on severity and type
- **Notification Channels**: Email, Slack, webhook support
- **Alert Grouping**: Groups related alerts to reduce noise
- **Silencing**: Temporary alert suppression

## Metrics Collected

### System Metrics
- **Memory Usage**: Heap used/total, external memory, RSS
- **CPU Usage**: User and system CPU time
- **Process Metrics**: Uptime, process ID, Node.js version

### Application Metrics
- **WebSocket Connections**: Active connections, total connections, connection rate
- **Document Operations**: Operation count by type, operation latency, operation rate
- **AI Requests**: Request count by status, processing time, queue size, success rate
- **HTTP Requests**: Request count by method/status, response time, error rate

### Business Metrics
- **Active Documents**: Number of documents being edited
- **Active Users**: Number of connected users
- **Collaboration Events**: User joins/leaves, cursor updates, presence changes

## Health Checks

### Readiness Checks
- **Redis Connectivity**: Verifies Redis connection and response
- **Memory Usage**: Ensures memory usage is within acceptable limits
- **Disk Space**: Checks available disk space

### Liveness Checks
- **Process Responsiveness**: Verifies the application is responding
- **Memory Leaks**: Detects excessive memory usage
- **Critical Failures**: Identifies unrecoverable errors

### Detailed Health Checks
- **All Readiness/Liveness Checks**: Complete system validation
- **External Dependencies**: AI service health, database connectivity
- **Performance Metrics**: Current performance statistics
- **Resource Usage**: Detailed resource consumption

## Alerting Rules

### Critical Alerts
- **Service Down**: Application is not responding
- **Critical Memory Usage**: Memory usage > 90%
- **Redis Connection Failed**: Cannot connect to Redis
- **AI Service Down**: No AI requests processed for 10+ minutes

### Warning Alerts
- **High Memory Usage**: Memory usage > 80%
- **High WebSocket Connections**: > 1000 active connections
- **High Document Operation Latency**: 95th percentile > 500ms
- **AI Service High Latency**: 95th percentile > 10 seconds
- **AI Service Low Success Rate**: Success rate < 90%
- **High Error Rate**: HTTP errors > 10/sec, WebSocket errors > 5/sec
- **Performance Degradation**: HTTP latency 95th percentile > 2 seconds

## Setup and Deployment

### Local Development

1. **Start the monitoring stack**:
   ```bash
   cd monitoring
   docker-compose up -d
   ```

2. **Access monitoring interfaces**:
   - Prometheus: http://localhost:9090
   - Grafana: http://localhost:3000 (admin/admin)
   - AlertManager: http://localhost:9093

3. **Start the application with monitoring**:
   ```bash
   npm run dev:backend
   ```

### Production Deployment

1. **Environment Variables**:
   ```bash
   export LOG_LEVEL=info
   export PROMETHEUS_ENABLED=true
   export METRICS_PORT=3001
   ```

2. **Configure external services**:
   - Update `prometheus.yml` with production targets
   - Configure AlertManager with production notification channels
   - Set up Grafana with proper authentication

3. **Deploy monitoring stack**:
   ```bash
   docker-compose -f docker-compose.prod.yml up -d
   ```

### Kubernetes Deployment

1. **Health Check Configuration**:
   ```yaml
   livenessProbe:
     httpGet:
       path: /health/live
       port: 3001
     initialDelaySeconds: 30
     periodSeconds: 10
   
   readinessProbe:
     httpGet:
       path: /health/ready
       port: 3001
     initialDelaySeconds: 5
     periodSeconds: 5
   ```

2. **Service Monitor for Prometheus**:
   ```yaml
   apiVersion: monitoring.coreos.com/v1
   kind: ServiceMonitor
   metadata:
     name: realtime-doc-editor
   spec:
     selector:
       matchLabels:
         app: realtime-doc-editor
     endpoints:
     - port: metrics
       path: /metrics
       params:
         format: ['prometheus']
   ```

## Log Management

### Log Files
- **app.log**: General application logs
- **error.log**: Error-specific logs with stack traces
- **performance.log**: Performance metrics and timing data
- **audit.log**: User actions and security events

### Log Rotation
Configure log rotation to prevent disk space issues:

```bash
# /etc/logrotate.d/realtime-doc-editor
/path/to/logs/*.log {
    daily
    missingok
    rotate 30
    compress
    delaycompress
    notifempty
    create 644 app app
    postrotate
        systemctl reload realtime-doc-editor
    endscript
}
```

### Centralized Logging (Optional)
For production environments, consider centralized logging:

1. **ELK Stack**: Elasticsearch, Logstash, Kibana
2. **Fluentd**: Log collection and forwarding
3. **Cloud Solutions**: AWS CloudWatch, Google Cloud Logging, Azure Monitor

## Performance Monitoring

### Key Performance Indicators (KPIs)
- **Response Time**: 95th percentile < 100ms for document operations
- **Throughput**: > 1000 operations/second under normal load
- **Availability**: > 99.9% uptime
- **Error Rate**: < 0.1% of total requests
- **AI Processing Time**: 95th percentile < 5 seconds

### Performance Benchmarks
Regular performance testing validates system performance:

```bash
# Run performance benchmarks
npm run test:performance

# Generate performance report
npm run test:integration -- --testNamePattern="Performance Benchmarks"
```

## Troubleshooting

### Common Issues

1. **High Memory Usage**:
   - Check for memory leaks in long-running sessions
   - Monitor document cache size
   - Review WebSocket connection cleanup

2. **High Latency**:
   - Check Redis connectivity and performance
   - Monitor AI service response times
   - Review operational transformation performance

3. **Connection Issues**:
   - Verify WebSocket connection limits
   - Check load balancer configuration
   - Monitor connection pooling

### Debug Mode
Enable detailed logging for troubleshooting:

```bash
export LOG_LEVEL=debug
npm run dev:backend
```

### Metrics Analysis
Use Grafana queries to analyze performance:

```promql
# Average response time by endpoint
rate(http_request_duration_sum[5m]) / rate(http_request_duration_count[5m])

# Error rate by service
rate(http_errors_total[5m]) / rate(http_requests_total[5m])

# WebSocket connection growth
increase(websocket_connections_total[1h])
```

## Security Considerations

### Metrics Security
- **Authentication**: Secure Prometheus and Grafana with authentication
- **Network Security**: Use TLS for metrics transmission
- **Access Control**: Limit access to monitoring interfaces

### Log Security
- **Sensitive Data**: Avoid logging sensitive information (passwords, tokens)
- **Log Integrity**: Implement log signing or immutable storage
- **Access Logging**: Log all access to monitoring systems

### Alert Security
- **Alert Channels**: Secure notification channels (encrypted email, authenticated webhooks)
- **Alert Content**: Avoid including sensitive data in alerts
- **False Positive Management**: Implement alert fatigue prevention

## Maintenance

### Regular Tasks
- **Log Cleanup**: Rotate and archive old logs
- **Metrics Cleanup**: Remove old metrics data
- **Dashboard Updates**: Keep dashboards current with application changes
- **Alert Tuning**: Adjust alert thresholds based on operational experience

### Monitoring the Monitoring
- **Prometheus Health**: Monitor Prometheus itself
- **Grafana Availability**: Ensure dashboard availability
- **AlertManager Status**: Verify alert delivery
- **Metrics Completeness**: Check for missing metrics

## Integration with CI/CD

### Automated Testing
```yaml
# GitHub Actions example
- name: Run Monitoring Tests
  run: |
    npm run test:integration -- --testNamePattern="Monitoring"
    npm run test:performance
```

### Deployment Validation
```bash
# Post-deployment health check
curl -f http://localhost:3001/health/ready || exit 1

# Metrics validation
curl -s http://localhost:3001/metrics | grep -q "websocket_connections_total" || exit 1
```

This comprehensive monitoring and logging system provides full observability into the Realtime AI Document Editor, enabling proactive issue detection, performance optimization, and reliable operation at scale.