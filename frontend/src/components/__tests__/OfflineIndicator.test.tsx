import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import '@testing-library/jest-dom';
import { OfflineIndicator } from '../OfflineIndicator';

describe('OfflineIndicator', () => {
  describe('Visibility', () => {
    it('should not render when online and no queued operations', () => {
      const { container } = render(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={0}
        />
      );

      expect(container.firstChild).toBeNull();
    });

    it('should render when offline', () => {
      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={0}
        />
      );

      expect(screen.getByText("You're offline")).toBeInTheDocument();
    });

    it('should render when online but has queued operations', () => {
      render(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={3}
        />
      );

      expect(screen.getByText('Syncing 3 changes...')).toBeInTheDocument();
    });
  });

  describe('Offline State', () => {
    it('should display offline status correctly', () => {
      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={0}
        />
      );

      expect(screen.getByText("You're offline")).toBeInTheDocument();
      expect(screen.getByText('⚠️')).toBeInTheDocument();
    });

    it('should display queued operations count when offline', () => {
      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={5}
        />
      );

      expect(screen.getByText("You're offline")).toBeInTheDocument();
      expect(screen.getByText('5 changes queued')).toBeInTheDocument();
    });

    it('should handle singular vs plural correctly for queued operations', () => {
      const { rerender } = render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={1}
        />
      );

      expect(screen.getByText('1 change queued')).toBeInTheDocument();

      rerender(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={2}
        />
      );

      expect(screen.getByText('2 changes queued')).toBeInTheDocument();
    });

    it('should show retry button when offline', () => {
      const onRetrySync = jest.fn();

      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={3}
          onRetrySync={onRetrySync}
        />
      );

      const retryButton = screen.getByText('Retry');
      expect(retryButton).toBeInTheDocument();
      expect(retryButton).toHaveAttribute('title', 'Retry synchronization');
    });

    it('should call onRetrySync when retry button is clicked', () => {
      const onRetrySync = jest.fn();

      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={3}
          onRetrySync={onRetrySync}
        />
      );

      const retryButton = screen.getByText('Retry');
      fireEvent.click(retryButton);

      expect(onRetrySync).toHaveBeenCalledTimes(1);
    });

    it('should not show retry button when no onRetrySync callback provided', () => {
      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={3}
        />
      );

      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    });
  });

  describe('Syncing State', () => {
    it('should display syncing status correctly', () => {
      render(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={3}
        />
      );

      expect(screen.getByText('Syncing 3 changes...')).toBeInTheDocument();
      expect(screen.getByText('🔄')).toBeInTheDocument();
    });

    it('should handle singular vs plural correctly for syncing operations', () => {
      const { rerender } = render(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={1}
        />
      );

      expect(screen.getByText('Syncing 1 change...')).toBeInTheDocument();

      rerender(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={4}
        />
      );

      expect(screen.getByText('Syncing 4 changes...')).toBeInTheDocument();
    });

    it('should not show retry button when syncing', () => {
      const onRetrySync = jest.fn();

      render(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={3}
          onRetrySync={onRetrySync}
        />
      );

      expect(screen.queryByText('Retry')).not.toBeInTheDocument();
    });
  });

  describe('CSS Classes', () => {
    it('should apply offline class when offline', () => {
      const { container } = render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={0}
        />
      );

      const indicator = container.querySelector('.offline-indicator');
      expect(indicator).toHaveClass('offline');
    });

    it('should apply syncing class when syncing', () => {
      const { container } = render(
        <OfflineIndicator
          isOffline={false}
          queuedOperationsCount={3}
        />
      );

      const indicator = container.querySelector('.offline-indicator');
      expect(indicator).toHaveClass('syncing');
    });
  });

  describe('Edge Cases', () => {
    it('should handle zero queued operations correctly', () => {
      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={0}
        />
      );

      expect(screen.getByText("You're offline")).toBeInTheDocument();
      expect(screen.queryByText('queued')).not.toBeInTheDocument();
    });

    it('should handle large numbers of queued operations', () => {
      render(
        <OfflineIndicator
          isOffline={true}
          queuedOperationsCount={999}
        />
      );

      expect(screen.getByText('999 changes queued')).toBeInTheDocument();
    });
  });
});