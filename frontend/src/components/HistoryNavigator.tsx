/**
 * History Navigator Component
 * 
 * Provides UI controls for undo/redo functionality and history visualization
 */

import React, { useState, useCallback } from 'react';
import { HistoryEntry } from '../shared/types';
import './HistoryNavigator.css';

export interface HistoryNavigatorProps {
  canUndo: boolean;
  canRedo: boolean;
  historySize: number;
  historyEntries: HistoryEntry[];
  currentIndex: number;
  onUndo: () => void;
  onRedo: () => void;
  onJumpToHistoryPoint: (index: number) => void;
  onClearHistory: () => void;
  showHistoryPanel?: boolean;
  onToggleHistoryPanel?: () => void;
}

export const HistoryNavigator: React.FC<HistoryNavigatorProps> = ({
  canUndo,
  canRedo,
  historySize,
  historyEntries,
  currentIndex,
  onUndo,
  onRedo,
  onJumpToHistoryPoint,
  onClearHistory,
  showHistoryPanel = false,
  onToggleHistoryPanel
}) => {
  const [showTooltip, setShowTooltip] = useState<string | null>(null);

  const handleKeyDown = useCallback((event: React.KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'z') {
      event.preventDefault();
      if (event.shiftKey) {
        if (canRedo) onRedo();
      } else {
        if (canUndo) onUndo();
      }
    }
  }, [canUndo, canRedo, onUndo, onRedo]);

  const formatTimestamp = (timestamp: Date): string => {
    return new Date(timestamp).toLocaleTimeString();
  };

  const getOperationIcon = (entry: HistoryEntry): string => {
    if (entry.isAIOperation) {
      return '🤖';
    }
    switch (entry.operation.type) {
      case 'insert':
        return '➕';
      case 'delete':
        return '➖';
      case 'retain':
        return '↔️';
      default:
        return '📝';
    }
  };

  const handleHistoryEntryClick = (index: number) => {
    onJumpToHistoryPoint(index);
  };

  return (
    <div className="history-navigator" onKeyDown={handleKeyDown} tabIndex={0}>
      {/* Main Controls */}
      <div className="history-controls">
        <button
          className={`history-btn undo-btn ${!canUndo ? 'disabled' : ''}`}
          onClick={onUndo}
          disabled={!canUndo}
          onMouseEnter={() => setShowTooltip('undo')}
          onMouseLeave={() => setShowTooltip(null)}
          title="Undo (Ctrl+Z)"
        >
          ↶
        </button>

        <button
          className={`history-btn redo-btn ${!canRedo ? 'disabled' : ''}`}
          onClick={onRedo}
          disabled={!canRedo}
          onMouseEnter={() => setShowTooltip('redo')}
          onMouseLeave={() => setShowTooltip(null)}
          title="Redo (Ctrl+Shift+Z)"
        >
          ↷
        </button>

        <div className="history-info">
          <span className="history-position">
            {currentIndex + 1}/{historySize}
          </span>
        </div>

        {onToggleHistoryPanel && (
          <button
            className={`history-btn panel-toggle-btn ${showHistoryPanel ? 'active' : ''}`}
            onClick={onToggleHistoryPanel}
            title="Toggle History Panel"
          >
            📋
          </button>
        )}

        {historySize > 0 && (
          <button
            className="history-btn clear-btn"
            onClick={onClearHistory}
            onMouseEnter={() => setShowTooltip('clear')}
            onMouseLeave={() => setShowTooltip(null)}
            title="Clear History"
          >
            🗑️
          </button>
        )}
      </div>

      {/* Tooltips */}
      {showTooltip && (
        <div className={`tooltip tooltip-${showTooltip}`}>
          {showTooltip === 'undo' && `Undo (${canUndo ? 'available' : 'unavailable'})`}
          {showTooltip === 'redo' && `Redo (${canRedo ? 'available' : 'unavailable'})`}
          {showTooltip === 'clear' && 'Clear all history'}
        </div>
      )}

      {/* History Panel */}
      {showHistoryPanel && (
        <div className="history-panel">
          <div className="history-panel-header">
            <h3>Operation History</h3>
            <div className="history-stats">
              <span>Total: {historySize}</span>
              <span>AI: {historyEntries.filter(e => e.isAIOperation).length}</span>
            </div>
          </div>

          <div className="history-list">
            {historyEntries.length === 0 ? (
              <div className="history-empty">
                No operations in history
              </div>
            ) : (
              historyEntries.map((entry, index) => (
                <div
                  key={entry.id}
                  className={`history-entry ${index <= currentIndex ? 'applied' : 'unapplied'} ${
                    entry.isAIOperation ? 'ai-operation' : 'user-operation'
                  }`}
                  onClick={() => handleHistoryEntryClick(index)}
                  title={`Click to jump to this point in history`}
                >
                  <div className="history-entry-icon">
                    {getOperationIcon(entry)}
                  </div>
                  <div className="history-entry-content">
                    <div className="history-entry-description">
                      {entry.description}
                    </div>
                    <div className="history-entry-meta">
                      <span className="history-entry-time">
                        {formatTimestamp(entry.timestamp)}
                      </span>
                      {entry.isAIOperation && entry.aiRequestId && (
                        <span className="history-entry-ai-id">
                          AI: {entry.aiRequestId.slice(-6)}
                        </span>
                      )}
                    </div>
                  </div>
                  <div className="history-entry-indicator">
                    {index === currentIndex && <span className="current-indicator">●</span>}
                  </div>
                </div>
              ))
            )}
          </div>

          {historySize > 0 && (
            <div className="history-panel-footer">
              <button
                className="clear-history-btn"
                onClick={onClearHistory}
                title="Clear all history"
              >
                Clear All History
              </button>
            </div>
          )}
        </div>
      )}

      {/* Keyboard Shortcuts Help */}
      <div className="keyboard-shortcuts">
        <small>
          Ctrl+Z: Undo | Ctrl+Shift+Z: Redo
        </small>
      </div>
    </div>
  );
};

export default HistoryNavigator;