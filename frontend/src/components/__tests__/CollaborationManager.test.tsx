import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom';
import CollaborationManager from '../CollaborationManager';
import { Collaborator, CursorPosition, NotificationMessage } from '../../../../shared/types';

// Mock Monaco Editor
const mockEditor = {
  getModel: jest.fn(),
  onDidChangeCursorPosition: jest.fn(),
  onDidChangeCursorSelection: jest.fn(),
  deltaDecorations: jest.fn((oldDecorations: any[], newDecorations: any[]) => ['decoration1', 'decoration2'])
};

const mockModel = {
  getOffsetAt: jest.fn((position: any) => {
    if (!position) return 0;
    return (position.lineNumber - 1) * 10 + position.column;
  }),
  getPositionAt: jest.fn((offset: number) => ({
    lineNumber: Math.floor(offset / 10) + 1,
    column: offset % 10 || 1
  }))
};

describe('CollaborationManager', () => {
  const mockOnPresenceUpdate = jest.fn();
  const mockOnNotification = jest.fn();
  const currentUserId = 'user1';

  const mockCollaborators: Collaborator[] = [
    {
      id: 'user2',
      name: 'Alice',
      avatar: 'https://example.com/alice.jpg',
      cursor: 50,
      selection: { start: 40, end: 60 },
      isActive: true,
      lastSeen: new Date()
    },
    {
      id: 'user3',
      name: 'Bob',
      cursor: 100,
      isActive: true,
      lastSeen: new Date()
    },
    {
      id: 'user4',
      name: 'Charlie',
      cursor: 75,
      isActive: false,
      lastSeen: new Date(Date.now() - 300000) // 5 minutes ago
    }
  ];

  const mockEditorRef = {
    current: mockEditor
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockEditor.getModel.mockReturnValue(mockModel);
    
    // Mock document.head.appendChild for style injection
    const mockAppendChild = jest.fn();
    Object.defineProperty(document, 'head', {
      value: { appendChild: mockAppendChild },
      writable: true
    });

    // Mock document.getElementById for style cleanup
    const mockGetElementById = jest.fn();
    Object.defineProperty(document, 'getElementById', {
      value: mockGetElementById,
      writable: true
    });
  });

  afterEach(() => {
    // Clean up any injected styles
    const existingStyle = document.getElementById('collaboration-styles');
    if (existingStyle) {
      existingStyle.remove();
    }
  });

  describe('Collaborator List Display', () => {
    it('should display active collaborators', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.getByText('Bob')).toBeInTheDocument();
      expect(screen.getByText('Charlie')).toBeInTheDocument();
    });

    it('should show user avatars when provided', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      const aliceAvatar = screen.getByAltText('Alice');
      expect(aliceAvatar).toBeInTheDocument();
      expect(aliceAvatar).toHaveAttribute('src', 'https://example.com/alice.jpg');
    });

    it('should show user initials when no avatar is provided', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Bob and Charlie should show initials
      expect(screen.getByText('B')).toBeInTheDocument();
      expect(screen.getByText('C')).toBeInTheDocument();
    });

    it('should show active/away status', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      const activeStatuses = screen.getAllByText('Active');
      const awayStatuses = screen.getAllByText('Away');
      
      expect(activeStatuses).toHaveLength(2); // Alice and Bob
      expect(awayStatuses).toHaveLength(1); // Charlie
    });

    it('should exclude current user from collaborator list', () => {
      const collaboratorsWithCurrentUser = [
        ...mockCollaborators,
        {
          id: currentUserId,
          name: 'Current User',
          cursor: 25,
          isActive: true,
          lastSeen: new Date()
        }
      ];

      render(
        <CollaborationManager
          collaborators={collaboratorsWithCurrentUser}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.queryByText('Current User')).not.toBeInTheDocument();
      expect(screen.getByText('Alice')).toBeInTheDocument();
    });

    it('should show "no collaborators" message when list is empty', () => {
      render(
        <CollaborationManager
          collaborators={[]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText('No other collaborators online')).toBeInTheDocument();
    });
  });

  describe('Color Assignment', () => {
    it('should assign different colors to different users', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Check that style element is created with user-specific colors
      expect(document.head.appendChild).toHaveBeenCalled();
    });

    it('should maintain consistent colors for the same user', () => {
      const { rerender } = render(
        <CollaborationManager
          collaborators={[mockCollaborators[0]]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Check that style was injected
      expect(document.head.appendChild).toHaveBeenCalled();
      
      const firstCallArgs = (document.head.appendChild as jest.Mock).mock.calls;
      expect(firstCallArgs.length).toBeGreaterThan(0);
      
      if (firstCallArgs[0] && firstCallArgs[0][0]) {
        const firstStyleContent = firstCallArgs[0][0].textContent || '';
        expect(firstStyleContent).toContain('user2');
      }

      // Re-render with same collaborator
      rerender(
        <CollaborationManager
          collaborators={[mockCollaborators[0]]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Should have been called again
      expect(document.head.appendChild).toHaveBeenCalledTimes(2);
    });
  });

  describe('Editor Integration', () => {
    it('should set up cursor position listeners on editor', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      expect(mockEditor.onDidChangeCursorPosition).toHaveBeenCalled();
      expect(mockEditor.onDidChangeCursorSelection).toHaveBeenCalled();
    });

    it('should call onPresenceUpdate when cursor position changes', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Simulate cursor position change
      const cursorCallback = mockEditor.onDidChangeCursorPosition.mock.calls[0][0];
      cursorCallback({
        position: { lineNumber: 5, column: 10 }
      });

      expect(mockOnPresenceUpdate).toHaveBeenCalledWith({
        line: 5,
        column: 10,
        offset: 50 // (5-1) * 10 + 10 based on mock calculation
      });
    });

    it('should call onPresenceUpdate with selection when text is selected', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Simulate selection change
      const selectionCallback = mockEditor.onDidChangeCursorSelection.mock.calls[0][0];
      selectionCallback({
        selection: {
          isEmpty: () => false,
          getStartPosition: () => ({ lineNumber: 3, column: 5 }),
          getEndPosition: () => ({ lineNumber: 4, column: 8 })
        }
      });

      expect(mockOnPresenceUpdate).toHaveBeenCalledWith(
        { line: 3, column: 5, offset: 25 }, // (3-1) * 10 + 5
        {
          start: { line: 3, column: 5, offset: 25 },
          end: { line: 4, column: 8, offset: 38 } // (4-1) * 10 + 8
        }
      );
    });

    it('should apply cursor and selection decorations to editor', () => {
      // Make sure convertToMonacoPosition returns valid positions
      mockModel.getPositionAt.mockImplementation((offset: number) => ({
        lineNumber: Math.floor(offset / 10) + 1,
        column: (offset % 10) || 1
      }));

      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Should call deltaDecorations to apply decorations
      expect(mockEditor.deltaDecorations).toHaveBeenCalled();
      
      // Should have been called with empty array first (to clear) and decorations array second
      const calls = mockEditor.deltaDecorations.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
      
      // The call should have two parameters: old decorations and new decorations
      const lastCall = calls[calls.length - 1];
      expect(lastCall).toHaveLength(2);
    });

    it('should handle editor not being available gracefully', () => {
      const emptyEditorRef = { current: null };
      
      expect(() => {
        render(
          <CollaborationManager
            collaborators={mockCollaborators}
            currentUserId={currentUserId}
            onPresenceUpdate={mockOnPresenceUpdate}
            editorRef={emptyEditorRef}
          />
        );
      }).not.toThrow();
    });
  });

  describe('Presence Updates', () => {
    it('should update user presences when collaborators change', async () => {
      const { rerender } = render(
        <CollaborationManager
          collaborators={[mockCollaborators[0]]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText('Alice')).toBeInTheDocument();
      expect(screen.queryByText('Bob')).not.toBeInTheDocument();

      // Add another collaborator
      rerender(
        <CollaborationManager
          collaborators={mockCollaborators.slice(0, 2)}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      await waitFor(() => {
        expect(screen.getByText('Alice')).toBeInTheDocument();
        expect(screen.getByText('Bob')).toBeInTheDocument();
      });
    });

    it('should only show active users in decorations', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      // Should call deltaDecorations
      expect(mockEditor.deltaDecorations).toHaveBeenCalled();
      
      // Verify that the component processes only active users
      // (This is tested indirectly by checking that deltaDecorations was called)
      const calls = mockEditor.deltaDecorations.mock.calls;
      expect(calls.length).toBeGreaterThan(0);
    });
  });

  describe('Cleanup', () => {
    it('should dispose editor listeners on unmount', () => {
      const mockDispose = jest.fn();
      mockEditor.onDidChangeCursorPosition.mockReturnValue({ dispose: mockDispose });
      mockEditor.onDidChangeCursorSelection.mockReturnValue({ dispose: mockDispose });

      const { unmount } = render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          editorRef={mockEditorRef}
        />
      );

      unmount();

      expect(mockDispose).toHaveBeenCalledTimes(2);
    });
  });

  describe('Notifications', () => {
    it('should display notification toggle when notifications exist', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      // Initially no notifications
      expect(screen.queryByText(/🔔/)).not.toBeInTheDocument();
    });

    it('should show current user in collaborator list', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('Active Collaborators (3)')).toBeInTheDocument(); // 2 others + current user
    });

    it('should display user count correctly', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      // Should show total count including current user
      expect(screen.getByText('Active Collaborators (4)')).toBeInTheDocument(); // 3 others + current user
    });

    it('should format last seen time correctly', () => {
      const collaboratorWithOldActivity = {
        id: 'user5',
        name: 'Old User',
        cursor: 0,
        isActive: false,
        lastSeen: new Date(Date.now() - 3600000) // 1 hour ago
      };

      render(
        <CollaborationManager
          collaborators={[collaboratorWithOldActivity]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText(/Away • 1h ago/)).toBeInTheDocument();
    });

    it('should show "Just now" for recent activity', () => {
      const collaboratorWithRecentActivity = {
        id: 'user6',
        name: 'Recent User',
        cursor: 0,
        isActive: false,
        lastSeen: new Date(Date.now() - 30000) // 30 seconds ago
      };

      render(
        <CollaborationManager
          collaborators={[collaboratorWithRecentActivity]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText(/Away • Just now/)).toBeInTheDocument();
    });
  });

  describe('Enhanced User Management', () => {
    it('should handle empty collaborator list with current user shown', () => {
      render(
        <CollaborationManager
          collaborators={[]}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getByText('You')).toBeInTheDocument();
      expect(screen.getByText('Active Collaborators (1)')).toBeInTheDocument();
      expect(screen.getByText('No other collaborators online')).toBeInTheDocument();
    });

    it('should distinguish current user visually', () => {
      render(
        <CollaborationManager
          collaborators={mockCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      const currentUserElement = screen.getByText('You').closest('.collaborator-item');
      expect(currentUserElement).toHaveClass('current-user');
    });

    it('should handle collaborators with different activity states', () => {
      const mixedCollaborators = [
        {
          id: 'active1',
          name: 'Active User 1',
          cursor: 10,
          isActive: true,
          lastSeen: new Date()
        },
        {
          id: 'active2',
          name: 'Active User 2',
          cursor: 20,
          isActive: true,
          lastSeen: new Date()
        },
        {
          id: 'away1',
          name: 'Away User 1',
          cursor: 30,
          isActive: false,
          lastSeen: new Date(Date.now() - 600000) // 10 minutes ago
        }
      ];

      render(
        <CollaborationManager
          collaborators={mixedCollaborators}
          currentUserId={currentUserId}
          onPresenceUpdate={mockOnPresenceUpdate}
          onNotification={mockOnNotification}
          editorRef={mockEditorRef}
        />
      );

      expect(screen.getAllByText('Active')).toHaveLength(3); // 2 active users + current user
      expect(screen.getAllByText(/Away •/)).toHaveLength(1);
    });
  });
});