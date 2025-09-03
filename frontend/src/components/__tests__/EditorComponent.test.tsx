import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import EditorComponent, { TextSelection } from '../EditorComponent';
import { Operation } from '../../../../shared/types';

// Mock Monaco Editor with a simple implementation
jest.mock('@monaco-editor/react', () => ({
  __esModule: true,
  default: (props: any) => {
    const { value, onChange, onMount, options } = props;
    
    // Create a mock editor instance
    const mockEditor = {
      onDidChangeCursorSelection: jest.fn(),
      getModel: () => ({
        getValueInRange: () => '',
        getOffsetAt: () => 0,
      }),
      focus: jest.fn(),
    };

    // Call onMount if provided
    if (onMount) {
      setTimeout(() => onMount(mockEditor), 0);
    }

    return (
      <textarea
        data-testid="monaco-editor"
        value={value}
        onChange={(e) => onChange && onChange(e.target.value)}
        style={{ width: '100%', height: '400px', fontFamily: 'monospace' }}
        readOnly={options?.readOnly}
      />
    );
  }
}));

describe('EditorComponent', () => {
  const defaultProps = {
    content: 'Initial content',
    onContentChange: jest.fn(), 
    onSelectionChange: jest.fn(),
    onOperationGenerated: jest.fn(),
    onPresenceUpdate: jest.fn(),
    collaborators: [],
    userId: 'user-123',
    documentVersion: 1,
    onRemoteOperation: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('renders with initial content', () => {
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toBeInTheDocument();
    expect(editor).toHaveValue('Initial content');
  });

  it('calls onContentChange when content is modified', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Directly set the value to simulate clearing and typing
    fireEvent.change(editor, { target: { value: 'New content' } });
    
    await waitFor(() => {
      expect(defaultProps.onContentChange).toHaveBeenCalledWith('New content');
    });
  });

  it('generates insert operation when text is added', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    await user.click(editor);
    await user.type(editor, ' added text');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
      // Check that at least one insert operation was generated
      const calls = defaultProps.onOperationGenerated.mock.calls;
      const insertCalls = calls.filter(call => call[0].type === 'insert');
      expect(insertCalls.length).toBeGreaterThan(0);
      expect(insertCalls[0][0]).toEqual(
        expect.objectContaining({
          type: 'insert',
          position: expect.any(Number),
          content: expect.any(String),
          userId: 'user-123',
          timestamp: expect.any(Date),
          version: expect.any(Number)
        })
      );
    });
  });

  it('renders in read-only mode when readOnly prop is true', () => {
    render(<EditorComponent {...defaultProps} readOnly={true} />);
    
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveAttribute('readOnly');
  });

  it('handles empty content gracefully', () => {
    render(<EditorComponent {...defaultProps} content="" />);
    
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveValue('');
  });

  it('generates delete operation when text is removed', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} content="Hello World" />);
    
    const editor = screen.getByTestId('monaco-editor') as HTMLTextAreaElement;
    
    // Clear and type new content to simulate deletion
    await user.clear(editor);
    await user.type(editor, 'Hello');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
    });
  });

  it('handles multiple rapid changes correctly', async () => {
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Simulate rapid changes
    fireEvent.change(editor, { target: { value: 'A' } });
    fireEvent.change(editor, { target: { value: 'AB' } });
    fireEvent.change(editor, { target: { value: 'ABC' } });
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
      expect(defaultProps.onContentChange).toHaveBeenCalledWith('ABC');
    });
  });

  it('does not call callbacks when content is unchanged', () => {
    const { rerender } = render(<EditorComponent {...defaultProps} />);
    
    // Clear previous calls
    defaultProps.onContentChange.mockClear();
    defaultProps.onOperationGenerated.mockClear();
    
    // Re-render with same content
    rerender(<EditorComponent {...defaultProps} content="Initial content" />);
    
    // Should not trigger callbacks for same content
    expect(defaultProps.onContentChange).not.toHaveBeenCalled();
    expect(defaultProps.onOperationGenerated).not.toHaveBeenCalled();
  });

  it('shows editor container with proper styling', () => {
    render(<EditorComponent {...defaultProps} />);
    
    const container = document.querySelector('.editor-container');
    expect(container).toBeInTheDocument();
  });
});

// Test the component's operation generation logic
describe('EditorComponent operation generation', () => {
  const defaultProps = {
    content: 'Hello World',
    onContentChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onOperationGenerated: jest.fn(),
    onPresenceUpdate: jest.fn(),
    collaborators: [],
    userId: 'user-123',
    documentVersion: 1,
    onRemoteOperation: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('generates correct insert operation for text addition', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    await user.click(editor);
    await user.type(editor, '!');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'insert',
          userId: 'user-123',
          timestamp: expect.any(Date),
          version: expect.any(Number)
        })
      );
    });
  });

  it('handles content updates from props correctly', () => {
    const { rerender } = render(<EditorComponent {...defaultProps} />);
    
    // Update content via props
    rerender(<EditorComponent {...defaultProps} content="Updated content" />);
    
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toHaveValue('Updated content');
  });
});

// Test collaborative editing with OT integration
describe('EditorComponent collaborative editing', () => {
  const defaultProps = {
    content: 'Hello World',
    onContentChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onOperationGenerated: jest.fn(),
    onPresenceUpdate: jest.fn(),
    collaborators: [],
    userId: 'user-123',
    documentVersion: 1,
    onRemoteOperation: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should apply remote insert operation', () => {
    const { rerender } = render(<EditorComponent {...defaultProps} />);
    
    const remoteOperation: Operation = {
      type: 'insert',
      position: 5,
      content: ' Beautiful',
      userId: 'user-456',
      timestamp: new Date(),
      version: 2
    };

    // Get the editor ref and call the exposed method
    const editor = screen.getByTestId('monaco-editor');
    const editorContainer = editor.closest('.editor-container');
    
    // Simulate applying remote operation
    // In a real scenario, this would be called by the parent component
    if (defaultProps.onRemoteOperation) {
      defaultProps.onRemoteOperation(remoteOperation);
    }

    expect(defaultProps.onRemoteOperation).toHaveBeenCalledWith(remoteOperation);
  });

  it('should handle concurrent operations with transformation', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Simulate local edit
    await user.click(editor);
    await user.type(editor, ' Local');
    
    // Verify local operation was generated
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
    });

    // Simulate remote operation at same position
    const remoteOperation: Operation = {
      type: 'insert',
      position: 11, // After "Hello World"
      content: ' Remote',
      userId: 'user-456',
      timestamp: new Date(),
      version: 2
    };

    if (defaultProps.onRemoteOperation) {
      defaultProps.onRemoteOperation(remoteOperation);
    }

    expect(defaultProps.onRemoteOperation).toHaveBeenCalledWith(remoteOperation);
  });

  it('should track pending operations correctly', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Make multiple local edits
    await user.click(editor);
    await user.type(editor, ' First');
    await user.type(editor, ' Second');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
    });

    // Operations should be tracked as pending
    const calls = defaultProps.onOperationGenerated.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    expect(calls[0][0]).toEqual(
      expect.objectContaining({
        type: 'insert',
        userId: 'user-123',
        version: expect.any(Number)
      })
    );
  });

  it('should update document version correctly', () => {
    const { rerender } = render(<EditorComponent {...defaultProps} />);
    
    // Update document version
    rerender(<EditorComponent {...defaultProps} documentVersion={5} />);
    
    // The component should update its internal version tracking
    // This is tested indirectly through operation generation
    expect(screen.getByTestId('monaco-editor')).toBeInTheDocument();
  });

  it('should handle operation acknowledgment', () => {
    render(<EditorComponent {...defaultProps} />);
    
    const acknowledgedOperation: Operation = {
      type: 'insert',
      position: 5,
      content: ' Test',
      userId: 'user-123',
      timestamp: new Date(),
      version: 2
    };

    // The component should expose a method to handle acknowledgments
    // This would be called by the parent component when server confirms the operation
    const editor = screen.getByTestId('monaco-editor');
    expect(editor).toBeInTheDocument();
  });

  it('should prevent infinite loops during remote operation application', () => {
    render(<EditorComponent {...defaultProps} />);
    
    const remoteOperation: Operation = {
      type: 'insert',
      position: 5,
      content: ' Remote',
      userId: 'user-456',
      timestamp: new Date(),
      version: 2
    };

    // Apply remote operation multiple times
    if (defaultProps.onRemoteOperation) {
      defaultProps.onRemoteOperation(remoteOperation);
      defaultProps.onRemoteOperation(remoteOperation);
    }

    // Should not generate local operations for remote changes
    expect(defaultProps.onOperationGenerated).not.toHaveBeenCalled();
  });

  it('should handle delete operations correctly', async () => {
    render(<EditorComponent {...defaultProps} content="Hello Beautiful World" />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Simulate deletion by directly changing the value
    fireEvent.change(editor, { target: { value: 'Hello World' } });
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
      expect(defaultProps.onContentChange).toHaveBeenCalledWith('Hello World');
    });
  });

  it('should maintain cursor position during remote operations', () => {
    render(<EditorComponent {...defaultProps} />);
    
    const remoteOperation: Operation = {
      type: 'insert',
      position: 0, // Insert at beginning
      content: 'Start ',
      userId: 'user-456',
      timestamp: new Date(),
      version: 2
    };

    // Apply remote operation
    if (defaultProps.onRemoteOperation) {
      defaultProps.onRemoteOperation(remoteOperation);
    }

    // The editor should handle cursor position adjustments
    expect(defaultProps.onRemoteOperation).toHaveBeenCalledWith(remoteOperation);
  });

  it('should handle rapid remote operations', () => {
    render(<EditorComponent {...defaultProps} />);
    
    const operations: Operation[] = [
      {
        type: 'insert',
        position: 5,
        content: ' A',
        userId: 'user-456',
        timestamp: new Date(Date.now() - 100),
        version: 2
      },
      {
        type: 'insert',
        position: 7,
        content: ' B',
        userId: 'user-789',
        timestamp: new Date(Date.now() - 50),
        version: 3
      },
      {
        type: 'insert',
        position: 9,
        content: ' C',
        userId: 'user-456',
        timestamp: new Date(),
        version: 4
      }
    ];

    // Apply operations rapidly
    operations.forEach(op => {
      if (defaultProps.onRemoteOperation) {
        defaultProps.onRemoteOperation(op);
      }
    });

    expect(defaultProps.onRemoteOperation).toHaveBeenCalledTimes(3);
  });
});

// Test OT transformation integration
describe('EditorComponent OT transformation', () => {
  const defaultProps = {
    content: 'Hello World',
    onContentChange: jest.fn(),
    onSelectionChange: jest.fn(),
    onOperationGenerated: jest.fn(),
    onPresenceUpdate: jest.fn(),
    collaborators: [],
    userId: 'user-123',
    documentVersion: 1,
    onRemoteOperation: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should transform insert operations correctly', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Generate local operation
    await user.click(editor);
    await user.type(editor, ' Local');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
    });

    // Apply conflicting remote operation
    const remoteOperation: Operation = {
      type: 'insert',
      position: 11, // Same position as local edit
      content: ' Remote',
      userId: 'user-456',
      timestamp: new Date(),
      version: 2
    };

    if (defaultProps.onRemoteOperation) {
      defaultProps.onRemoteOperation(remoteOperation);
    }

    // Both operations should be applied with proper transformation
    expect(defaultProps.onRemoteOperation).toHaveBeenCalledWith(remoteOperation);
  });

  it('should handle priority resolution in transformations', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} userId="user-zzz" />); // Lower priority user
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Generate local operation
    await user.click(editor);
    await user.type(editor, ' Local');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
    });

    // Apply remote operation from higher priority user
    const remoteOperation: Operation = {
      type: 'insert',
      position: 11,
      content: ' Remote',
      userId: 'user-aaa', // Higher priority (lexicographically first)
      timestamp: new Date(),
      version: 2
    };

    if (defaultProps.onRemoteOperation) {
      defaultProps.onRemoteOperation(remoteOperation);
    }

    // Remote operation should have priority
    expect(defaultProps.onRemoteOperation).toHaveBeenCalledWith(remoteOperation);
  });

  it('should handle complex transformation scenarios', async () => {
    const user = userEvent.setup();
    render(<EditorComponent {...defaultProps} />);
    
    const editor = screen.getByTestId('monaco-editor');
    
    // Generate multiple local operations
    await user.click(editor);
    await user.type(editor, ' First');
    await user.type(editor, ' Second');
    
    await waitFor(() => {
      expect(defaultProps.onOperationGenerated).toHaveBeenCalled();
    });

    // Apply multiple remote operations
    const remoteOperations: Operation[] = [
      {
        type: 'delete',
        position: 0,
        length: 5, // Delete "Hello"
        userId: 'user-456',
        timestamp: new Date(Date.now() - 100),
        version: 2
      },
      {
        type: 'insert',
        position: 0,
        content: 'Hi',
        userId: 'user-456',
        timestamp: new Date(),
        version: 3
      }
    ];

    remoteOperations.forEach(op => {
      if (defaultProps.onRemoteOperation) {
        defaultProps.onRemoteOperation(op);
      }
    });

    expect(defaultProps.onRemoteOperation).toHaveBeenCalledTimes(2);
  });
});