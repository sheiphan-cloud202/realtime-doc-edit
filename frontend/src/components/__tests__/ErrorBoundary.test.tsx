import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { ErrorBoundary } from '../ErrorBoundary';

// Component that throws an error for testing
const ThrowError: React.FC<{ shouldThrow: boolean; errorMessage?: string }> = ({ 
  shouldThrow, 
  errorMessage = 'Test error' 
}) => {
  if (shouldThrow) {
    throw new Error(errorMessage);
  }
  return <div>No error</div>;
};

describe('ErrorBoundary', () => {
  // Mock console.error to avoid noise in tests
  const originalConsoleError = console.error;
  beforeEach(() => {
    console.error = jest.fn();
  });

  afterEach(() => {
    console.error = originalConsoleError;
  });

  describe('Normal Operation', () => {
    it('should render children when no error occurs', () => {
      render(
        <ErrorBoundary>
          <div>Test content</div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Test content')).toBeInTheDocument();
    });

    it('should not show error UI when no error occurs', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={false} />
        </ErrorBoundary>
      );

      expect(screen.getByText('No error')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should catch and display error', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} errorMessage="Custom error message" />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText(/We're sorry, but something unexpected happened/)).toBeInTheDocument();
    });

    it('should show error details when showDetails is true', () => {
      render(
        <ErrorBoundary showDetails={true}>
          <ThrowError shouldThrow={true} errorMessage="Custom error message" />
        </ErrorBoundary>
      );

      expect(screen.getByText('Error Details')).toBeInTheDocument();
      expect(screen.getByText('Custom error message')).toBeInTheDocument();
    });

    it('should not show error details when showDetails is false', () => {
      render(
        <ErrorBoundary showDetails={false}>
          <ThrowError shouldThrow={true} errorMessage="Custom error message" />
        </ErrorBoundary>
      );

      expect(screen.queryByText('Error Details')).not.toBeInTheDocument();
    });

    it('should call onError callback when error occurs', () => {
      const onError = jest.fn();

      render(
        <ErrorBoundary onError={onError}>
          <ThrowError shouldThrow={true} errorMessage="Test error" />
        </ErrorBoundary>
      );

      expect(onError).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Test error' }),
        expect.objectContaining({ componentStack: expect.any(String) })
      );
    });

    it('should generate unique error ID', () => {
      render(
        <ErrorBoundary showDetails={true}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      const supportText = screen.getByText(/If this problem persists, please contact support with Error ID:/);
      expect(supportText).toBeInTheDocument();
      expect(supportText.textContent).toMatch(/Error ID: error_\d+_\w+/);
    });
  });

  describe('Custom Fallback', () => {
    it('should render custom fallback when provided', () => {
      const customFallback = <div>Custom error UI</div>;

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error UI')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('Recovery Actions', () => {
    it('should have Try Again button', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Try Again')).toBeInTheDocument();
    });

    it('should have Reload Page button', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText('Reload Page')).toBeInTheDocument();
    });

    it('should reset error state when Try Again is clicked', () => {
      const TestComponent: React.FC = () => {
        const [shouldThrow, setShouldThrow] = React.useState(true);
        
        return (
          <div>
            <button onClick={() => setShouldThrow(false)}>Fix Error</button>
            <ErrorBoundary>
              <ThrowError shouldThrow={shouldThrow} />
            </ErrorBoundary>
          </div>
        );
      };

      render(<TestComponent />);

      // Error should be displayed
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Fix the error condition
      fireEvent.click(screen.getByText('Fix Error'));

      // Click Try Again
      fireEvent.click(screen.getByText('Try Again'));

      // Should show normal content now
      expect(screen.getByText('No error')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });

    it('should reload page when Reload Page is clicked', () => {
      // Mock window.location.reload
      const mockReload = jest.fn();
      Object.defineProperty(window, 'location', {
        value: { reload: mockReload },
        writable: true
      });

      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      fireEvent.click(screen.getByText('Reload Page'));

      expect(mockReload).toHaveBeenCalled();
    });
  });

  describe('Error Details', () => {
    it('should show error stack when available', () => {
      render(
        <ErrorBoundary showDetails={true}>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      // Click to expand details
      fireEvent.click(screen.getByText('Error Details'));

      // Check for error message in the details section
      const errorDetails = screen.getByText('Test error');
      expect(errorDetails).toBeInTheDocument();
      
      // Check for stack trace
      const stackTrace = screen.getByText(/at ThrowError/);
      expect(stackTrace).toBeInTheDocument();
    });

    it('should show support message with error ID', () => {
      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} />
        </ErrorBoundary>
      );

      expect(screen.getByText(/If this problem persists, please contact support with Error ID:/)).toBeInTheDocument();
    });
  });

  describe('Error Reporting', () => {
    it('should log error to console', () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation();

      render(
        <ErrorBoundary>
          <ThrowError shouldThrow={true} errorMessage="Test error" />
        </ErrorBoundary>
      );

      // Check that console.error was called (React will call it multiple times)
      expect(consoleSpy).toHaveBeenCalled();
      
      // Find the specific calls we're interested in
      const calls = consoleSpy.mock.calls;
      const errorBoundaryCalls = calls.filter(call => 
        call[0] && call[0].includes && call[0].includes('ErrorBoundary caught an error')
      );
      const errorReportCalls = calls.filter(call => 
        call[0] && call[0].includes && call[0].includes('Error Report')
      );

      expect(errorBoundaryCalls.length).toBeGreaterThan(0);
      expect(errorReportCalls.length).toBeGreaterThan(0);

      consoleSpy.mockRestore();
    });
  });
});