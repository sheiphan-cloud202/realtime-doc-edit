# Realtime AI Document Editor

A collaborative document editor with real-time synchronization and AI-powered text editing capabilities.

## Project Structure

```
realtime-ai-doc-editor/
├── frontend/                 # React frontend application
│   ├── src/
│   │   ├── components/      # React components
│   │   ├── services/        # API and WebSocket services
│   │   └── hooks/           # Custom React hooks
│   ├── package.json
│   └── tsconfig.json
├── backend/                  # Node.js backend server
│   ├── src/
│   │   ├── services/        # Business logic services
│   │   ├── models/          # Data models
│   │   ├── controllers/     # Request handlers
│   │   └── utils/           # Utility functions
│   ├── package.json
│   └── tsconfig.json
├── shared/                   # Shared TypeScript types
│   ├── types/
│   │   └── index.ts         # Common interfaces and types
│   ├── package.json
│   └── tsconfig.json
└── package.json              # Root workspace configuration
```

## Key Features

- Real-time collaborative editing with operational transformation
- AI-powered text editing for selected content
- WebSocket-based synchronization
- User presence and cursor tracking
- Offline support with operation queuing

## Technology Stack

- **Frontend**: React, Monaco Editor, Socket.IO Client
- **Backend**: Node.js, Express, Socket.IO, Redis
- **Shared**: TypeScript interfaces and types
- **AI Integration**: OpenAI API (configurable)

## Getting Started

1. Install dependencies for all packages:
   ```bash
   npm run install:all
   ```

2. Build shared types:
   ```bash
   npm run build:shared
   ```

3. Start development servers:
   ```bash
   # Terminal 1 - Backend
   npm run dev:backend
   
   # Terminal 2 - Frontend
   npm run dev:frontend
   ```

## Development

- `npm run build` - Build all packages
- `npm run test` - Run all tests
- `npm run dev:frontend` - Start frontend development server
- `npm run dev:backend` - Start backend development server with hot reload

## Architecture

The system uses operational transformation for conflict resolution, WebSocket connections for real-time communication, and a queue-based system for AI processing. See the design document for detailed architecture information.