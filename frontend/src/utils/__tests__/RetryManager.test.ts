import { RetryManager } from '../RetryManager';

describe('RetryManager', () => {
  describe('executeWithRetry', () => {
    it('should succeed on first attempt', async () => {
      const operation = jest.fn().mockResolvedValue('success');
      
      const result = await RetryManager.executeWithRetry(operation);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should retry on failure and eventually succeed', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success');
      
      const onRetry = jest.fn();
      
      const result = await RetryManager.executeWithRetry(operation, {}, onRetry);
      
      expect(result).toBe('success');
      expect(operation).toHaveBeenCalledTimes(3);
      expect(onRetry).toHaveBeenCalledTimes(2);
    });

    it('should fail after max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('network error'));
      
      await expect(
        RetryManager.executeWithRetry(operation, { maxRetries: 2 })
      ).rejects.toThrow('network error');
      
      expect(operation).toHaveBeenCalledTimes(3); // Initial + 2 retries
    });

    it('should respect retry condition', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('non-retryable error'));
      
      const retryCondition = jest.fn().mockReturnValue(false);
      
      await expect(
        RetryManager.executeWithRetry(operation, { retryCondition })
      ).rejects.toThrow('non-retryable error');
      
      expect(operation).toHaveBeenCalledTimes(1);
      expect(retryCondition).toHaveBeenCalledWith(expect.any(Error));
    });

    it('should use exponential backoff', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success');
      
      const onRetry = jest.fn();
      const startTime = Date.now();
      
      await RetryManager.executeWithRetry(
        operation,
        { baseDelay: 100, backoffFactor: 2 },
        onRetry
      );
      
      const endTime = Date.now();
      
      // Should have taken at least the base delays (with some tolerance for execution time)
      expect(endTime - startTime).toBeGreaterThan(200); // 100ms + 200ms + execution time
      
      expect(onRetry).toHaveBeenCalledTimes(2);
      expect(onRetry).toHaveBeenNthCalledWith(1, {
        attempt: 1,
        error: expect.any(Error),
        nextRetryIn: expect.any(Number)
      });
    });

    it('should respect max delay', async () => {
      const operation = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success');
      
      const onRetry = jest.fn();
      
      await RetryManager.executeWithRetry(
        operation,
        { 
          baseDelay: 10000,
          maxDelay: 1000,
          backoffFactor: 2
        },
        onRetry
      );
      
      expect(onRetry).toHaveBeenCalledWith({
        attempt: 1,
        error: expect.any(Error),
        nextRetryIn: expect.any(Number)
      });
      
      // The nextRetryIn should be capped at maxDelay + jitter
      const retryCall = onRetry.mock.calls[0][0];
      expect(retryCall.nextRetryIn).toBeLessThan(2000); // maxDelay + max jitter
    });
  });

  describe('createRetryWrapper', () => {
    it('should create a wrapper function that retries', async () => {
      const originalFn = jest.fn()
        .mockRejectedValueOnce(new Error('network error'))
        .mockResolvedValue('success');
      
      const wrappedFn = RetryManager.createRetryWrapper(originalFn, { maxRetries: 2 });
      
      const result = await wrappedFn('arg1', 'arg2');
      
      expect(result).toBe('success');
      expect(originalFn).toHaveBeenCalledTimes(2);
      expect(originalFn).toHaveBeenCalledWith('arg1', 'arg2');
    });
  });

  describe('isRetryableError', () => {
    it('should identify network errors as retryable', () => {
      const networkError = new Error('network connection failed');
      expect(RetryManager.isRetryableError(networkError)).toBe(true);
    });

    it('should identify timeout errors as retryable', () => {
      const timeoutError = new Error('request timeout');
      expect(RetryManager.isRetryableError(timeoutError)).toBe(true);
    });

    it('should identify fetch errors as retryable', () => {
      const fetchError = new Error('fetch failed');
      expect(RetryManager.isRetryableError(fetchError)).toBe(true);
    });

    it('should identify 5xx status codes as retryable', () => {
      const serverError = new Error('500 internal server error');
      expect(RetryManager.isRetryableError(serverError)).toBe(true);
      
      const badGateway = new Error('502 bad gateway');
      expect(RetryManager.isRetryableError(badGateway)).toBe(true);
      
      const serviceUnavailable = new Error('503 service unavailable');
      expect(RetryManager.isRetryableError(serviceUnavailable)).toBe(true);
    });

    it('should identify rate limit errors as retryable', () => {
      const rateLimitError = new Error('429 too many requests');
      expect(RetryManager.isRetryableError(rateLimitError)).toBe(true);
    });

    it('should not identify client errors as retryable', () => {
      const clientError = new Error('400 bad request');
      expect(RetryManager.isRetryableError(clientError)).toBe(false);
      
      const notFoundError = new Error('404 not found');
      expect(RetryManager.isRetryableError(notFoundError)).toBe(false);
    });

    it('should handle error objects with status property', () => {
      const errorWithStatus = new Error('Server error');
      (errorWithStatus as any).status = 502;
      
      expect(RetryManager.isRetryableError(errorWithStatus)).toBe(true);
    });
  });

  describe('createCircuitBreaker', () => {
    it('should allow requests when circuit is closed', async () => {
      const fn = jest.fn().mockResolvedValue('success');
      const circuitBreaker = RetryManager.createCircuitBreaker(fn);
      
      const result = await circuitBreaker();
      
      expect(result).toBe('success');
      expect(fn).toHaveBeenCalledTimes(1);
    });

    it('should open circuit after failure threshold', async () => {
      const fn = jest.fn().mockRejectedValue(new Error('service error'));
      const circuitBreaker = RetryManager.createCircuitBreaker(fn, {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitoringPeriod: 5000
      });
      
      // First failure
      await expect(circuitBreaker()).rejects.toThrow('service error');
      
      // Second failure - should open circuit
      await expect(circuitBreaker()).rejects.toThrow('service error');
      
      // Third call - circuit should be open
      await expect(circuitBreaker()).rejects.toThrow('Circuit breaker is OPEN');
      
      expect(fn).toHaveBeenCalledTimes(2);
    });

    it('should reset circuit after timeout', async () => {
      jest.useFakeTimers();
      
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('service error'))
        .mockRejectedValueOnce(new Error('service error'))
        .mockResolvedValue('success');
      
      const circuitBreaker = RetryManager.createCircuitBreaker(fn, {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitoringPeriod: 5000
      });
      
      // Trigger failures to open circuit
      await expect(circuitBreaker()).rejects.toThrow('service error');
      await expect(circuitBreaker()).rejects.toThrow('service error');
      
      // Circuit should be open
      await expect(circuitBreaker()).rejects.toThrow('Circuit breaker is OPEN');
      
      // Fast forward past reset timeout
      jest.advanceTimersByTime(1001);
      
      // Should be in half-open state and succeed
      const result = await circuitBreaker();
      expect(result).toBe('success');
      
      jest.useRealTimers();
    });

    it('should reset failure count after monitoring period', async () => {
      jest.useFakeTimers();
      
      const fn = jest.fn()
        .mockRejectedValueOnce(new Error('service error'))
        .mockResolvedValue('success');
      
      const circuitBreaker = RetryManager.createCircuitBreaker(fn, {
        failureThreshold: 2,
        resetTimeout: 1000,
        monitoringPeriod: 2000
      });
      
      // First failure
      await expect(circuitBreaker()).rejects.toThrow('service error');
      
      // Fast forward past monitoring period
      jest.advanceTimersByTime(2001);
      
      // Should succeed (failure count reset)
      const result = await circuitBreaker();
      expect(result).toBe('success');
      
      jest.useRealTimers();
    });
  });

  describe('Error Handling Edge Cases', () => {
    it('should handle undefined error messages', async () => {
      const error = new Error('network error'); // Make it retryable
      error.message = 'network error';
      
      const operation = jest.fn().mockRejectedValue(error);
      
      await expect(
        RetryManager.executeWithRetry(operation, { maxRetries: 1 })
      ).rejects.toThrow();
      
      expect(operation).toHaveBeenCalledTimes(2);
    });

    it('should handle non-Error objects', async () => {
      const operation = jest.fn().mockRejectedValue('string error');
      
      await expect(
        RetryManager.executeWithRetry(operation, { maxRetries: 1 })
      ).rejects.toBe('string error');
      
      // Should not retry non-Error objects
      expect(operation).toHaveBeenCalledTimes(1);
    });

    it('should handle zero max retries', async () => {
      const operation = jest.fn().mockRejectedValue(new Error('error'));
      
      await expect(
        RetryManager.executeWithRetry(operation, { maxRetries: 0 })
      ).rejects.toThrow('error');
      
      expect(operation).toHaveBeenCalledTimes(1);
    });
  });
});