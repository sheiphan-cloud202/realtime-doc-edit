import React, { useState, useCallback } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { EditorComponent, TextSelection } from './components/EditorComponent';
import { AIPromptInterface } from './components/AIPromptInterface';
import { ErrorBoundary } from './components/ErrorBoundary';
import './App.css';

const App: React.FC = () => {
  const [content, setContent] = useState('# Welcome to Realtime AI Document Editor\n\nStart typing to begin editing...');
  const [selection, setSelection] = useState<TextSelection | null>(null);
  const [isAIPromptVisible, setIsAIPromptVisible] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [aiResult, setAiResult] = useState<string | undefined>();
  const [error, setError] = useState<string | undefined>();
  const [viewMode, setViewMode] = useState<'edit' | 'preview' | 'split'>('split');

  // Collaboration removed: no WebSocket connection

  const handleContentChange = useCallback((newContent: string) => {
    setContent(newContent);
  }, []);

  const handleSelectionChange = useCallback((newSelection: TextSelection | null) => {
    setSelection(newSelection);
  }, []);

  const handleOpenAIPrompt = useCallback(() => {
    if (selection && selection.text.trim()) {
      setIsAIPromptVisible(true);
    }
  }, [selection]);

  const handlePromptSubmit = useCallback(async (prompt: string) => {
    if (!selection) return;
    setIsProcessing(true);
    setError(undefined);
    setAiResult(undefined);
    try {
      const resp = await fetch('http://localhost:3001/ai/edit', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ selectedText: selection.text, prompt })
      });
      const data = await resp.json();
      if (!resp.ok) throw new Error(data.error || 'AI request failed');
      setAiResult(data.result);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setIsProcessing(false);
    }
  }, [selection]);

  const handleAcceptAIChanges = useCallback(() => {
    if (aiResult && selection) {
      const newContent = content.substring(0, selection.start) + aiResult + content.substring(selection.end);
      setContent(newContent);
      setIsAIPromptVisible(false);
      setAiResult(undefined);
    }
  }, [aiResult, selection, content]);

  const handleRejectAIChanges = useCallback(() => {
    setIsAIPromptVisible(false);
    setAiResult(undefined);
  }, []);

  React.useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const isMac = navigator.userAgent.includes('Mac');
      const mod = isMac ? e.metaKey : e.ctrlKey;
      if (mod && e.key.toLowerCase() === 'k') {
        if (selection && selection.text.trim()) {
          e.preventDefault();
          setIsAIPromptVisible(true);
        }
      }
    };
    document.addEventListener('keydown', onKey);
    // Listen for the custom event dispatched by the Monaco command in EditorComponent
    const onOpenAIPrompt = (e: Event) => {
      const detail = (e as CustomEvent).detail as { selection: TextSelection } | undefined;
      if (detail?.selection && detail.selection.text.trim()) {
        setSelection(detail.selection);
        setIsAIPromptVisible(true);
      }
    };
    document.addEventListener('openAIPrompt', onOpenAIPrompt as EventListener);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('openAIPrompt', onOpenAIPrompt as EventListener);
    };
  }, [selection]);

  return (
    <ErrorBoundary>
      <div className="app">
        <header className="app-header">
          <h1>Realtime Document Editor</h1>
          <div className="app-status">
            <div className="toggle-group" role="tablist" aria-label="View mode">
              <button
                className={`toggle-button ${viewMode === 'edit' ? 'active' : ''}`}
                onClick={() => setViewMode('edit')}
                role="tab"
                aria-selected={viewMode === 'edit'}
              >
                Edit
              </button>
              <button
                className={`toggle-button ${viewMode === 'preview' ? 'active' : ''}`}
                onClick={() => setViewMode('preview')}
                role="tab"
                aria-selected={viewMode === 'preview'}
              >
                Preview
              </button>
              <button
                className={`toggle-button ${viewMode === 'split' ? 'active' : ''}`}
                onClick={() => setViewMode('split')}
                role="tab"
                aria-selected={viewMode === 'split'}
              >
                Split
              </button>
            </div>
          </div>
        </header>

        <main className="app-main">
          <div className={`editor-preview-container ${viewMode}`}>
            {viewMode !== 'preview' && (
              <div className="editor-pane" aria-label="Markdown editor">
                <EditorComponent
                  content={content}
                  onContentChange={handleContentChange}
                  onSelectionChange={handleSelectionChange}
                />
              </div>
            )}
            {viewMode !== 'edit' && (
              <div className="preview-pane" aria-label="Markdown preview">
                <div className="markdown-body">
                  <ReactMarkdown remarkPlugins={[remarkGfm]}>
                    {content}
                  </ReactMarkdown>
                </div>
              </div>
            )}
          </div>
        </main>

        <AIPromptInterface
          isVisible={isAIPromptVisible}
          selectedText={selection?.text || ''}
          selection={selection}
          onPromptSubmit={handlePromptSubmit}
          onCancel={() => setIsAIPromptVisible(false)}
          onAcceptChanges={handleAcceptAIChanges}
          onRejectChanges={handleRejectAIChanges}
          isProcessing={isProcessing}
          aiResult={aiResult}
          error={error}
        />

        <div className="app-footer">
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '1rem' }}>
            <p style={{ margin: 0 }}>
              {selection ? `Selected ${Math.max(0, selection.end - selection.start)} characters` : 'No selection'}
            </p>
            {selection && selection.text.trim() && (
              <button onClick={handleOpenAIPrompt} style={{ padding: '0.5rem 1rem', background: '#007acc', color: 'white', border: 'none', borderRadius: 4, cursor: 'pointer' }}>
                Open AI Assistant (Cmd/Ctrl+K)
              </button>
            )}
          </div>
        </div>
      </div>
    </ErrorBoundary>
  );
};

export default App;