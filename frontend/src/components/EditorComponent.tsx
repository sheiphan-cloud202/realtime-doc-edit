import React, { useRef, useCallback } from 'react';
import Editor, { OnMount, OnChange } from '@monaco-editor/react';
import * as monaco from 'monaco-editor';

export interface TextSelection {
  start: number;
  end: number;
  text: string;
}

export interface EditorComponentProps {
  content: string;
  onContentChange: (content: string) => void;
  onSelectionChange: (selection: TextSelection | null) => void;
  readOnly?: boolean;
}

export interface EditorComponentRefApi {}

export const EditorComponent = React.forwardRef<EditorComponentRefApi, EditorComponentProps> (({
  content,
  onContentChange,
  onSelectionChange,
  readOnly = false
}, ref) => {
  const editorRef = useRef<any>(null);
  const previousContentRef = useRef<string>(content);

  // No history/OT for single-user editor

  // No history/OT for single-user editor

  const handleEditorDidMount: OnMount = useCallback((editor) => {
    editorRef.current = editor;

    // Set up selection change listener
    editor.onDidChangeCursorSelection((e: any) => {
      const model = editor.getModel();
      if (!model) return;

      const selection = e.selection;
      
      if (selection.isEmpty()) {
        onSelectionChange(null);
      } else {
        const selectedText = model.getValueInRange(selection);
        const start = model.getOffsetAt(selection.getStartPosition());
        const end = model.getOffsetAt(selection.getEndPosition());

        const textSelection: TextSelection = {
          start,
          end,
          text: selectedText
        };
        onSelectionChange(textSelection);
      }
    });

    // Add keyboard shortcut for AI assistance
    editor.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.KeyK, () => {
      // Get current selection from the editor directly
      const model = editor.getModel();
      if (!model) return;
      
      const selection = editor.getSelection();
      if (!selection || selection.isEmpty()) return;
      
      const selectedText = model.getValueInRange(selection);
      if (!selectedText.trim()) return;
      
      const start = model.getOffsetAt(selection.getStartPosition());
      const end = model.getOffsetAt(selection.getEndPosition());

      const textSelection: TextSelection = {
        start,
        end,
        text: selectedText
      };

      // Trigger AI prompt through a custom event
      const event = new CustomEvent('openAIPrompt', { 
        detail: { selection: textSelection } 
      });
      document.dispatchEvent(event);
    });

    // Focus the editor
    editor.focus();
  }, [onSelectionChange]);

  const handleContentChange: OnChange = useCallback((value) => {
    if (value === undefined) return;
    previousContentRef.current = value;
    onContentChange(value);
  }, [onContentChange]);

  // No remote operations

  // No remote changes/acknowledgement

  // No imperative API needed

  // No external versioning

  // Keep editor/model in sync when parent content prop changes (e.g., initial sync)
  // Keep editor/model in sync when parent content prop changes
  React.useEffect(() => {
    if (!editorRef.current) {
      previousContentRef.current = content;
      return;
    }
    const model = editorRef.current.getModel();
    if (!model) return;
    const current = model.getValue();
    if (current !== content) {
      model.setValue(content);
      previousContentRef.current = content;
      onContentChange(content);
    } else {
      previousContentRef.current = content;
    }
  }, [content, onContentChange]);

  // No history controls in simplified editor

  // No AI history hook

  return (
    <div className="editor-container" style={{ height: '100%', width: '100%', position: 'relative' }}>
      <Editor
        height="100%"
        defaultLanguage="markdown"
        value={content}
        onChange={handleContentChange}
        onMount={handleEditorDidMount}
        options={{
          readOnly,
          minimap: { enabled: false },
          scrollBeyondLastLine: false,
          fontSize: 14,
          lineNumbers: 'on',
          wordWrap: 'on',
          automaticLayout: true,
          selectOnLineNumbers: true,
          selectionHighlight: true,
          occurrencesHighlight: 'singleFile',
          renderWhitespace: 'selection'
        }}
        theme="vs-light"
      />
      {/* Selection summary can be added back if needed */}
    </div>
  );
});
export default EditorComponent;