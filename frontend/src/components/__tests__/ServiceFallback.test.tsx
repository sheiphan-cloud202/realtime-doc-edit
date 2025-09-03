import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ServiceFallback } from '../ServiceFallback';

describe('ServiceFallback', () => {
  const defaultProps = {
    serviceName: 'Test Service'
  };

  describe('Basic Rendering', () => {
    it('should render service name in title', () => {
      render(<ServiceFallback {...defaultProps} />);
      
      expect(screen.getByText('Test Service Unavailable')).toBeInTheDocument();
    });

    it('should show default message when no error provided', () => {
      render(<ServiceFallback {...defaultProps} />);
      
      expect(screen.getByText('Test Service is temporarily unavailable.')).toBeInTheDocument();
    });

    it('should show warning icon by default', () => {
      render(<ServiceFallback {...defaultProps} />);
      
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });
  });

  describe('Error Messages', () => {
    it('should show network error message for network errors', () => {
      const networkError = new Error('network connection failed');
      
      render(<ServiceFallback {...defaultProps} error={networkError} />);
      
      expect(screen.getByText('Network connection issue. Please check your internet connection.')).toBeInTheDocument();
      expect(screen.getByText('📡')).toBeInTheDocument();
    });

    it('should show timeout error message for timeout errors', () => {
      const timeoutError = new Error('request timeout');
      
      render(<ServiceFallback {...defaultProps} error={timeoutError} />);
      
      expect(screen.getByText('Test Service is taking too long to respond.')).toBeInTheDocument();
      expect(screen.getByText('⏱️')).toBeInTheDocument();
    });

    it('should show server error message for 5xx errors', () => {
      const serverError = new Error('500 internal server error');
      
      render(<ServiceFallback {...defaultProps} error={serverError} />);
      
      expect(screen.getByText('Test Service is experiencing server issues.')).toBeInTheDocument();
    });

    it('should show generic error message for unknown errors', () => {
      const unknownError = new Error('unknown error');
      
      render(<ServiceFallback {...defaultProps} error={unknownError} />);
      
      expect(screen.getByText('Test Service encountered an unexpected error.')).toBeInTheDocument();
    });
  });

  describe('Retry Functionality', () => {
    it('should show Try Again button when onRetry is provided and retries available', () => {
      const onRetry = jest.fn();
      
      render(
        <ServiceFallback 
          {...defaultProps} 
          onRetry={onRetry}
          retryCount={1}
          maxRetries={3}
        />
      );
      
      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should call onRetry when Try Again button is clicked', () => {
      const onRetry = jest.fn();
      
      render(<ServiceFallback {...defaultProps} onRetry={onRetry} />);
      
      fireEvent.click(screen.getByText('Try Again'));
      
      expect(onRetry).toHaveBeenCalledTimes(1);
    });

    it('should not show Try Again button when max retries reached', () => {
      const onRetry = jest.fn();
      
      render(
        <ServiceFallback 
          {...defaultProps} 
          onRetry={onRetry}
          retryCount={3}
          maxRetries={3}
        />
      );
      
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
    });

    it('should disable Try Again button when retrying', () => {
      const onRetry = jest.fn();
      
      render(
        <ServiceFallback 
          {...defaultProps} 
          onRetry={onRetry}
          isRetrying={true}
        />
      );
      
      // When retrying, the button should not be visible since canRetry is false
      expect(screen.queryByText('Try Again')).not.toBeInTheDocument();
      expect(screen.queryByText('Retrying...')).not.toBeInTheDocument();
    });

    it('should show retry count information', () => {
      render(
        <ServiceFallback 
          {...defaultProps} 
          retryCount={2}
          maxRetries={3}
        />
      );
      
      expect(screen.getByText('Retry attempt 2 of 3')).toBeInTheDocument();
    });
  });

  describe('Retrying State', () => {
    it('should show retrying title when isRetrying is true', () => {
      render(<ServiceFallback {...defaultProps} isRetrying={true} />);
      
      expect(screen.getByText('Retrying Test Service...')).toBeInTheDocument();
    });

    it('should show spinning icon when retrying', () => {
      const { container } = render(<ServiceFallback {...defaultProps} isRetrying={true} />);
      
      const icon = container.querySelector('.service-fallback-icon');
      expect(icon).toHaveClass('spinning');
      expect(screen.getByText('🔄')).toBeInTheDocument();
    });
  });

  describe('Report Issue', () => {
    it('should show Report Issue button when onReportIssue is provided', () => {
      const onReportIssue = jest.fn();
      
      render(<ServiceFallback {...defaultProps} onReportIssue={onReportIssue} />);
      
      expect(screen.getByText('Report Issue')).toBeInTheDocument();
    });

    it('should call onReportIssue when Report Issue button is clicked', () => {
      const onReportIssue = jest.fn();
      
      render(<ServiceFallback {...defaultProps} onReportIssue={onReportIssue} />);
      
      fireEvent.click(screen.getByText('Report Issue'));
      
      expect(onReportIssue).toHaveBeenCalledTimes(1);
    });

    it('should not show Report Issue button when onReportIssue is not provided', () => {
      render(<ServiceFallback {...defaultProps} />);
      
      expect(screen.queryByText('Report Issue')).not.toBeInTheDocument();
    });
  });

  describe('Custom Content', () => {
    it('should render custom children content', () => {
      render(
        <ServiceFallback {...defaultProps}>
          <div>Custom fallback content</div>
        </ServiceFallback>
      );
      
      expect(screen.getByText('Custom fallback content')).toBeInTheDocument();
    });
  });

  describe('Technical Details', () => {
    it('should show technical details when error is provided', () => {
      const error = new Error('Test error message');
      
      render(<ServiceFallback {...defaultProps} error={error} />);
      
      expect(screen.getByText('Technical Details')).toBeInTheDocument();
    });

    it('should show error information when details are expanded', () => {
      const error = new Error('Test error message');
      
      render(<ServiceFallback {...defaultProps} error={error} />);
      
      // Click to expand details
      fireEvent.click(screen.getByText('Technical Details'));
      
      expect(screen.getByText('Test error message')).toBeInTheDocument();
      expect(screen.getByText(/Service:/)).toBeInTheDocument();
      expect(screen.getByText(/Time:/)).toBeInTheDocument();
    });

    it('should show error stack when available', () => {
      const error = new Error('Test error');
      error.stack = 'Error: Test error\n    at test.js:1:1';
      
      render(<ServiceFallback {...defaultProps} error={error} />);
      
      // Click to expand details
      fireEvent.click(screen.getByText('Technical Details'));
      
      expect(screen.getByText(/Error: Test error/)).toBeInTheDocument();
    });

    it('should not show technical details when no error provided', () => {
      render(<ServiceFallback {...defaultProps} />);
      
      expect(screen.queryByText('Technical Details')).not.toBeInTheDocument();
    });
  });

  describe('Edge Cases', () => {
    it('should handle empty service name', () => {
      render(<ServiceFallback serviceName="" />);
      
      expect(screen.getByText('Unavailable')).toBeInTheDocument();
    });

    it('should handle zero retry count', () => {
      render(
        <ServiceFallback 
          {...defaultProps} 
          retryCount={0}
          maxRetries={3}
        />
      );
      
      expect(screen.queryByText(/Retry attempt/)).not.toBeInTheDocument();
    });

    it('should handle error without message', () => {
      const error = new Error();
      error.message = '';
      
      render(<ServiceFallback {...defaultProps} error={error} />);
      
      expect(screen.getByText('Test Service encountered an unexpected error.')).toBeInTheDocument();
    });
  });
});