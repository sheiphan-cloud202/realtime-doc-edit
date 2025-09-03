import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import '@testing-library/jest-dom';
import AIPromptInterface, { AIPromptInterfaceProps } from '../AIPromptInterface';
import { TextSelection } from '../EditorComponent';

describe('AIPromptInterface', () => {
  const defaultProps: AIPromptInterfaceProps = {
    isVisible: true,
    selectedText: 'This is selected text',
    selection: {
      start: 0,
      end: 21,
      text: 'This is selected text'
    },
    onPromptSubmit: jest.fn(),
    onCancel: jest.fn(),
    onAcceptChanges: jest.fn(),
    onRejectChanges: jest.fn(),
    isProcessing: false,
  };

  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('Visibility', () => {
    it('should render when visible', () => {
      render(<AIPromptInterface {...defaultProps} />);
      
      expect(screen.getByText('AI Assistant')).toBeInTheDocument();
      expect(screen.getByText('This is selected text')).toBeInTheDocument();
    });

    it('should not render when not visible', () => {
      render(<AIPromptInterface {...defaultProps} isVisible={false} />);
      
      expect(screen.queryByText('AI Assistant')).not.toBeInTheDocument();
    });

    it('should show selected text info', () => {
      render(<AIPromptInterface {...defaultProps} />);
      
      expect(screen.getByText(/Selected text \(21 characters\):/)).toBeInTheDocument();
      expect(screen.getByText('This is selected text')).toBeInTheDocument();
    });

    it('should truncate long selected text', () => {
      const longText = 'A'.repeat(150);
      const props = {
        ...defaultProps,
        selectedText: longText,
        selection: {
          start: 0,
          end: longText.length,
          text: longText
        }
      };
      
      render(<AIPromptInterface {...props} />);
      
      expect(screen.getByText(/A{100}\.\.\.$/)).toBeInTheDocument();
    });
  });

  describe('Prompt Input', () => {
    it('should render prompt input form initially', () => {
      render(<AIPromptInterface {...defaultProps} />);
      
      expect(screen.getByLabelText(/What would you like the AI to do/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Generate' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
    });

    it('should handle prompt input changes', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const textarea = screen.getByLabelText(/What would you like the AI to do/);
      await user.type(textarea, 'Make this more concise');
      
      expect(textarea).toHaveValue('Make this more concise');
    });

    it('should submit prompt on form submission', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const textarea = screen.getByLabelText(/What would you like the AI to do/);
      const submitButton = screen.getByRole('button', { name: 'Generate' });
      
      await user.type(textarea, 'Improve this text');
      await user.click(submitButton);
      
      expect(defaultProps.onPromptSubmit).toHaveBeenCalledWith('Improve this text');
    });

    it('should submit prompt on Ctrl+Enter', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const textarea = screen.getByLabelText(/What would you like the AI to do/);
      
      await user.type(textarea, 'Fix grammar');
      await user.keyboard('{Control>}{Enter}{/Control}');
      
      expect(defaultProps.onPromptSubmit).toHaveBeenCalledWith('Fix grammar');
    });

    it('should cancel on Escape key', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const textarea = screen.getByLabelText(/What would you like the AI to do/);
      
      await user.type(textarea, 'Some text');
      await user.keyboard('{Escape}');
      
      expect(defaultProps.onCancel).toHaveBeenCalled();
    });

    it('should disable submit button when prompt is empty', () => {
      render(<AIPromptInterface {...defaultProps} />);
      
      const submitButton = screen.getByRole('button', { name: 'Generate' });
      expect(submitButton).toBeDisabled();
    });

    it('should disable form when processing', () => {
      render(<AIPromptInterface {...defaultProps} isProcessing={true} />);
      
      const textarea = screen.getByLabelText(/What would you like the AI to do/);
      const submitButton = screen.getByRole('button', { name: /Processing/ });
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      
      expect(textarea).toBeDisabled();
      expect(submitButton).toBeDisabled();
      expect(cancelButton).toBeDisabled();
    });

    it('should show processing state', () => {
      render(<AIPromptInterface {...defaultProps} isProcessing={true} />);
      
      expect(screen.getByText('Processing...')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Processing/ })).toBeInTheDocument();
    });
  });

  describe('AI Result Preview', () => {
    it('should show preview when AI result is available', () => {
      render(
        <AIPromptInterface 
          {...defaultProps} 
          aiResult="This is improved text"
        />
      );
      
      expect(screen.getByText('AI Suggestion')).toBeInTheDocument();
      expect(screen.getByText('Original:')).toBeInTheDocument();
      expect(screen.getByText('AI Suggestion:')).toBeInTheDocument();
      expect(screen.getByText('This is improved text')).toBeInTheDocument();
    });

    it('should show diff view with original and modified text', () => {
      render(
        <AIPromptInterface 
          {...defaultProps} 
          aiResult="This is improved text"
        />
      );
      
      // Check that both original and modified text are shown
      const originalElements = screen.getAllByText('This is selected text');
      const modifiedElements = screen.getAllByText('This is improved text');
      
      expect(originalElements.length).toBeGreaterThan(0);
      expect(modifiedElements.length).toBeGreaterThan(0);
    });

    it('should show unchanged diff when text is the same', () => {
      render(
        <AIPromptInterface 
          {...defaultProps} 
          aiResult="This is selected text"
        />
      );
      
      // Should show the text in the diff view when unchanged
      expect(screen.getByText('AI Suggestion')).toBeInTheDocument();
      const textElements = screen.getAllByText('This is selected text');
      expect(textElements.length).toBeGreaterThan(1); // Should appear in both selected text and diff
    });

    it('should handle accept changes', async () => {
      const user = userEvent.setup();
      render(
        <AIPromptInterface 
          {...defaultProps} 
          aiResult="This is improved text"
        />
      );
      
      const acceptButton = screen.getByRole('button', { name: 'Accept Changes' });
      await user.click(acceptButton);
      
      expect(defaultProps.onAcceptChanges).toHaveBeenCalled();
    });

    it('should handle reject changes', async () => {
      const user = userEvent.setup();
      render(
        <AIPromptInterface 
          {...defaultProps} 
          aiResult="This is improved text"
        />
      );
      
      const rejectButton = screen.getByRole('button', { name: 'Reject' });
      await user.click(rejectButton);
      
      expect(defaultProps.onRejectChanges).toHaveBeenCalled();
    });

    it('should allow editing prompt from preview', async () => {
      const user = userEvent.setup();
      render(
        <AIPromptInterface 
          {...defaultProps} 
          aiResult="This is improved text"
        />
      );
      
      const editButton = screen.getByRole('button', { name: 'Edit Prompt' });
      await user.click(editButton);
      
      // Should go back to prompt input form
      expect(screen.getByLabelText(/What would you like the AI to do/)).toBeInTheDocument();
    });
  });

  describe('Error Handling', () => {
    it('should show error state', () => {
      render(
        <AIPromptInterface 
          {...defaultProps} 
          error="AI service is unavailable"
        />
      );
      
      expect(screen.getByText('Error')).toBeInTheDocument();
      expect(screen.getByText('AI service is unavailable')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Try Again' })).toBeInTheDocument();
    });

    it('should handle try again from error state', async () => {
      const user = userEvent.setup();
      render(
        <AIPromptInterface 
          {...defaultProps} 
          error="AI service is unavailable"
        />
      );
      
      const tryAgainButton = screen.getByRole('button', { name: 'Try Again' });
      await user.click(tryAgainButton);
      
      // Should go back to prompt input form
      expect(screen.getByLabelText(/What would you like the AI to do/)).toBeInTheDocument();
    });

    it('should handle cancel from error state', async () => {
      const user = userEvent.setup();
      render(
        <AIPromptInterface 
          {...defaultProps} 
          error="AI service is unavailable"
        />
      );
      
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);
      
      expect(defaultProps.onCancel).toHaveBeenCalled();
    });
  });

  describe('Modal Interactions', () => {
    it('should handle close button click', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const closeButton = screen.getByRole('button', { name: 'Close AI prompt' });
      await user.click(closeButton);
      
      expect(defaultProps.onCancel).toHaveBeenCalled();
    });

    it('should handle overlay click', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const overlay = document.querySelector('.ai-prompt-overlay');
      expect(overlay).toBeInTheDocument();
      
      if (overlay) {
        await user.click(overlay);
        expect(defaultProps.onCancel).toHaveBeenCalled();
      }
    });

    it('should handle cancel button click', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      const cancelButton = screen.getByRole('button', { name: 'Cancel' });
      await user.click(cancelButton);
      
      expect(defaultProps.onCancel).toHaveBeenCalled();
    });
  });

  describe('Focus Management', () => {
    it('should focus prompt input when interface becomes visible', async () => {
      const { rerender } = render(
        <AIPromptInterface {...defaultProps} isVisible={false} />
      );
      
      rerender(<AIPromptInterface {...defaultProps} isVisible={true} />);
      
      await waitFor(() => {
        const textarea = screen.getByLabelText(/What would you like the AI to do/);
        expect(textarea).toHaveFocus();
      });
    });
  });

  describe('State Management', () => {
    it('should reset state when interface is hidden', () => {
      const { rerender } = render(<AIPromptInterface {...defaultProps} />);
      
      // Interface is visible, then hidden
      rerender(<AIPromptInterface {...defaultProps} isVisible={false} />);
      
      // Then visible again - should be reset
      rerender(<AIPromptInterface {...defaultProps} isVisible={true} />);
      
      const textarea = screen.getByLabelText(/What would you like the AI to do/);
      expect(textarea).toHaveValue('');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA labels', () => {
      render(<AIPromptInterface {...defaultProps} />);
      
      expect(screen.getByRole('button', { name: 'Close AI prompt' })).toBeInTheDocument();
      expect(screen.getByLabelText(/What would you like the AI to do/)).toBeInTheDocument();
    });

    it('should support keyboard navigation', async () => {
      const user = userEvent.setup();
      render(<AIPromptInterface {...defaultProps} />);
      
      // The textarea should be focused initially due to the useEffect
      await waitFor(() => {
        expect(screen.getByLabelText(/What would you like the AI to do/)).toHaveFocus();
      });
      
      // Tab to next element
      await user.tab();
      expect(screen.getByRole('button', { name: 'Cancel' })).toHaveFocus();
    });
  });
});