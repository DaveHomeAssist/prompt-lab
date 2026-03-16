# Prompt Lab Copilot Instructions

## Architecture Overview

Prompt Lab is a multi-platform prompt engineering workbench with a shared React frontend deployed across three runtime shells:

- **Chrome Extension (MV3)**: Side panel build using `chrome.runtime.sendMessage` for API calls
- **Desktop App (Tauri 2)**: Native wrapper reusing the shared frontend with localStorage persistence
- **Web App (Vercel)**: Hosted deployment with CORS proxy edge function at `/api/proxy`

The shared React application lives in `prompt-lab-source/prompt-lab-extension/src/` and is imported by all platforms. Platform-specific behavior is abstracted through `src/lib/platform.js`.

## Key Components & Data Flow

- **Providers**: 5 LLM providers (Anthropic, OpenAI, Gemini, OpenRouter, Ollama) abstracted through `src/lib/providers.js` and `src/lib/providerRegistry.js`
- **Prompt Library**: Versioned prompts with collections, tags, and metadata stored in local browser storage via `src/hooks/usePromptLibrary.js`
- **Experiment Store**: A/B testing and eval runs persisted to IndexedDB via `src/experimentStore.js`
- **PII Engine**: Automatic scanning and redaction using `src/lib/piiEngine.js` before API calls
- **Platform Adapters**: Extension uses `chrome.storage.local`, desktop uses localStorage, web uses proxy-aware fetch

## Development Workflows

### Extension Development
```bash
cd prompt-lab-source/prompt-lab-extension
npm install
npm run dev          # Vite dev server at localhost:5173
npm test             # Vitest + React Testing Library (52 tests)
npm run test:e2e     # Playwright smoke tests after build
npm run build        # Build to dist/ for Chrome loading
```

### Desktop Development
```bash
cd prompt-lab-source/prompt-lab-desktop
npm install
cargo tauri dev      # Launch desktop app with hot reload
cargo tauri build    # Cross-platform .app/.exe/.deb/.AppImage builds
```

### Web Development
```bash
cd prompt-lab-source/prompt-lab-web
npm install
npm run dev          # Vite dev server
vercel dev           # Local proxy testing with /api/proxy
npm run build        # Multi-page build (landing + /app/)
```

## Project Conventions

### Platform Detection
Use `src/lib/platform.js` exports:
- `isExtension` - true when running as Chrome extension
- `VITE_WEB_MODE` - true for hosted web deployment
- Platform-specific implementations in `src/lib/desktopApi.js` and `src/lib/proxyFetch.js`

### State Management
- Custom hooks in `src/hooks/` for complex state (library, editor, A/B tests)
- Local storage via `src/lib/storage.js` with keys from `storageKeys`
- Session state via `src/hooks/useSessionState.js` for temporary UI state

### Prompt Schema
Prompts follow `src/lib/promptSchema.js` with:
- Version history (max 25 versions)
- Collections and tags from `src/constants.js`
- Golden responses for benchmarking
- Import aliases: `prompt`→`enhanced`, `description`→`notes`, `category`→`collection`

### Provider Integration
- All provider calls go through `src/lib/platform.js` abstractions
- API keys stored per-platform (extension: chrome.storage, desktop/web: localStorage)
- Ollama requests bypass proxy, connect direct to localhost
- Error handling via `src/errorTaxonomy.js`

### UI Patterns
- Dark/light theme detection via `src/hooks/useUiState.js`
- Command palette with keyboard shortcuts (Cmd/Ctrl+K)
- Toast notifications via `src/Toast.jsx`
- Drag-and-drop for prompt composition and library reordering

## Integration Points

### External Dependencies
- **Tauri 2**: Desktop shell with Rust backend
- **Vercel Edge Functions**: CORS proxy for web deployment
- **Provider APIs**: Direct calls with user-provided API keys
- **Ollama**: Local LLM server integration

### Cross-Component Communication
- Hooks communicate via shared state and callbacks
- Platform adapters provide consistent API across runtimes
- Storage layer abstracts browser vs native persistence
- Provider registry normalizes model parameters and responses

## Testing & Validation

- Unit tests: Vitest with React Testing Library
- E2E tests: Playwright for extension smoke tests
- CI: Separate workflows for extension and desktop builds
- PII validation: Automatic scanning before provider calls
- Schema validation: Runtime checks for prompt and experiment data

## Key Files to Reference

- `src/App.jsx` - Main application surface and tab routing
- `src/lib/platform.js` - Platform abstraction layer
- `src/hooks/usePromptLibrary.js` - Library state management
- `src/lib/providers.js` - Provider API implementations
- `src/lib/promptSchema.js` - Data structure definitions
- `ARCHITECTURE.md` - Detailed platform and runtime architecture
- `ROADMAP.md` - Current priorities and platform strategy</content>
<parameter name="filePath">/Users/daverobertson/Desktop/Code/10-active-projects/prompt-lab-provider-branch/.github/copilot-instructions.md