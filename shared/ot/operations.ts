/**
 * Operational Transformation (OT) Operations
 * 
 * This module implements the core operation types for operational transformation:
 * - Insert: Inserts text at a specific position
 * - Delete: Deletes text from a specific position
 * - Retain: Keeps text unchanged (used for positioning)
 */

export abstract class OTOperation {
  abstract readonly type: 'insert' | 'delete' | 'retain';
  abstract readonly length: number;
  
  /**
   * Apply this operation to a document string
   */
  abstract apply(document: string, position: number): { result: string; newPosition: number };
  
  /**
   * Transform this operation against another operation
   */
  abstract transform(other: OTOperation, priority: boolean): OTOperation;
  
  /**
   * Create the inverse of this operation for undo functionality
   */
  abstract invert(document: string, position: number): OTOperation;
}

export class InsertOperation extends OTOperation {
  readonly type = 'insert' as const;
  readonly content: string;
  readonly length: number;
  
  constructor(content: string) {
    super();
    this.content = content;
    this.length = content.length;
  }
  
  apply(document: string, position: number): { result: string; newPosition: number } {
    const before = document.slice(0, position);
    const after = document.slice(position);
    return {
      result: before + this.content + after,
      newPosition: position + this.length
    };
  }
  
  transform(other: OTOperation, priority: boolean): OTOperation {
    if (other instanceof InsertOperation) {
      // Both operations insert at the same position
      // Priority determines which goes first
      return this;
    } else if (other instanceof DeleteOperation) {
      // Insert is not affected by delete
      return this;
    } else if (other instanceof RetainOperation) {
      // Insert is not affected by retain
      return this;
    }
    return this;
  }
  
  invert(document: string, position: number): OTOperation {
    return new DeleteOperation(this.length);
  }
  
  toString(): string {
    return `Insert("${this.content}")`;
  }
}

export class DeleteOperation extends OTOperation {
  readonly type = 'delete' as const;
  readonly length: number;
  
  constructor(length: number) {
    super();
    this.length = length;
  }
  
  apply(document: string, position: number): { result: string; newPosition: number } {
    const before = document.slice(0, position);
    const after = document.slice(position + this.length);
    return {
      result: before + after,
      newPosition: position
    };
  }
  
  transform(other: OTOperation, priority: boolean): OTOperation {
    if (other instanceof InsertOperation) {
      // Delete is not affected by insert
      return this;
    } else if (other instanceof DeleteOperation) {
      // Both operations delete at the same position
      // The lengths might need adjustment
      return this;
    } else if (other instanceof RetainOperation) {
      // Delete is not affected by retain
      return this;
    }
    return this;
  }
  
  invert(document: string, position: number): OTOperation {
    const deletedContent = document.slice(position, position + this.length);
    return new InsertOperation(deletedContent);
  }
  
  toString(): string {
    return `Delete(${this.length})`;
  }
}

export class RetainOperation extends OTOperation {
  readonly type = 'retain' as const;
  readonly length: number;
  
  constructor(length: number) {
    super();
    this.length = length;
  }
  
  apply(document: string, position: number): { result: string; newPosition: number } {
    // Retain doesn't change the document, just advances position
    return {
      result: document,
      newPosition: position + this.length
    };
  }
  
  transform(other: OTOperation, priority: boolean): OTOperation {
    // Retain operations are not affected by other operations
    return this;
  }
  
  invert(document: string, position: number): OTOperation {
    // Retain operation's inverse is itself
    return new RetainOperation(this.length);
  }
  
  toString(): string {
    return `Retain(${this.length})`;
  }
}