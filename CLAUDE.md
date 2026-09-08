# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this project is

"Zero" is a multi-provider AI agent harness: a React/Vite frontend + Express backend that lets a user run
multiple named "agents," each bound to a configurable LLM (OpenAI, Anthropic, Gemini, Groq, OpenRouter,
Azure OpenAI/Foundry, Ollama, a custom "SAI"/"SAI Vertex" gateway, or any OpenAI-compatible endpoint), with
server-side tool execution (shell/SSH, filesystem, git, memory, sub-agent delegation, workflows). The backend
also acts as a generic LLM gateway/proxy (`routes/proxy.routes.js` → `services/proxyService.js`) that forwards
requests to upstream providers while hiding API keys from the browser.

## Commands

```bash
npm run dev            # Vite dev server (frontend only)
npm run build           # tsc typecheck + vite build → dist/
npm run lint             # tsc --noEmit (no dedicated linter config)
npm run start:server     # node server.js — runs the Express API against ./dist
npm run preview           # vite preview of the built frontend

# Tests / smoke validation
npm run validate:api      # scripts/validate/api-smoke.mjs — canonical backend smoke test
                            # (auth/session, GET /api/state/:user, SSE chat for two models,
                            # run_terminal_command tool via POST /api/chat)
npm run validate            # alias for validate:api
npm run test:e2e             # Playwright browser E2E (playwright.config.ts)
npm run test:e2e:ui           # Playwright UI mode

# Legacy/compat validation (older container-based promotion pipeline; do not treat as primary)
npm run test:dist
npm run test:image-dist
npm run test:logs
npm run test:runtime
npm run test:baseline        # dist + logs + runtime
npm run test:promotion       # separate promotion gate, NOT the smoke entrypoint
```

There is no unit test runner/framework in this repo (no jest/vitest). Correctness is validated via the
`validate:api` smoke script and Playwright E2E specs in `tests/e2e/`. To run a single Playwright test:
`npx playwright test tests/e2e/smoke.spec.ts -g "<test name>"`.

## Runtime shape

- The frontend (`App.tsx`, `components/`, `hooks/`) is a Vite/React SPA built to `dist/` and served by the
  Express server as a static SPA fallback (see `app.js`).
- `server.js` boots storage (`config/bootstrap.js`), initializes SQLite (`db.js`) **before** any module that
  calls `getDb()` is imported (hence the dynamic `await import('./app.js')`), then creates the HTTP server.
- `app.js` wires every `routes/*.routes.js` router under both `/api` and (if `BASE_PATH` env is set) a
  base-path-prefixed `/api`. Ollama and "nebula" (auth/session backend) routes are mounted separately under
  `/ollama` and `/nebula`.
- `config/env.js` centralizes all env vars; it throws if used from a non-server (browser) context for
  server-only vars, and `BASE_PATH` is required at server startup.

## Backend request flow (chat/agent loop)

1. `routes/chat.routes.js` (`POST /api/chat`) resolves the requesting user's agent + model config via
   `services/llmService.js::resolveModelConfig`, then streams an SSE response by calling
   `runAgentLoop(...)`.
2. `runAgentLoop` (in `services/llmService.js`) drives the actual provider call and the tool-use loop. It
   dispatches tool calls to `toolDispatcher.js::dispatchTool`, which executes tools server-side (no browser
   dependency) — shell/SSH commands, filesystem ops, git, memory (`services/sqliteMemoryTools.js`), session
   notes, prompt/version management (`services/promptStore.js`), plan tracking (`services/planState.js`), and
   sub-agent delegation (`delegate_task`, spawning isolated/ephemeral sub-agent runs with their own iteration
   caps — see `ISOLATED_SUBAGENT_MAX_ITERATIONS` in `toolDispatcher.js`).
3. Tool schemas/allow-lists live in `toolDefinitions.js`; per-session tool access is gated by
   `services/toolAccessPolicy.js`.
4. Workflows (multi-node/graph agent pipelines) are executed by `workflowExecutor.js` (legacy/imperative,
   used by `toolDispatcher.js` and scheduled runs) and `services/workflowEngine.ts` /
   `services/orchestratorService.ts` (newer orchestration layer used by the frontend).
5. Provider-specific request building/streaming (OpenAI-compatible, Azure OpenAI/Foundry, Ollama, SAI, SAI
   Vertex, Gemini via the OpenAI-compat endpoint, etc.) is implemented in `services/llmProvider.ts`
   (browser-side caller, uses `callProvider`) — this is the reference for exactly how each provider's
   payload/headers/streaming differ. Provider base URLs used server-side are in `PROVIDER_URLS` in
   `services/llmService.js`.
6. `routes/proxy.routes.js` + `services/proxyService.js` is the generic outbound LLM proxy: it forwards an
   arbitrary `{ targetUrl, headers, body, method }` to an upstream provider and streams the response back,
   used when a provider config isn't called directly server-side (keeps API keys server-only).

## Sessions, state, and persistence

- SQLite (`db.js`, `better-sqlite3`) is the primary datastore, initialized once at startup and accessed via
  `getDb()`. Do not import modules that call `getDb()` at module scope in a static import — see the
  server.js comment on ESM import hoisting.
- `services/runtime.js` holds shared in-process singletons (session store, pending approvals, approval
  decision/delivery queues, running-agent abort controllers, circuit breaker).
- `services/sessionStore.js` / `sessionStore.js` (root, legacy) manage chat session persistence.
- `services/agentStore.js` manages agent CRUD (definitions, per-agent model bindings).
- `services/circuitBreaker.js` provides a global circuit breaker for upstream provider failures, exposed via
  `routes/admin.routes.js`.
- `legacy/*.txt` are extracted reference notes from a previous monolithic `server.js`, split by concern
  (system, git, memory, nebula auth proxy, agents CRUD, config, generic LLM proxy, circuit-breaker admin,
  ollama proxy, static/SPA). Useful as a map of pre-refactor endpoint groupings.

## Path/environment translation

`utils/pathTransforms.js` (`containerToHost` / `hostToContainer`) translates filesystem paths between the
container's view and the host's view (`HOST_HOME` / `CONTAINER_HOME` env vars) — relevant any time a tool
result or shell command needs to reference a path the user will actually open on their machine.

## Conventions to know

- Mixed JS/TS: backend route/service files are largely plain `.js` (ESM, `"type": "module"`); newer services
  and all frontend code are `.ts`/`.tsx`. `tsconfig.json` + `npm run lint` (`tsc --noEmit`) type-check the
  `.ts(x)` portion only.
- `routes/*.routes.js` are thin Express routers; real logic lives in `services/*`. Prefer extending a service
  and keeping routers thin when adding backend functionality.
- SSE is the standard streaming transport for chat/agent responses (`event: <type>\ndata: <json>\n\n`); see
  `routes/chat.routes.js` and `routes/stream.routes.js` for the pattern.
- Multi-model "fallback" chains: `ModelConfig.isFallback` + `executeChatRequest`'s waterfall logic in
  `services/llmProvider.ts` — when a primary model call fails (non-abort), it retries against the first
  other model flagged `isFallback`.
