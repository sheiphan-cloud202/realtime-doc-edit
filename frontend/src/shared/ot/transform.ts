/**
 * Operational Transformation Engine
 * 
 * This module implements the core transformation logic for resolving conflicts
 * between concurrent operations in a collaborative editing environment.
 */

import { OTOperation, InsertOperation, DeleteOperation, RetainOperation } from './operations';

/**
 * Represents a sequence of operations that can be applied to a document
 */
export class OperationSequence {
  readonly operations: OTOperation[];
  
  constructor(operations: OTOperation[] = []) {
    this.operations = [...operations];
  }
  
  /**
   * Add an operation to the sequence
   */
  add(operation: OTOperation): OperationSequence {
    return new OperationSequence([...this.operations, operation]);
  }
  
  /**
   * Get the total length of all operations
   */
  get length(): number {
    return this.operations.reduce((sum, op) => sum + op.length, 0);
  }
  
  /**
   * Check if the sequence is empty
   */
  get isEmpty(): boolean {
    return this.operations.length === 0;
  }
  
  toString(): string {
    return `[${this.operations.map(op => op.toString()).join(', ')}]`;
  }
}

/**
 * Transform two operations against each other to resolve conflicts
 * 
 * @param op1 First operation
 * @param op2 Second operation  
 * @param priority1 Whether op1 has priority in case of ties
 * @returns Tuple of transformed operations [op1', op2']
 */
export function transform(
  op1: OTOperation, 
  op2: OTOperation, 
  priority1: boolean = true
): [OTOperation, OTOperation] {
  
  // Insert vs Insert
  if (op1 instanceof InsertOperation && op2 instanceof InsertOperation) {
    // Both insert at position 0, priority determines order
    if (priority1) {
      return [op1, op2]; // op1 goes first, op2 is unchanged
    } else {
      return [op1, op2]; // op2 goes first, op1 is unchanged  
    }
  }
  
  // Insert vs Delete
  if (op1 instanceof InsertOperation && op2 instanceof DeleteOperation) {
    // Insert is not affected by delete at the same position
    return [op1, op2];
  }
  
  // Delete vs Insert  
  if (op1 instanceof DeleteOperation && op2 instanceof InsertOperation) {
    // Delete is not affected by insert at the same position
    return [op1, op2];
  }
  
  // Delete vs Delete
  if (op1 instanceof DeleteOperation && op2 instanceof DeleteOperation) {
    // Both delete at the same position
    // The second delete becomes empty since the content is already deleted
    const minLength = Math.min(op1.length, op2.length);
    const newOp1 = new DeleteOperation(minLength);
    const newOp2 = new DeleteOperation(Math.max(0, op2.length - minLength));
    return [newOp1, newOp2];
  }
  
  // Insert vs Retain
  if (op1 instanceof InsertOperation && op2 instanceof RetainOperation) {
    return [op1, op2];
  }
  
  // Retain vs Insert
  if (op1 instanceof RetainOperation && op2 instanceof InsertOperation) {
    return [op1, op2];
  }
  
  // Delete vs Retain
  if (op1 instanceof DeleteOperation && op2 instanceof RetainOperation) {
    return [op1, op2];
  }
  
  // Retain vs Delete
  if (op1 instanceof RetainOperation && op2 instanceof DeleteOperation) {
    return [op1, op2];
  }
  
  // Retain vs Retain
  if (op1 instanceof RetainOperation && op2 instanceof RetainOperation) {
    return [op1, op2];
  }
  
  // Default case - return operations unchanged
  return [op1, op2];
}

/**
 * Transform an operation sequence against another operation sequence
 * 
 * @param seq1 First operation sequence
 * @param seq2 Second operation sequence
 * @param priority1 Whether seq1 has priority
 * @returns Tuple of transformed sequences [seq1', seq2']
 */
export function transformSequence(
  seq1: OperationSequence,
  seq2: OperationSequence,
  priority1: boolean = true
): [OperationSequence, OperationSequence] {
  
  if (seq1.isEmpty && seq2.isEmpty) {
    return [seq1, seq2];
  }
  
  if (seq1.isEmpty) {
    return [seq1, seq2];
  }
  
  if (seq2.isEmpty) {
    return [seq1, seq2];
  }
  
  // For simplicity, transform the first operation of each sequence
  // In a full implementation, this would handle complex multi-operation scenarios
  const [transformedOp1, transformedOp2] = transform(
    seq1.operations[0], 
    seq2.operations[0], 
    priority1
  );
  
  const remainingSeq1 = new OperationSequence(seq1.operations.slice(1));
  const remainingSeq2 = new OperationSequence(seq2.operations.slice(1));
  
  const [transformedRemaining1, transformedRemaining2] = transformSequence(
    remainingSeq1,
    remainingSeq2,
    priority1
  );
  
  return [
    new OperationSequence([transformedOp1, ...transformedRemaining1.operations]),
    new OperationSequence([transformedOp2, ...transformedRemaining2.operations])
  ];
}

/**
 * Check if two operations can be applied concurrently without conflicts
 */
export function canApplyConcurrently(op1: OTOperation, op2: OTOperation): boolean {
  // Insert operations can always be applied concurrently
  if (op1 instanceof InsertOperation || op2 instanceof InsertOperation) {
    return true;
  }
  
  // Retain operations don't conflict with anything
  if (op1 instanceof RetainOperation || op2 instanceof RetainOperation) {
    return true;
  }
  
  // Delete operations at the same position conflict
  if (op1 instanceof DeleteOperation && op2 instanceof DeleteOperation) {
    return false;
  }
  
  return true;
}