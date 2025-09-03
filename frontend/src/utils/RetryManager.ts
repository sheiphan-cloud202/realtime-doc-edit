export interface RetryConfig {
  maxRetries: number;
  baseDelay: number;
  maxDelay: number;
  backoffFactor: number;
  retryCondition?: (error: Error) => boolean;
}

export interface RetryAttempt {
  attempt: number;
  error: Error;
  nextRetryIn: number;
}

export class RetryManager {
  private static readonly DEFAULT_CONFIG: RetryConfig = {
    maxRetries: 3,
    baseDelay: 1000,
    maxDelay: 30000,
    backoffFactor: 2,
    retryCondition: (error: Error) => {
      // Handle non-Error objects
      if (!error || typeof error !== 'object') {
        return false;
      }
      
      const message = error.message || '';
      const name = error.name || '';
      
      // Retry on network errors, timeouts, and server errors
      return message.includes('network') ||
             message.includes('timeout') ||
             message.includes('fetch') ||
             message.includes('500') ||
             message.includes('502') ||
             message.includes('503') ||
             message.includes('504') ||
             name.includes('NetworkError') ||
             name.includes('TimeoutError');
    }
  };

  /**
   * Execute a function with retry logic
   */
  public static async executeWithRetry<T>(
    operation: () => Promise<T>,
    config: Partial<RetryConfig> = {},
    onRetry?: (attempt: RetryAttempt) => void
  ): Promise<T> {
    const finalConfig = { ...this.DEFAULT_CONFIG, ...config };
    let lastError: Error = new Error('Unknown error');

    for (let attempt = 0; attempt <= finalConfig.maxRetries; attempt++) {
      try {
        return await operation();
      } catch (error) {
        lastError = error as Error;

        // Don't retry if this is the last attempt
        if (attempt === finalConfig.maxRetries) {
          break;
        }

        // Check if we should retry this error
        if (finalConfig.retryCondition && !finalConfig.retryCondition(lastError)) {
          break;
        }

        // Calculate delay with exponential backoff
        const delay = Math.min(
          finalConfig.baseDelay * Math.pow(finalConfig.backoffFactor, attempt),
          finalConfig.maxDelay
        );

        // Add jitter to prevent thundering herd
        const jitteredDelay = delay + Math.random() * 1000;

        // Notify about retry attempt
        if (onRetry) {
          onRetry({
            attempt: attempt + 1,
            error: lastError,
            nextRetryIn: jitteredDelay
          });
        }

        // Wait before retrying
        await this.delay(jitteredDelay);
      }
    }

    throw lastError;
  }

  /**
   * Create a retry wrapper for a function
   */
  public static createRetryWrapper<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    config: Partial<RetryConfig> = {}
  ): (...args: T) => Promise<R> {
    return async (...args: T): Promise<R> => {
      return this.executeWithRetry(() => fn(...args), config);
    };
  }

  /**
   * Delay utility
   */
  private static delay(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }

  /**
   * Check if an error is retryable based on common patterns
   */
  public static isRetryableError(error: Error): boolean {
    // Handle non-Error objects
    if (!error || typeof error !== 'object') {
      return false;
    }
    
    const retryablePatterns = [
      /network/i,
      /timeout/i,
      /fetch/i,
      /connection/i,
      /5\d{2}/,  // 5xx status codes
      /429/,     // Rate limit
      /408/,     // Request timeout
      /502/,     // Bad gateway
      /503/,     // Service unavailable
      /504/      // Gateway timeout
    ];

    const message = error.message || '';
    const name = error.name || '';
    const status = (error as any).status;

    return retryablePatterns.some(pattern => 
      pattern.test(message) || 
      pattern.test(name) ||
      (status && pattern.test(status.toString()))
    );
  }

  /**
   * Create a circuit breaker pattern for operations
   */
  public static createCircuitBreaker<T extends any[], R>(
    fn: (...args: T) => Promise<R>,
    options: {
      failureThreshold: number;
      resetTimeout: number;
      monitoringPeriod: number;
    } = {
      failureThreshold: 5,
      resetTimeout: 60000,
      monitoringPeriod: 60000
    }
  ): (...args: T) => Promise<R> {
    let failures = 0;
    let lastFailureTime = 0;
    let state: 'CLOSED' | 'OPEN' | 'HALF_OPEN' = 'CLOSED';

    return async (...args: T): Promise<R> => {
      const now = Date.now();

      // Reset failure count if monitoring period has passed
      if (now - lastFailureTime > options.monitoringPeriod) {
        failures = 0;
      }

      // Check circuit breaker state
      if (state === 'OPEN') {
        if (now - lastFailureTime > options.resetTimeout) {
          state = 'HALF_OPEN';
        } else {
          throw new Error('Circuit breaker is OPEN - service temporarily unavailable');
        }
      }

      try {
        const result = await fn(...args);
        
        // Success - reset circuit breaker
        if (state === 'HALF_OPEN') {
          state = 'CLOSED';
          failures = 0;
        }
        
        return result;
      } catch (error) {
        failures++;
        lastFailureTime = now;

        // Open circuit breaker if threshold reached
        if (failures >= options.failureThreshold) {
          state = 'OPEN';
        }

        throw error;
      }
    };
  }
}

export default RetryManager;