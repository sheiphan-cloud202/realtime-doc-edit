/**
 * Unit tests for OT operations
 */

import { InsertOperation, DeleteOperation, RetainOperation } from '../operations';

describe('InsertOperation', () => {
  test('should create insert operation with correct properties', () => {
    const op = new InsertOperation('hello');
    expect(op.type).toBe('insert');
    expect(op.content).toBe('hello');
    expect(op.length).toBe(5);
  });
  
  test('should apply insert operation correctly', () => {
    const op = new InsertOperation('world');
    const result = op.apply('hello ', 6);
    expect(result.result).toBe('hello world');
    expect(result.newPosition).toBe(11);
  });
  
  test('should apply insert at beginning of document', () => {
    const op = new InsertOperation('Hello ');
    const result = op.apply('world', 0);
    expect(result.result).toBe('Hello world');
    expect(result.newPosition).toBe(6);
  });
  
  test('should create correct inverse operation', () => {
    const op = new InsertOperation('test');
    const inverse = op.invert('', 0);
    expect(inverse.type).toBe('delete');
    expect(inverse.length).toBe(4);
  });
  
  test('should have correct string representation', () => {
    const op = new InsertOperation('hello');
    expect(op.toString()).toBe('Insert("hello")');
  });
});

describe('DeleteOperation', () => {
  test('should create delete operation with correct properties', () => {
    const op = new DeleteOperation(5);
    expect(op.type).toBe('delete');
    expect(op.length).toBe(5);
  });
  
  test('should apply delete operation correctly', () => {
    const op = new DeleteOperation(5);
    const result = op.apply('hello world', 0);
    expect(result.result).toBe(' world');
    expect(result.newPosition).toBe(0);
  });
  
  test('should apply delete in middle of document', () => {
    const op = new DeleteOperation(1);
    const result = op.apply('hello world', 5);
    expect(result.result).toBe('helloworld');
    expect(result.newPosition).toBe(5);
  });
  
  test('should create correct inverse operation', () => {
    const op = new DeleteOperation(4);
    const inverse = op.invert('test document', 0);
    expect(inverse.type).toBe('insert');
    expect((inverse as InsertOperation).content).toBe('test');
  });
  
  test('should have correct string representation', () => {
    const op = new DeleteOperation(3);
    expect(op.toString()).toBe('Delete(3)');
  });
});

describe('RetainOperation', () => {
  test('should create retain operation with correct properties', () => {
    const op = new RetainOperation(10);
    expect(op.type).toBe('retain');
    expect(op.length).toBe(10);
  });
  
  test('should apply retain operation correctly', () => {
    const op = new RetainOperation(5);
    const result = op.apply('hello world', 0);
    expect(result.result).toBe('hello world');
    expect(result.newPosition).toBe(5);
  });
  
  test('should create correct inverse operation', () => {
    const op = new RetainOperation(7);
    const inverse = op.invert('test document', 0);
    expect(inverse.type).toBe('retain');
    expect(inverse.length).toBe(7);
  });
  
  test('should have correct string representation', () => {
    const op = new RetainOperation(8);
    expect(op.toString()).toBe('Retain(8)');
  });
});

describe('Operation interactions', () => {
  test('should handle empty content insert', () => {
    const op = new InsertOperation('');
    expect(op.length).toBe(0);
    const result = op.apply('hello', 2);
    expect(result.result).toBe('hello');
    expect(result.newPosition).toBe(2);
  });
  
  test('should handle zero-length delete', () => {
    const op = new DeleteOperation(0);
    expect(op.length).toBe(0);
    const result = op.apply('hello', 2);
    expect(result.result).toBe('hello');
    expect(result.newPosition).toBe(2);
  });
  
  test('should handle zero-length retain', () => {
    const op = new RetainOperation(0);
    expect(op.length).toBe(0);
    const result = op.apply('hello', 2);
    expect(result.result).toBe('hello');
    expect(result.newPosition).toBe(2);
  });
});