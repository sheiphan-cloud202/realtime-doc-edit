import React, { useState, useEffect, useRef } from 'react';
import { TextSelection } from './EditorComponent';

export interface AIPromptInterfaceProps {
  isVisible: boolean;
  selectedText: string;
  selection: TextSelection | null;
  onPromptSubmit: (prompt: string) => void;
  onCancel: () => void;
  onAcceptChanges: () => void;
  onRejectChanges: () => void;
  isProcessing: boolean;
  aiResult?: string;
  error?: string;
}

export interface DiffViewProps {
  original: string;
  modified: string;
}

const DiffView: React.FC<DiffViewProps> = ({ original, modified }) => {
  // Simple diff visualization - in a real implementation, you might use a library like react-diff-viewer
  const renderDiff = () => {
    if (original === modified) {
      return <div className="diff-unchanged">{original}</div>;
    }

    return (
      <div className="diff-container">
        <div className="diff-section">
          <div className="diff-label">Original:</div>
          <div className="diff-original">{original}</div>
        </div>
        <div className="diff-section">
          <div className="diff-label">AI Suggestion:</div>
          <div className="diff-modified">{modified}</div>
        </div>
      </div>
    );
  };

  return <div className="diff-view">{renderDiff()}</div>;
};

export const AIPromptInterface: React.FC<AIPromptInterfaceProps> = ({
  isVisible,
  selectedText,
  selection,
  onPromptSubmit,
  onCancel,
  onAcceptChanges,
  onRejectChanges,
  isProcessing,
  aiResult,
  error
}) => {
  const [prompt, setPrompt] = useState('');
  const [showPreview, setShowPreview] = useState(false);
  const promptInputRef = useRef<HTMLTextAreaElement>(null);

  // Focus the prompt input when the interface becomes visible
  useEffect(() => {
    if (isVisible && promptInputRef.current) {
      promptInputRef.current.focus();
    }
  }, [isVisible]);

  // Show preview when AI result is available or when there's an error
  useEffect(() => {
    if (aiResult || error) {
      setShowPreview(true);
    }
  }, [aiResult, error]);

  // Reset state when interface is hidden
  useEffect(() => {
    if (!isVisible) {
      setPrompt('');
      setShowPreview(false);
    }
  }, [isVisible]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (prompt.trim() && !isProcessing) {
      onPromptSubmit(prompt.trim());
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
      e.preventDefault();
      handleSubmit(e);
    } else if (e.key === 'Escape') {
      e.preventDefault();
      onCancel();
    }
  };

  const handleAccept = () => {
    onAcceptChanges();
    setShowPreview(false);
  };

  const handleReject = () => {
    onRejectChanges();
    setShowPreview(false);
  };

  if (!isVisible) {
    return null;
  }

  return (
    <div className="ai-prompt-interface">
      <div className="ai-prompt-overlay" onClick={onCancel} />
      <div className="ai-prompt-modal">
        <div className="ai-prompt-header">
          <h3>AI Assistant</h3>
          <button 
            className="ai-prompt-close" 
            onClick={onCancel}
            aria-label="Close AI prompt"
          >
            ×
          </button>
        </div>

        <div className="ai-prompt-content">
          {selection && (
            <div className="selected-text-info">
              <div className="selected-text-label">Selected text ({selection.end - selection.start} characters):</div>
              <div className="selected-text-preview">
                {selectedText.length > 100 
                  ? `${selectedText.substring(0, 100)}...` 
                  : selectedText
                }
              </div>
            </div>
          )}

          {!showPreview ? (
            <form onSubmit={handleSubmit} className="ai-prompt-form">
              <div className="prompt-input-section">
                <label htmlFor="ai-prompt" className="prompt-label">
                  What would you like the AI to do with this text?
                </label>
                <textarea
                  id="ai-prompt"
                  ref={promptInputRef}
                  value={prompt}
                  onChange={(e) => setPrompt(e.target.value)}
                  onKeyDown={handleKeyDown}
                  placeholder="e.g., 'Make this more concise', 'Fix grammar', 'Translate to Spanish'..."
                  className="prompt-textarea"
                  rows={3}
                  disabled={isProcessing}
                />
                <div className="prompt-hint">
                  Press Ctrl+Enter (Cmd+Enter on Mac) to submit, or Escape to cancel
                </div>
              </div>

              <div className="ai-prompt-actions">
                <button
                  type="button"
                  onClick={onCancel}
                  className="ai-button ai-button-secondary"
                  disabled={isProcessing}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="ai-button ai-button-primary"
                  disabled={!prompt.trim() || isProcessing}
                >
                  {isProcessing ? (
                    <>
                      <span className="ai-spinner" />
                      Processing...
                    </>
                  ) : (
                    'Generate'
                  )}
                </button>
              </div>
            </form>
          ) : (
            <div className="ai-preview-section">
              {error ? (
                <div className="ai-error">
                  <div className="ai-error-title">Error</div>
                  <div className="ai-error-message">{error}</div>
                  <div className="ai-error-actions">
                    <button
                      onClick={() => setShowPreview(false)}
                      className="ai-button ai-button-secondary"
                    >
                      Try Again
                    </button>
                    <button
                      onClick={onCancel}
                      className="ai-button ai-button-secondary"
                    >
                      Cancel
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="ai-preview-header">
                    <h4>AI Suggestion</h4>
                    <div className="ai-preview-prompt">Prompt: "{prompt}"</div>
                  </div>
                  
                  <DiffView original={selectedText} modified={aiResult || ''} />
                  
                  <div className="ai-preview-actions">
                    <button
                      onClick={handleReject}
                      className="ai-button ai-button-secondary"
                    >
                      Reject
                    </button>
                    <button
                      onClick={() => setShowPreview(false)}
                      className="ai-button ai-button-secondary"
                    >
                      Edit Prompt
                    </button>
                    <button
                      onClick={handleAccept}
                      className="ai-button ai-button-primary"
                    >
                      Accept Changes
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default AIPromptInterface;