/**
 * Shared TypeScript interfaces for the realtime AI document editor
 */

export interface Document {
  id: string;
  content: string;
  version: number;
  operations: Operation[];
  collaborators: Collaborator[];
  createdAt: Date;
  updatedAt: Date;
}

export interface Operation {
  type: 'insert' | 'delete' | 'retain';
  position: number;
  content?: string;
  length?: number;
  userId: string;
  timestamp: Date;
  version: number;
}

export interface AIRequest {
  id: string;
  documentId: string;
  userId: string;
  selectedText: string;
  prompt: string;
  selectionStart: number;
  selectionEnd: number;
  status: 'pending' | 'processing' | 'completed' | 'failed';
  result?: string;
  createdAt: Date;
}

export interface Collaborator {
  id: string;
  name: string;
  avatar?: string;
  cursor: number;
  selection?: {
    start: number;
    end: number;
  };
  isActive: boolean;
  lastSeen: Date;
}

// Additional utility types for WebSocket communication
export interface WebSocketMessage {
  type: string;
  payload: any;
  timestamp: Date;
}

export interface DocumentState {
  document: Document;
  collaborators: Collaborator[];
}

export interface OperationMessage extends WebSocketMessage {
  type: 'operation';
  payload: {
    operation: Operation;
    documentId: string;
  };
}

export interface PresenceMessage extends WebSocketMessage {
  type: 'presence';
  payload: {
    collaborator: Collaborator;
    documentId: string;
  };
}

export interface UserJoinedMessage extends WebSocketMessage {
  type: 'user_joined';
  payload: {
    collaborator: Collaborator;
    documentId: string;
  };
}

export interface UserLeftMessage extends WebSocketMessage {
  type: 'user_left';
  payload: {
    userId: string;
    documentId: string;
  };
}

export interface CursorPosition {
  line: number;
  column: number;
  offset: number;
}

export interface UserPresence {
  userId: string;
  userName: string;
  avatar?: string;
  cursor: CursorPosition;
  selection?: {
    start: CursorPosition;
    end: CursorPosition;
  };
  color: string;
  isActive: boolean;
  lastSeen: Date;
}

export interface AIRequestMessage extends WebSocketMessage {
  type: 'ai_request';
  payload: AIRequest;
}

export interface AIResponseMessage extends WebSocketMessage {
  type: 'ai_response';
  payload: {
    requestId: string;
    result: string;
    status: 'completed' | 'failed';
    error?: string;
  };
}

export interface NotificationMessage extends WebSocketMessage {
  type: 'notification';
  payload: {
    type: 'user_joined' | 'user_left' | 'user_disconnected' | 'info' | 'warning' | 'error';
    message: string;
    userId?: string;
  };
}

export interface CollaboratorsUpdatedMessage extends WebSocketMessage {
  type: 'collaborators_updated';
  payload: {
    collaborators: Collaborator[];
  };
}

// History management types
export interface HistoryEntry {
  id: string;
  operation: Operation;
  inverseOperation: Operation;
  documentStateBefore: string;
  documentStateAfter: string;
  timestamp: Date;
  isAIOperation: boolean;
  aiRequestId?: string;
  description: string;
}

export interface HistoryState {
  entries: HistoryEntry[];
  currentIndex: number; // -1 means no operations, 0 means after first operation, etc.
  maxSize: number;
}

export interface UndoRedoMessage extends WebSocketMessage {
  type: 'undo' | 'redo';
  payload: {
    historyEntryId: string;
    operation: Operation;
    documentId: string;
  };
}