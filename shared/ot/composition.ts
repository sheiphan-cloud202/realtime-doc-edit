/**
 * Operation Composition and Document Application
 * 
 * This module implements composition of operations and application to documents
 */

import { OTOperation, InsertOperation, DeleteOperation, RetainOperation } from './operations';
import { OperationSequence } from './transform';

/**
 * Compose two operations into a single operation
 * This is used to combine multiple operations for efficiency
 * 
 * @param op1 First operation
 * @param op2 Second operation  
 * @returns Composed operation or null if composition is not possible
 */
export function compose(op1: OTOperation, op2: OTOperation): OTOperation | null {
  // Insert followed by Insert at the same position
  if (op1 instanceof InsertOperation && op2 instanceof InsertOperation) {
    return new InsertOperation(op1.content + op2.content);
  }
  
  // Insert followed by Delete - they cancel out if delete length matches insert length
  if (op1 instanceof InsertOperation && op2 instanceof DeleteOperation) {
    if (op1.length === op2.length) {
      // They cancel each other out - return a zero-length retain
      return new RetainOperation(0);
    } else if (op1.length > op2.length) {
      // Partial deletion of inserted content
      return new InsertOperation(op1.content.slice(op2.length));
    } else {
      // Delete more than was inserted - not a simple composition
      return null;
    }
  }
  
  // Delete followed by Insert - replace operation
  if (op1 instanceof DeleteOperation && op2 instanceof InsertOperation) {
    // This represents a replace operation: delete then insert
    // We can't easily compose this into a single operation
    return null;
  }
  
  // Delete followed by Delete
  if (op1 instanceof DeleteOperation && op2 instanceof DeleteOperation) {
    return new DeleteOperation(op1.length + op2.length);
  }
  
  // Retain followed by any operation - the second operation takes precedence
  if (op1 instanceof RetainOperation) {
    return op2;
  }
  
  // Any operation followed by Retain - the first operation takes precedence  
  if (op2 instanceof RetainOperation) {
    return op1;
  }
  
  return null;
}

/**
 * Compose a sequence of operations into a single optimized sequence
 * 
 * @param sequence The operation sequence to compose
 * @returns Optimized operation sequence
 */
export function composeSequence(sequence: OperationSequence): OperationSequence {
  if (sequence.operations.length <= 1) {
    return sequence;
  }
  
  const optimized: OTOperation[] = [];
  let current = sequence.operations[0];
  
  for (let i = 1; i < sequence.operations.length; i++) {
    const next = sequence.operations[i];
    const composed = compose(current, next);
    
    if (composed !== null && composed.length > 0) {
      // Successfully composed
      current = composed;
    } else {
      // Cannot compose, add current to result and move to next
      optimized.push(current);
      current = next;
    }
  }
  
  // Add the final operation
  optimized.push(current);
  
  return new OperationSequence(optimized);
}

/**
 * Apply an operation to a document string
 * 
 * @param document The document string
 * @param operation The operation to apply
 * @param position The position to apply the operation at (default: 0)
 * @returns The modified document string
 */
export function apply(document: string, operation: OTOperation, position: number = 0): string {
  const result = operation.apply(document, position);
  return result.result;
}

/**
 * Apply a sequence of operations to a document
 * 
 * @param document The document string
 * @param sequence The sequence of operations to apply
 * @returns The modified document string
 */
export function applySequence(document: string, sequence: OperationSequence): string {
  let result = document;
  let position = 0;
  
  for (const operation of sequence.operations) {
    const applied = operation.apply(result, position);
    result = applied.result;
    position = applied.newPosition;
  }
  
  return result;
}

/**
 * Create the inverse of an operation for undo functionality
 * 
 * @param operation The operation to invert
 * @param document The document state before the operation was applied
 * @param position The position where the operation was applied
 * @returns The inverse operation
 */
export function invert(operation: OTOperation, document: string, position: number = 0): OTOperation {
  return operation.invert(document, position);
}

/**
 * Create the inverse of an operation sequence
 * 
 * @param sequence The operation sequence to invert
 * @param document The document state before the sequence was applied
 * @returns The inverse operation sequence (in reverse order)
 */
export function invertSequence(sequence: OperationSequence, document: string): OperationSequence {
  if (sequence.operations.length === 0) {
    return new OperationSequence([]);
  }
  
  // For a proper inverse, we need to:
  // 1. Apply all operations to get intermediate states
  // 2. Create inverses in reverse order
  // 3. Each inverse should undo the effect of its corresponding operation
  
  const states: string[] = [document];
  const positions: number[] = [0];
  
  // Apply operations forward to collect all intermediate states
  let currentDoc = document;
  let currentPos = 0;
  
  for (const operation of sequence.operations) {
    const result = operation.apply(currentDoc, currentPos);
    currentDoc = result.result;
    currentPos = result.newPosition;
    states.push(currentDoc);
    positions.push(currentPos);
  }
  
  // Create inverse operations in reverse order
  const inverseOps: OTOperation[] = [];
  
  for (let i = sequence.operations.length - 1; i >= 0; i--) {
    const operation = sequence.operations[i];
    const beforeState = states[i];
    const beforePos = positions[i];
    
    // Create the inverse operation
    const inverse = operation.invert(beforeState, beforePos);
    inverseOps.push(inverse);
  }
  
  return new OperationSequence(inverseOps);
}

/**
 * Check if an operation is a no-op (does nothing)
 */
export function isNoOp(operation: OTOperation): boolean {
  if (operation instanceof InsertOperation) {
    return operation.content.length === 0;
  }
  if (operation instanceof DeleteOperation) {
    return operation.length === 0;
  }
  if (operation instanceof RetainOperation) {
    return operation.length === 0;
  }
  return false;
}

/**
 * Remove no-op operations from a sequence
 */
export function removeNoOps(sequence: OperationSequence): OperationSequence {
  const filtered = sequence.operations.filter(op => !isNoOp(op));
  return new OperationSequence(filtered);
}