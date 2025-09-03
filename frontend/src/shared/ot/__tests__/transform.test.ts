/**
 * Unit tests for operational transformation
 */

import { InsertOperation, DeleteOperation, RetainOperation } from '../operations';
import { transform, transformSequence, OperationSequence, canApplyConcurrently } from '../transform';

describe('transform function', () => {
  test('should transform insert vs insert operations', () => {
    const op1 = new InsertOperation('hello');
    const op2 = new InsertOperation('world');
    
    const [transformed1, transformed2] = transform(op1, op2, true);
    
    expect(transformed1.type).toBe('insert');
    expect(transformed2.type).toBe('insert');
    expect((transformed1 as InsertOperation).content).toBe('hello');
    expect((transformed2 as InsertOperation).content).toBe('world');
  });
  
  test('should transform insert vs delete operations', () => {
    const op1 = new InsertOperation('hello');
    const op2 = new DeleteOperation(5);
    
    const [transformed1, transformed2] = transform(op1, op2, true);
    
    expect(transformed1.type).toBe('insert');
    expect(transformed2.type).toBe('delete');
    expect((transformed1 as InsertOperation).content).toBe('hello');
    expect(transformed2.length).toBe(5);
  });
  
  test('should transform delete vs insert operations', () => {
    const op1 = new DeleteOperation(3);
    const op2 = new InsertOperation('test');
    
    const [transformed1, transformed2] = transform(op1, op2, true);
    
    expect(transformed1.type).toBe('delete');
    expect(transformed2.type).toBe('insert');
    expect(transformed1.length).toBe(3);
    expect((transformed2 as InsertOperation).content).toBe('test');
  });
  
  test('should transform delete vs delete operations', () => {
    const op1 = new DeleteOperation(5);
    const op2 = new DeleteOperation(3);
    
    const [transformed1, transformed2] = transform(op1, op2, true);
    
    expect(transformed1.type).toBe('delete');
    expect(transformed2.type).toBe('delete');
    expect(transformed1.length).toBe(3); // min(5, 3)
    expect(transformed2.length).toBe(0); // max(0, 3-3)
  });
  
  test('should transform delete vs delete with different lengths', () => {
    const op1 = new DeleteOperation(2);
    const op2 = new DeleteOperation(5);
    
    const [transformed1, transformed2] = transform(op1, op2, true);
    
    expect(transformed1.type).toBe('delete');
    expect(transformed2.type).toBe('delete');
    expect(transformed1.length).toBe(2); // min(2, 5)
    expect(transformed2.length).toBe(3); // max(0, 5-2)
  });
  
  test('should transform retain operations', () => {
    const op1 = new RetainOperation(5);
    const op2 = new InsertOperation('hello');
    
    const [transformed1, transformed2] = transform(op1, op2, true);
    
    expect(transformed1.type).toBe('retain');
    expect(transformed2.type).toBe('insert');
    expect(transformed1.length).toBe(5);
    expect((transformed2 as InsertOperation).content).toBe('hello');
  });
});

describe('OperationSequence', () => {
  test('should create empty sequence', () => {
    const seq = new OperationSequence();
    expect(seq.operations).toHaveLength(0);
    expect(seq.isEmpty).toBe(true);
    expect(seq.length).toBe(0);
  });
  
  test('should create sequence with operations', () => {
    const ops = [new InsertOperation('hello'), new DeleteOperation(3)];
    const seq = new OperationSequence(ops);
    expect(seq.operations).toHaveLength(2);
    expect(seq.isEmpty).toBe(false);
    expect(seq.length).toBe(8); // 5 + 3
  });
  
  test('should add operation to sequence', () => {
    const seq = new OperationSequence();
    const newSeq = seq.add(new InsertOperation('test'));
    expect(newSeq.operations).toHaveLength(1);
    expect(newSeq.length).toBe(4);
    // Original sequence should be unchanged
    expect(seq.operations).toHaveLength(0);
  });
  
  test('should have correct string representation', () => {
    const ops = [new InsertOperation('hi'), new DeleteOperation(2)];
    const seq = new OperationSequence(ops);
    expect(seq.toString()).toBe('[Insert("hi"), Delete(2)]');
  });
});

describe('transformSequence function', () => {
  test('should transform empty sequences', () => {
    const seq1 = new OperationSequence();
    const seq2 = new OperationSequence();
    
    const [transformed1, transformed2] = transformSequence(seq1, seq2, true);
    
    expect(transformed1.isEmpty).toBe(true);
    expect(transformed2.isEmpty).toBe(true);
  });
  
  test('should transform sequence against empty sequence', () => {
    const seq1 = new OperationSequence([new InsertOperation('hello')]);
    const seq2 = new OperationSequence();
    
    const [transformed1, transformed2] = transformSequence(seq1, seq2, true);
    
    expect(transformed1.operations).toHaveLength(1);
    expect(transformed2.isEmpty).toBe(true);
  });
  
  test('should transform single operation sequences', () => {
    const seq1 = new OperationSequence([new InsertOperation('hello')]);
    const seq2 = new OperationSequence([new DeleteOperation(3)]);
    
    const [transformed1, transformed2] = transformSequence(seq1, seq2, true);
    
    expect(transformed1.operations).toHaveLength(1);
    expect(transformed2.operations).toHaveLength(1);
    expect(transformed1.operations[0].type).toBe('insert');
    expect(transformed2.operations[0].type).toBe('delete');
  });
  
  test('should transform multi-operation sequences', () => {
    const seq1 = new OperationSequence([
      new InsertOperation('hello'),
      new DeleteOperation(2)
    ]);
    const seq2 = new OperationSequence([
      new RetainOperation(3),
      new InsertOperation('world')
    ]);
    
    const [transformed1, transformed2] = transformSequence(seq1, seq2, true);
    
    expect(transformed1.operations).toHaveLength(2);
    expect(transformed2.operations).toHaveLength(2);
  });
});

describe('canApplyConcurrently function', () => {
  test('should allow concurrent insert operations', () => {
    const op1 = new InsertOperation('hello');
    const op2 = new InsertOperation('world');
    expect(canApplyConcurrently(op1, op2)).toBe(true);
  });
  
  test('should allow insert with delete', () => {
    const op1 = new InsertOperation('hello');
    const op2 = new DeleteOperation(3);
    expect(canApplyConcurrently(op1, op2)).toBe(true);
  });
  
  test('should allow retain with any operation', () => {
    const retain = new RetainOperation(5);
    const insert = new InsertOperation('test');
    const delete_ = new DeleteOperation(2);
    
    expect(canApplyConcurrently(retain, insert)).toBe(true);
    expect(canApplyConcurrently(insert, retain)).toBe(true);
    expect(canApplyConcurrently(retain, delete_)).toBe(true);
    expect(canApplyConcurrently(delete_, retain)).toBe(true);
  });
  
  test('should not allow concurrent delete operations', () => {
    const op1 = new DeleteOperation(3);
    const op2 = new DeleteOperation(5);
    expect(canApplyConcurrently(op1, op2)).toBe(false);
  });
});

describe('Integration tests', () => {
  test('should handle complex transformation scenario', () => {
    // User A inserts "Hello " at position 0
    // User B deletes 3 characters at position 0
    // Both operations happen concurrently on empty document
    
    const opA = new InsertOperation('Hello ');
    const opB = new DeleteOperation(3);
    
    const [transformedA, transformedB] = transform(opA, opB, true);
    
    // After transformation:
    // - Insert should still insert "Hello "
    // - Delete should still try to delete 3 characters
    expect((transformedA as InsertOperation).content).toBe('Hello ');
    expect(transformedB.length).toBe(3);
  });
  
  test('should maintain operation properties after transformation', () => {
    const op1 = new InsertOperation('test content');
    const op2 = new RetainOperation(10);
    
    const [transformed1, transformed2] = transform(op1, op2, false);
    
    expect(transformed1.length).toBe(op1.length);
    expect(transformed2.length).toBe(op2.length);
    expect((transformed1 as InsertOperation).content).toBe(op1.content);
  });
});