import React from 'react';
import './OfflineIndicator.css';

export interface OfflineIndicatorProps {
  isOffline: boolean;
  queuedOperationsCount: number;
  onRetrySync?: () => void;
}

export const OfflineIndicator: React.FC<OfflineIndicatorProps> = ({
  isOffline,
  queuedOperationsCount,
  onRetrySync
}) => {
  if (!isOffline && queuedOperationsCount === 0) {
    return null;
  }

  return (
    <div className={`offline-indicator ${isOffline ? 'offline' : 'syncing'}`}>
      <div className="offline-indicator-content">
        <div className="offline-indicator-icon">
          {isOffline ? '⚠️' : '🔄'}
        </div>
        <div className="offline-indicator-text">
          {isOffline ? (
            <>
              <span className="offline-status">You're offline</span>
              {queuedOperationsCount > 0 && (
                <span className="queued-count">
                  {queuedOperationsCount} change{queuedOperationsCount !== 1 ? 's' : ''} queued
                </span>
              )}
            </>
          ) : (
            <span className="syncing-status">
              Syncing {queuedOperationsCount} change{queuedOperationsCount !== 1 ? 's' : ''}...
            </span>
          )}
        </div>
        {isOffline && onRetrySync && (
          <button 
            className="retry-sync-button"
            onClick={onRetrySync}
            title="Retry synchronization"
          >
            Retry
          </button>
        )}
      </div>
    </div>
  );
};

export default OfflineIndicator;