/**
 * Operational Transformation (OT) module exports
 */

export {
  OTOperation,
  InsertOperation,
  DeleteOperation,
  RetainOperation
} from './operations';

export {
  transform,
  transformSequence,
  OperationSequence,
  canApplyConcurrently
} from './transform';

export {
  compose,
  composeSequence,
  apply,
  applySequence,
  invert,
  invertSequence,
  isNoOp,
  removeNoOps
} from './composition';