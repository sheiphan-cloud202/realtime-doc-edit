/**
 * Unit tests for operation composition and inversion
 */

import { InsertOperation, DeleteOperation, RetainOperation } from '../operations';
import { OperationSequence } from '../transform';
import {
  compose,
  composeSequence,
  apply,
  applySequence,
  invert,
  invertSequence,
  isNoOp,
  removeNoOps
} from '../composition';

describe('compose function', () => {
  test('should compose two insert operations', () => {
    const op1 = new InsertOperation('hello');
    const op2 = new InsertOperation(' world');
    
    const composed = compose(op1, op2);
    
    expect(composed).toBeInstanceOf(InsertOperation);
    expect((composed as InsertOperation).content).toBe('hello world');
  });
  
  test('should compose insert and delete of same length', () => {
    const op1 = new InsertOperation('test');
    const op2 = new DeleteOperation(4);
    
    const composed = compose(op1, op2);
    
    expect(composed).toBeInstanceOf(RetainOperation);
    expect(composed?.length).toBe(0);
  });
  
  test('should compose insert and partial delete', () => {
    const op1 = new InsertOperation('hello');
    const op2 = new DeleteOperation(2);
    
    const composed = compose(op1, op2);
    
    expect(composed).toBeInstanceOf(InsertOperation);
    expect((composed as InsertOperation).content).toBe('llo');
  });
  
  test('should not compose insert and larger delete', () => {
    const op1 = new InsertOperation('hi');
    const op2 = new DeleteOperation(5);
    
    const composed = compose(op1, op2);
    
    expect(composed).toBeNull();
  });
  
  test('should not compose delete and insert', () => {
    const op1 = new DeleteOperation(3);
    const op2 = new InsertOperation('test');
    
    const composed = compose(op1, op2);
    
    expect(composed).toBeNull();
  });
  
  test('should compose two delete operations', () => {
    const op1 = new DeleteOperation(3);
    const op2 = new DeleteOperation(2);
    
    const composed = compose(op1, op2);
    
    expect(composed).toBeInstanceOf(DeleteOperation);
    expect(composed?.length).toBe(5);
  });
  
  test('should compose retain with other operations', () => {
    const retain = new RetainOperation(5);
    const insert = new InsertOperation('test');
    
    const composed1 = compose(retain, insert);
    const composed2 = compose(insert, retain);
    
    expect(composed1).toBe(insert);
    expect(composed2).toBe(insert);
  });
});

describe('composeSequence function', () => {
  test('should handle empty sequence', () => {
    const sequence = new OperationSequence([]);
    const composed = composeSequence(sequence);
    expect(composed.operations).toHaveLength(0);
  });
  
  test('should handle single operation sequence', () => {
    const op = new InsertOperation('test');
    const sequence = new OperationSequence([op]);
    const composed = composeSequence(sequence);
    expect(composed.operations).toHaveLength(1);
    expect(composed.operations[0]).toBe(op);
  });
  
  test('should compose compatible operations', () => {
    const ops = [
      new InsertOperation('hello'),
      new InsertOperation(' world')
    ];
    const sequence = new OperationSequence(ops);
    const composed = composeSequence(sequence);
    
    expect(composed.operations).toHaveLength(1);
    expect(composed.operations[0]).toBeInstanceOf(InsertOperation);
    expect((composed.operations[0] as InsertOperation).content).toBe('hello world');
  });
  
  test('should keep incompatible operations separate', () => {
    const ops = [
      new InsertOperation('hello'),
      new DeleteOperation(10),
      new InsertOperation('world')
    ];
    const sequence = new OperationSequence(ops);
    const composed = composeSequence(sequence);
    
    expect(composed.operations).toHaveLength(3);
  });
});

describe('apply function', () => {
  test('should apply insert operation', () => {
    const doc = 'hello world';
    const op = new InsertOperation(' beautiful');
    const result = apply(doc, op, 5);
    expect(result).toBe('hello beautiful world');
  });
  
  test('should apply delete operation', () => {
    const doc = 'hello world';
    const op = new DeleteOperation(6);
    const result = apply(doc, op, 5);
    expect(result).toBe('hello');
  });
  
  test('should apply retain operation', () => {
    const doc = 'hello world';
    const op = new RetainOperation(5);
    const result = apply(doc, op, 0);
    expect(result).toBe('hello world');
  });
});

describe('applySequence function', () => {
  test('should apply empty sequence', () => {
    const doc = 'hello world';
    const sequence = new OperationSequence([]);
    const result = applySequence(doc, sequence);
    expect(result).toBe('hello world');
  });
  
  test('should apply single operation sequence', () => {
    const doc = 'hello world';
    const sequence = new OperationSequence([new InsertOperation('beautiful ')]);
    const result = applySequence(doc, sequence);
    expect(result).toBe('beautiful hello world');
  });
  
  test('should apply multiple operations in sequence', () => {
    const doc = 'hello world';
    const ops = [
      new RetainOperation(6), // Skip "hello "
      new InsertOperation('beautiful '), // Insert "beautiful "
      new RetainOperation(5) // Keep "world"
    ];
    const sequence = new OperationSequence(ops);
    const result = applySequence(doc, sequence);
    expect(result).toBe('hello beautiful world');
  });
  
  test('should handle complex sequence', () => {
    const doc = 'The quick brown fox';
    const ops = [
      new RetainOperation(4), // Keep "The "
      new DeleteOperation(6), // Delete "quick "
      new InsertOperation('slow '), // Insert "slow "
      new RetainOperation(9) // Keep "brown fox"
    ];
    const sequence = new OperationSequence(ops);
    const result = applySequence(doc, sequence);
    expect(result).toBe('The slow brown fox');
  });
});

describe('invert function', () => {
  test('should invert insert operation', () => {
    const doc = 'hello world';
    const op = new InsertOperation('beautiful ');
    const inverse = invert(op, doc, 6);
    
    expect(inverse).toBeInstanceOf(DeleteOperation);
    expect(inverse.length).toBe(10); // Length of "beautiful "
  });
  
  test('should invert delete operation', () => {
    const doc = 'hello beautiful world';
    const op = new DeleteOperation(10); // Delete "beautiful "
    const inverse = invert(op, doc, 6);
    
    expect(inverse).toBeInstanceOf(InsertOperation);
    expect((inverse as InsertOperation).content).toBe('beautiful ');
  });
  
  test('should invert retain operation', () => {
    const doc = 'hello world';
    const op = new RetainOperation(5);
    const inverse = invert(op, doc, 0);
    
    expect(inverse).toBeInstanceOf(RetainOperation);
    expect(inverse.length).toBe(5);
  });
});

describe('invertSequence function', () => {
  test('should invert empty sequence', () => {
    const doc = 'hello world';
    const sequence = new OperationSequence([]);
    const inverse = invertSequence(sequence, doc);
    expect(inverse.operations).toHaveLength(0);
  });
  
  test('should invert single operation sequence', () => {
    const doc = 'hello world';
    const sequence = new OperationSequence([new InsertOperation('beautiful ')]);
    const inverse = invertSequence(sequence, doc);
    
    expect(inverse.operations).toHaveLength(1);
    expect(inverse.operations[0]).toBeInstanceOf(DeleteOperation);
    expect(inverse.operations[0].length).toBe(10);
  });
  
  test('should invert complex sequence in reverse order', () => {
    const doc = 'hello world';
    const ops = [
      new InsertOperation('The '), // Insert at beginning
      new RetainOperation(11), // Skip "hello world"
      new InsertOperation('!') // Insert at end
    ];
    const sequence = new OperationSequence(ops);
    const inverse = invertSequence(sequence, doc);
    
    expect(inverse.operations).toHaveLength(3);
    // Should be in reverse order
    expect(inverse.operations[0]).toBeInstanceOf(DeleteOperation); // Remove "!"
    expect(inverse.operations[1]).toBeInstanceOf(RetainOperation); // Skip content
    expect(inverse.operations[2]).toBeInstanceOf(DeleteOperation); // Remove "The "
  });
  
  test('should create correct inverse that undoes original', () => {
    const originalDoc = 'hello world';
    
    // Simple test: just insert at the beginning
    const ops = [new InsertOperation('The ')];
    const sequence = new OperationSequence(ops);
    
    // Apply original sequence
    const modifiedDoc = applySequence(originalDoc, sequence);
    expect(modifiedDoc).toBe('The hello world');
    
    // Create and apply inverse
    const inverse = invertSequence(sequence, originalDoc);
    expect(inverse.operations).toHaveLength(1);
    expect(inverse.operations[0]).toBeInstanceOf(DeleteOperation);
    expect(inverse.operations[0].length).toBe(4);
    
    const restoredDoc = applySequence(modifiedDoc, inverse);
    expect(restoredDoc).toBe(originalDoc);
  });
});

describe('utility functions', () => {
  test('isNoOp should identify no-op operations', () => {
    expect(isNoOp(new InsertOperation(''))).toBe(true);
    expect(isNoOp(new InsertOperation('hello'))).toBe(false);
    expect(isNoOp(new DeleteOperation(0))).toBe(true);
    expect(isNoOp(new DeleteOperation(5))).toBe(false);
    expect(isNoOp(new RetainOperation(0))).toBe(true);
    expect(isNoOp(new RetainOperation(3))).toBe(false);
  });
  
  test('removeNoOps should filter out no-op operations', () => {
    const ops = [
      new InsertOperation('hello'),
      new DeleteOperation(0), // no-op
      new RetainOperation(5),
      new InsertOperation(''), // no-op
      new DeleteOperation(3)
    ];
    const sequence = new OperationSequence(ops);
    const filtered = removeNoOps(sequence);
    
    expect(filtered.operations).toHaveLength(3);
    expect(filtered.operations[0]).toBeInstanceOf(InsertOperation);
    expect(filtered.operations[1]).toBeInstanceOf(RetainOperation);
    expect(filtered.operations[2]).toBeInstanceOf(DeleteOperation);
  });
});

describe('integration tests', () => {
  test('should handle round-trip apply and invert', () => {
    const originalDoc = 'The quick brown fox jumps over the lazy dog';
    const operation = new InsertOperation('very ');
    
    // Apply operation
    const modifiedDoc = apply(originalDoc, operation, 10); // Insert after "The quick "
    expect(modifiedDoc).toBe('The quick very brown fox jumps over the lazy dog');
    
    // Create and apply inverse
    const inverse = invert(operation, originalDoc, 10);
    const restoredDoc = apply(modifiedDoc, inverse, 10);
    expect(restoredDoc).toBe(originalDoc);
  });
  
  test('should compose and apply operations correctly', () => {
    const doc = 'hello';
    const op1 = new InsertOperation(' beautiful');
    const op2 = new InsertOperation(' world');
    
    // Apply separately
    const result1 = apply(apply(doc, op1, 5), op2, 15);
    
    // Compose and apply
    const composed = compose(op1, op2);
    const result2 = apply(doc, composed!, 5);
    
    expect(result1).toBe(result2);
    expect(result1).toBe('hello beautiful world');
  });
});