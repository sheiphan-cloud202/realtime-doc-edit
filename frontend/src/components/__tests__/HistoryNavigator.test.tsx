/**
 * Tests for HistoryNavigator component
 */

import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import { HistoryNavigator, HistoryNavigatorProps } from '../HistoryNavigator';
import { HistoryEntry } from '../../../../shared/types';

// Mock CSS import
jest.mock('../HistoryNavigator.css', () => ({}));

describe('HistoryNavigator', () => {
  const mockHistoryEntries: HistoryEntry[] = [
    {
      id: 'entry-1',
      operation: {
        type: 'insert',
        position: 0,
        content: 'Hello',
        userId: 'user-1',
        timestamp: new Date('2023-01-01T10:00:00Z'),
        version: 1
      },
      inverseOperation: {
        type: 'delete',
        position: 0,
        length: 5,
        userId: 'user-1',
        timestamp: new Date('2023-01-01T10:00:00Z'),
        version: 1
      },
      documentStateBefore: '',
      documentStateAfter: 'Hello',
      timestamp: new Date('2023-01-01T10:00:00Z'),
      isAIOperation: false,
      description: 'Insert 5 characters'
    },
    {
      id: 'entry-2',
      operation: {
        type: 'insert',
        position: 5,
        content: ' World',
        userId: 'user-1',
        timestamp: new Date('2023-01-01T10:01:00Z'),
        version: 2
      },
      inverseOperation: {
        type: 'delete',
        position: 5,
        length: 6,
        userId: 'user-1',
        timestamp: new Date('2023-01-01T10:01:00Z'),
        version: 2
      },
      documentStateBefore: 'Hello',
      documentStateAfter: 'Hello World',
      timestamp: new Date('2023-01-01T10:01:00Z'),
      isAIOperation: true,
      aiRequestId: 'ai-123',
      description: 'AI: Insert 6 characters'
    }
  ];

  const defaultProps: HistoryNavigatorProps = {
    canUndo: true,
    canRedo: false,
    historySize: 2,
    historyEntries: mockHistoryEntries,
    currentIndex: 1,
    onUndo: jest.fn(),
    onRedo: jest.fn(),
    onJumpToHistoryPoint: jest.fn(),
    onClearHistory: jest.fn(),
    showHistoryPanel: false,
    onToggleHistoryPanel: jest.fn()
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('rendering', () => {
    it('should render undo and redo buttons', () => {
      render(<HistoryNavigator {...defaultProps} />);

      expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeInTheDocument();
      expect(screen.getByTitle('Redo (Ctrl+Shift+Z)')).toBeInTheDocument();
    });

    it('should show current position in history', () => {
      render(<HistoryNavigator {...defaultProps} />);

      expect(screen.getByText('2/2')).toBeInTheDocument();
    });

    it('should show keyboard shortcuts help', () => {
      render(<HistoryNavigator {...defaultProps} />);

      expect(screen.getByText('Ctrl+Z: Undo | Ctrl+Shift+Z: Redo')).toBeInTheDocument();
    });

    it('should render toggle panel button when callback provided', () => {
      render(<HistoryNavigator {...defaultProps} />);

      expect(screen.getByTitle('Toggle History Panel')).toBeInTheDocument();
    });

    it('should not render toggle panel button when callback not provided', () => {
      const props = { ...defaultProps, onToggleHistoryPanel: undefined };
      render(<HistoryNavigator {...props} />);

      expect(screen.queryByTitle('Toggle History Panel')).not.toBeInTheDocument();
    });

    it('should render clear history button when history exists', () => {
      render(<HistoryNavigator {...defaultProps} />);

      expect(screen.getByTitle('Clear History')).toBeInTheDocument();
    });

    it('should not render clear history button when no history', () => {
      const props = { ...defaultProps, historySize: 0, historyEntries: [] };
      render(<HistoryNavigator {...props} />);

      expect(screen.queryByTitle('Clear History')).not.toBeInTheDocument();
    });
  });

  describe('button states', () => {
    it('should enable undo button when canUndo is true', () => {
      render(<HistoryNavigator {...defaultProps} canUndo={true} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      expect(undoButton).not.toBeDisabled();
      expect(undoButton).not.toHaveClass('disabled');
    });

    it('should disable undo button when canUndo is false', () => {
      render(<HistoryNavigator {...defaultProps} canUndo={false} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      expect(undoButton).toBeDisabled();
      expect(undoButton).toHaveClass('disabled');
    });

    it('should enable redo button when canRedo is true', () => {
      render(<HistoryNavigator {...defaultProps} canRedo={true} />);

      const redoButton = screen.getByTitle('Redo (Ctrl+Shift+Z)');
      expect(redoButton).not.toBeDisabled();
      expect(redoButton).not.toHaveClass('disabled');
    });

    it('should disable redo button when canRedo is false', () => {
      render(<HistoryNavigator {...defaultProps} canRedo={false} />);

      const redoButton = screen.getByTitle('Redo (Ctrl+Shift+Z)');
      expect(redoButton).toBeDisabled();
      expect(redoButton).toHaveClass('disabled');
    });

    it('should highlight panel toggle button when panel is shown', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      const toggleButton = screen.getByTitle('Toggle History Panel');
      expect(toggleButton).toHaveClass('active');
    });
  });

  describe('user interactions', () => {
    it('should call onUndo when undo button is clicked', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      await user.click(undoButton);

      expect(defaultProps.onUndo).toHaveBeenCalledTimes(1);
    });

    it('should call onRedo when redo button is clicked', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} canRedo={true} />);

      const redoButton = screen.getByTitle('Redo (Ctrl+Shift+Z)');
      await user.click(redoButton);

      expect(defaultProps.onRedo).toHaveBeenCalledTimes(1);
    });

    it('should not call onUndo when undo button is disabled', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} canUndo={false} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      await user.click(undoButton);

      expect(defaultProps.onUndo).not.toHaveBeenCalled();
    });

    it('should call onToggleHistoryPanel when toggle button is clicked', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} />);

      const toggleButton = screen.getByTitle('Toggle History Panel');
      await user.click(toggleButton);

      expect(defaultProps.onToggleHistoryPanel).toHaveBeenCalledTimes(1);
    });

    it('should call onClearHistory when clear button is clicked', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} />);

      const clearButton = screen.getByTitle('Clear History');
      await user.click(clearButton);

      expect(defaultProps.onClearHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe('keyboard shortcuts', () => {
    it('should handle Ctrl+Z for undo', () => {
      render(<HistoryNavigator {...defaultProps} />);

      const container = document.querySelector('.history-navigator');
      fireEvent.keyDown(container!, { key: 'z', ctrlKey: true });

      expect(defaultProps.onUndo).toHaveBeenCalledTimes(1);
    });

    it('should handle Cmd+Z for undo on Mac', () => {
      render(<HistoryNavigator {...defaultProps} />);

      const container = document.querySelector('.history-navigator');
      fireEvent.keyDown(container!, { key: 'z', metaKey: true });

      expect(defaultProps.onUndo).toHaveBeenCalledTimes(1);
    });

    it('should handle Ctrl+Shift+Z for redo', () => {
      render(<HistoryNavigator {...defaultProps} canRedo={true} />);

      const container = document.querySelector('.history-navigator');
      fireEvent.keyDown(container!, { key: 'z', ctrlKey: true, shiftKey: true });

      expect(defaultProps.onRedo).toHaveBeenCalledTimes(1);
    });

    it('should not trigger undo when canUndo is false', () => {
      render(<HistoryNavigator {...defaultProps} canUndo={false} />);

      const container = document.querySelector('.history-navigator');
      fireEvent.keyDown(container!, { key: 'z', ctrlKey: true });

      expect(defaultProps.onUndo).not.toHaveBeenCalled();
    });

    it('should not trigger redo when canRedo is false', () => {
      render(<HistoryNavigator {...defaultProps} canRedo={false} />);

      const container = document.querySelector('.history-navigator');
      fireEvent.keyDown(container!, { key: 'z', ctrlKey: true, shiftKey: true });

      expect(defaultProps.onRedo).not.toHaveBeenCalled();
    });

    it('should prevent default behavior for keyboard shortcuts', () => {
      render(<HistoryNavigator {...defaultProps} />);

      const container = document.querySelector('.history-navigator');
      const event = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, bubbles: true });
      const preventDefaultSpy = jest.spyOn(event, 'preventDefault');

      fireEvent(container!, event);

      expect(preventDefaultSpy).toHaveBeenCalled();
    });
  });

  describe('history panel', () => {
    it('should show history panel when showHistoryPanel is true', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      expect(screen.getByText('Operation History')).toBeInTheDocument();
      expect(screen.getByText('Total: 2')).toBeInTheDocument();
      expect(screen.getByText('AI: 1')).toBeInTheDocument();
    });

    it('should not show history panel when showHistoryPanel is false', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={false} />);

      expect(screen.queryByText('Operation History')).not.toBeInTheDocument();
    });

    it('should display history entries in the panel', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      expect(screen.getByText('Insert 5 characters')).toBeInTheDocument();
      expect(screen.getByText('AI: Insert 6 characters')).toBeInTheDocument();
    });

    it('should show empty state when no history entries', () => {
      const props = { ...defaultProps, historyEntries: [], historySize: 0, showHistoryPanel: true };
      render(<HistoryNavigator {...props} />);

      expect(screen.getByText('No operations in history')).toBeInTheDocument();
    });

    it('should format timestamps correctly', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      // Check that timestamps are displayed (exact format may vary by locale)
      const timeElements = document.querySelectorAll('.history-entry-time');
      expect(timeElements).toHaveLength(2);
      expect(timeElements[0]).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/);
      expect(timeElements[1]).toHaveTextContent(/\d{1,2}:\d{2}:\d{2}/);
    });

    it('should show AI request ID for AI operations', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      expect(screen.getByText('AI: ai-123')).toBeInTheDocument();
    });

    it('should call onJumpToHistoryPoint when history entry is clicked', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      const firstEntry = screen.getByText('Insert 5 characters').closest('.history-entry');
      expect(firstEntry).toBeInTheDocument();

      await user.click(firstEntry!);

      expect(defaultProps.onJumpToHistoryPoint).toHaveBeenCalledWith(0);
    });

    it('should show current indicator for current history position', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} currentIndex={1} />);

      const indicators = screen.getAllByText('●');
      expect(indicators).toHaveLength(1);
    });

    it('should apply correct CSS classes to history entries', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} currentIndex={0} />);

      const entries = screen.getAllByText(/Insert \d+ characters/).map(el => el.closest('.history-entry'));
      
      // First entry should be applied (index 0, currentIndex 0)
      expect(entries[0]).toHaveClass('applied');
      expect(entries[0]).toHaveClass('user-operation');
      
      // Second entry should be unapplied (index 1, currentIndex 0)
      expect(entries[1]).toHaveClass('unapplied');
      expect(entries[1]).toHaveClass('ai-operation');
    });

    it('should show clear all history button in panel footer', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      expect(screen.getByText('Clear All History')).toBeInTheDocument();
    });

    it('should call onClearHistory when panel clear button is clicked', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      const clearButton = screen.getByText('Clear All History');
      await user.click(clearButton);

      expect(defaultProps.onClearHistory).toHaveBeenCalledTimes(1);
    });
  });

  describe('tooltips', () => {
    it('should show tooltip on undo button hover', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      await user.hover(undoButton);

      await waitFor(() => {
        expect(screen.getByText('Undo (available)')).toBeInTheDocument();
      });
    });

    it('should show tooltip on redo button hover', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} canRedo={true} />);

      const redoButton = screen.getByTitle('Redo (Ctrl+Shift+Z)');
      await user.hover(redoButton);

      await waitFor(() => {
        expect(screen.getByText('Redo (available)')).toBeInTheDocument();
      });
    });

    it('should show unavailable tooltip for disabled buttons', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} canUndo={false} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      await user.hover(undoButton);

      await waitFor(() => {
        expect(screen.getByText('Undo (unavailable)')).toBeInTheDocument();
      }, { timeout: 3000 });
    });

    it('should hide tooltip on mouse leave', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} />);

      const undoButton = screen.getByTitle('Undo (Ctrl+Z)');
      await user.hover(undoButton);

      await waitFor(() => {
        expect(screen.getByText('Undo (available)')).toBeInTheDocument();
      });

      await user.unhover(undoButton);

      await waitFor(() => {
        expect(screen.queryByText('Undo (available)')).not.toBeInTheDocument();
      });
    });

    it('should show clear history tooltip', async () => {
      const user = userEvent.setup();
      render(<HistoryNavigator {...defaultProps} />);

      const clearButton = screen.getByTitle('Clear History');
      await user.hover(clearButton);

      await waitFor(() => {
        expect(screen.getByText('Clear all history')).toBeInTheDocument();
      });
    });
  });

  describe('operation icons', () => {
    it('should show correct icons for different operation types', () => {
      const entries: HistoryEntry[] = [
        {
          ...mockHistoryEntries[0],
          operation: { ...mockHistoryEntries[0].operation, type: 'insert' },
          isAIOperation: false
        },
        {
          ...mockHistoryEntries[1],
          operation: { ...mockHistoryEntries[1].operation, type: 'delete' },
          isAIOperation: false
        },
        {
          ...mockHistoryEntries[0],
          id: 'entry-3',
          operation: { ...mockHistoryEntries[0].operation, type: 'retain' },
          isAIOperation: false
        },
        {
          ...mockHistoryEntries[0],
          id: 'entry-4',
          isAIOperation: true
        }
      ];

      render(<HistoryNavigator {...defaultProps} historyEntries={entries} showHistoryPanel={true} />);

      // Check for operation icons (exact emojis may vary by system)
      const icons = screen.getAllByText(/[➕➖↔️🤖]/);
      expect(icons.length).toBeGreaterThan(0);
    });
  });

  describe('accessibility', () => {
    it('should be focusable', () => {
      render(<HistoryNavigator {...defaultProps} />);

      const container = document.querySelector('.history-navigator');
      expect(container).toHaveAttribute('tabindex', '0');
    });

    it('should have proper button titles for screen readers', () => {
      render(<HistoryNavigator {...defaultProps} />);

      expect(screen.getByTitle('Undo (Ctrl+Z)')).toBeInTheDocument();
      expect(screen.getByTitle('Redo (Ctrl+Shift+Z)')).toBeInTheDocument();
      expect(screen.getByTitle('Toggle History Panel')).toBeInTheDocument();
      expect(screen.getByTitle('Clear History')).toBeInTheDocument();
    });

    it('should have proper click titles for history entries', () => {
      render(<HistoryNavigator {...defaultProps} showHistoryPanel={true} />);

      const entries = screen.getAllByTitle('Click to jump to this point in history');
      expect(entries).toHaveLength(2);
    });
  });
});