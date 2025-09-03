import React from 'react';
import './ServiceFallback.css';

export interface ServiceFallbackProps {
  serviceName: string;
  error?: Error;
  onRetry?: () => void;
  onReportIssue?: () => void;
  isRetrying?: boolean;
  retryCount?: number;
  maxRetries?: number;
  children?: React.ReactNode;
}

export const ServiceFallback: React.FC<ServiceFallbackProps> = ({
  serviceName,
  error,
  onRetry,
  onReportIssue,
  isRetrying = false,
  retryCount = 0,
  maxRetries = 3,
  children
}) => {
  const getErrorMessage = () => {
    if (!error) return `${serviceName} is temporarily unavailable.`;
    
    if (error.message.includes('network') || error.message.includes('fetch')) {
      return 'Network connection issue. Please check your internet connection.';
    }
    
    if (error.message.includes('timeout')) {
      return `${serviceName} is taking too long to respond.`;
    }
    
    if (error.message.includes('500') || error.message.includes('502') || 
        error.message.includes('503') || error.message.includes('504')) {
      return `${serviceName} is experiencing server issues.`;
    }
    
    return `${serviceName} encountered an unexpected error.`;
  };

  const getIcon = () => {
    if (isRetrying) return '🔄';
    if (error?.message.includes('network')) return '📡';
    if (error?.message.includes('timeout')) return '⏱️';
    return '⚠️';
  };

  const canRetry = onRetry && retryCount < maxRetries && !isRetrying;

  return (
    <div className="service-fallback">
      <div className="service-fallback-content">
        <div className={`service-fallback-icon ${isRetrying ? 'spinning' : ''}`}>
          {getIcon()}
        </div>
        
        <h3 className="service-fallback-title">
          {isRetrying ? `Retrying ${serviceName}...` : `${serviceName} Unavailable`}
        </h3>
        
        <p className="service-fallback-message">
          {getErrorMessage()}
        </p>

        {retryCount > 0 && (
          <p className="service-fallback-retry-info">
            Retry attempt {retryCount} of {maxRetries}
          </p>
        )}

        {children && (
          <div className="service-fallback-custom-content">
            {children}
          </div>
        )}

        <div className="service-fallback-actions">
          {canRetry && (
            <button 
              className="service-fallback-button service-fallback-button-primary"
              onClick={onRetry}
              disabled={isRetrying}
            >
              {isRetrying ? 'Retrying...' : 'Try Again'}
            </button>
          )}
          
          {onReportIssue && (
            <button 
              className="service-fallback-button service-fallback-button-secondary"
              onClick={onReportIssue}
            >
              Report Issue
            </button>
          )}
        </div>

        {error && (
          <details className="service-fallback-error-details">
            <summary>Technical Details</summary>
            <div className="service-fallback-error-info">
              <p><strong>Error:</strong> {error.message}</p>
              <p><strong>Service:</strong> {serviceName}</p>
              <p><strong>Time:</strong> {new Date().toLocaleString()}</p>
              {error.stack && (
                <pre className="service-fallback-stack">
                  {error.stack}
                </pre>
              )}
            </div>
          </details>
        )}
      </div>
    </div>
  );
};

export default ServiceFallback;