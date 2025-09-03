/**
 * Operation History Manager
 * 
 * Manages undo/redo functionality for document operations including AI operations.
 * Maintains a history stack with operation inverses for proper undo/redo support.
 */

import { Operation, HistoryEntry, HistoryState } from '../shared/types';
import { OTOperation, InsertOperation, DeleteOperation, RetainOperation } from '../shared/ot/operations';
import { invert } from '../shared/ot/composition';

export interface OperationHistoryManagerCallbacks {
  onHistoryChanged: (canUndo: boolean, canRedo: boolean, historySize: number) => void;
  onOperationUndone: (operation: Operation, historyEntry: HistoryEntry) => void;
  onOperationRedone: (operation: Operation, historyEntry: HistoryEntry) => void;
  onHistoryCleared: () => void;
}

export class OperationHistoryManager {
  private history: HistoryState;
  private callbacks: OperationHistoryManagerCallbacks;
  private documentId: string;
  private userId: string;

  constructor(
    documentId: string,
    userId: string,
    callbacks: OperationHistoryManagerCallbacks,
    maxHistorySize: number = 100
  ) {
    this.documentId = documentId;
    this.userId = userId;
    this.callbacks = callbacks;
    this.history = {
      entries: [],
      currentIndex: -1,
      maxSize: maxHistorySize
    };
  }

  /**
   * Add an operation to the history stack
   */
  public addOperation(
    operation: Operation,
    documentStateBefore: string,
    documentStateAfter: string,
    isAIOperation: boolean = false,
    aiRequestId?: string,
    description?: string
  ): void {
    // Only track operations from the current user
    if (operation.userId !== this.userId) {
      return;
    }

    try {
      // Create inverse operation for undo
      const otOperation = this.convertToOTOperation(operation);
      const inverseOTOperation = invert(otOperation, documentStateBefore, operation.position);
      const inverseOperation = this.convertFromOTOperation(inverseOTOperation, operation);

      // Create history entry
      const historyEntry: HistoryEntry = {
        id: this.generateHistoryId(),
        operation,
        inverseOperation,
        documentStateBefore,
        documentStateAfter,
        timestamp: new Date(),
        isAIOperation,
        aiRequestId,
        description: description || this.generateOperationDescription(operation, isAIOperation)
      };

      // Remove any entries after current index (when adding after undo)
      if (this.history.currentIndex < this.history.entries.length - 1) {
        this.history.entries = this.history.entries.slice(0, this.history.currentIndex + 1);
      }

      // Add new entry
      this.history.entries.push(historyEntry);
      this.history.currentIndex = this.history.entries.length - 1;

      // Maintain max size
      if (this.history.entries.length > this.history.maxSize) {
        this.history.entries.shift();
        this.history.currentIndex--;
      }

      this.notifyHistoryChanged();
    } catch (error) {
      console.error('Failed to add operation to history:', error);
    }
  }

  /**
   * Undo the last operation
   */
  public undo(): HistoryEntry | null {
    if (!this.canUndo()) {
      return null;
    }

    const historyEntry = this.history.entries[this.history.currentIndex];
    this.history.currentIndex--;

    this.callbacks.onOperationUndone(historyEntry.inverseOperation, historyEntry);
    this.notifyHistoryChanged();

    return historyEntry;
  }

  /**
   * Redo the next operation
   */
  public redo(): HistoryEntry | null {
    if (!this.canRedo()) {
      return null;
    }

    this.history.currentIndex++;
    const historyEntry = this.history.entries[this.history.currentIndex];

    this.callbacks.onOperationRedone(historyEntry.operation, historyEntry);
    this.notifyHistoryChanged();

    return historyEntry;
  }

  /**
   * Check if undo is possible
   */
  public canUndo(): boolean {
    return this.history.currentIndex >= 0;
  }

  /**
   * Check if redo is possible
   */
  public canRedo(): boolean {
    return this.history.currentIndex < this.history.entries.length - 1;
  }

  /**
   * Get the current history state
   */
  public getHistoryState(): HistoryState {
    return { ...this.history };
  }

  /**
   * Get history entries for display
   */
  public getHistoryEntries(): HistoryEntry[] {
    return [...this.history.entries];
  }

  /**
   * Get AI operations from history
   */
  public getAIOperations(): HistoryEntry[] {
    return this.history.entries.filter(entry => entry.isAIOperation);
  }

  /**
   * Clear all history
   */
  public clearHistory(): void {
    this.history.entries = [];
    this.history.currentIndex = -1;
    this.callbacks.onHistoryCleared();
    this.notifyHistoryChanged();
  }

  /**
   * Jump to a specific point in history
   */
  public jumpToHistoryPoint(targetIndex: number): HistoryEntry[] {
    if (targetIndex < -1 || targetIndex >= this.history.entries.length) {
      throw new Error('Invalid history index');
    }

    const operations: HistoryEntry[] = [];
    const currentIndex = this.history.currentIndex;

    if (targetIndex < currentIndex) {
      // Undo operations
      for (let i = currentIndex; i > targetIndex; i--) {
        const entry = this.undo();
        if (entry) {
          operations.push(entry);
        }
      }
    } else if (targetIndex > currentIndex) {
      // Redo operations
      for (let i = currentIndex; i < targetIndex; i++) {
        const entry = this.redo();
        if (entry) {
          operations.push(entry);
        }
      }
    }

    return operations;
  }

  /**
   * Get operation description for display
   */
  public getOperationDescription(entry: HistoryEntry): string {
    return entry.description;
  }

  /**
   * Mark an AI operation as completed
   */
  public markAIOperationCompleted(aiRequestId: string, finalOperation: Operation): void {
    const entry = this.history.entries.find(e => e.aiRequestId === aiRequestId);
    if (entry) {
      entry.operation = finalOperation;
      entry.description = this.generateOperationDescription(finalOperation, true);
    }
  }

  /**
   * Remove AI operation if it was rejected
   */
  public removeAIOperation(aiRequestId: string): void {
    const index = this.history.entries.findIndex(e => e.aiRequestId === aiRequestId);
    if (index !== -1) {
      this.history.entries.splice(index, 1);
      if (this.history.currentIndex >= index) {
        this.history.currentIndex--;
      }
      this.notifyHistoryChanged();
    }
  }

  /**
   * Get history statistics
   */
  public getHistoryStats(): {
    totalOperations: number;
    aiOperations: number;
    userOperations: number;
    currentPosition: number;
  } {
    const aiOps = this.history.entries.filter(e => e.isAIOperation).length;
    return {
      totalOperations: this.history.entries.length,
      aiOperations: aiOps,
      userOperations: this.history.entries.length - aiOps,
      currentPosition: this.history.currentIndex + 1
    };
  }

  private convertToOTOperation(operation: Operation): OTOperation {
    switch (operation.type) {
      case 'insert':
        return new InsertOperation(operation.content || '');
      case 'delete':
        return new DeleteOperation(operation.length || 0);
      case 'retain':
        return new RetainOperation(operation.length || 0);
      default:
        throw new Error(`Unknown operation type: ${operation.type}`);
    }
  }

  private convertFromOTOperation(otOperation: OTOperation, originalOperation: Operation): Operation {
    const baseOp = {
      userId: originalOperation.userId,
      timestamp: new Date(),
      version: originalOperation.version,
      position: originalOperation.position
    };

    switch (otOperation.type) {
      case 'insert':
        return {
          ...baseOp,
          type: 'insert',
          content: (otOperation as InsertOperation).content
        };
      case 'delete':
        return {
          ...baseOp,
          type: 'delete',
          length: otOperation.length
        };
      case 'retain':
        return {
          ...baseOp,
          type: 'retain',
          length: otOperation.length
        };
      default:
        throw new Error(`Unknown OT operation type: ${otOperation.type}`);
    }
  }

  private generateOperationDescription(operation: Operation, isAIOperation: boolean): string {
    const prefix = isAIOperation ? 'AI: ' : '';
    
    switch (operation.type) {
      case 'insert':
        const insertLength = operation.content?.length || 0;
        return `${prefix}Insert ${insertLength} character${insertLength !== 1 ? 's' : ''}`;
      case 'delete':
        const deleteLength = operation.length || 0;
        return `${prefix}Delete ${deleteLength} character${deleteLength !== 1 ? 's' : ''}`;
      case 'retain':
        return `${prefix}Retain ${operation.length || 0} characters`;
      default:
        return `${prefix}Unknown operation`;
    }
  }

  private generateHistoryId(): string {
    return `history-${this.documentId}-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
  }

  private notifyHistoryChanged(): void {
    this.callbacks.onHistoryChanged(
      this.canUndo(),
      this.canRedo(),
      this.history.entries.length
    );
  }

  /**
   * Export history for debugging or persistence
   */
  public exportHistory(): string {
    return JSON.stringify({
      documentId: this.documentId,
      userId: this.userId,
      history: this.history,
      timestamp: new Date().toISOString()
    }, null, 2);
  }

  /**
   * Import history from exported data
   */
  public importHistory(exportedData: string): void {
    try {
      const data = JSON.parse(exportedData);
      if (data.documentId === this.documentId && data.userId === this.userId) {
        this.history = data.history;
        this.notifyHistoryChanged();
      } else {
        throw new Error('History data does not match current document/user');
      }
    } catch (error) {
      console.error('Failed to import history:', error);
      throw error;
    }
  }
}

export default OperationHistoryManager;