---
name: zero-gateway
description: Call the local Zero backend's HTTP API (https://localhost/zero/api) to read and write its data and drive its server-side capabilities — agents, sessions, chat history, memory store, filesystem, usage/cost, alerts, workflow runs, git — plus a bundled helpers.sh of ready-made shell functions. Use when asked to hit a Zero endpoint, query or modify anything living in Zero's SQLite DB, inspect its agents/models/usage, reach a path only the container can see, or add a new endpoint to Zero's backend.
---

# Zero backend API

Zero is the user's personal agent harness (`git@github.com:ettore90/Zero.git`): an Express
backend over SQLite that owns his agents, sessions, memory store, usage ledger and provider
credentials. **This skill is about calling that HTTP API directly** — using Zero as a data and
capability layer for your own work, not as a place to send prompts. (Prompt routing exists and
is expensive; it is the last section, deliberately.)

## Connecting

| | |
|---|---|
| Base URL | `https://localhost/zero/api` (nginx → container `zero:3010`; self-signed cert, so `curl -k`) |
| Auth | header `x-username: ettore` |
| Fallback | `http://$(docker inspect zero --format '{{range .NetworkSettings.Networks}}{{.IPAddress}}{{end}}'):3010/api` — container IP changes across restarts, prefer the nginx URL |

Plain `http://localhost/zero/...` 301-redirects to https.

```bash
curl -sk https://localhost/zero/api/health          # {"ok":true}
docker ps --format '{{.Names}}\t{{.Status}}' | grep zero
```

## Use the helpers

`helpers.sh` (next to this file) wraps every route below as a shell function. Source it once
per Bash call — functions do not persist between tool calls.

```bash
source .claude/skills/zero-gateway/helpers.sh   # or ~/.claude/skills/zero-gateway/helpers.sh
zero_models          # id  name  [provider]  modelId
zero_agents          # id  name  master=bool
zero_usage | jq .totals
zero_mem_search "prompt versioning" 5
zero_read /app/routes/chat.routes.js 1 40
```

Two generic escape hatches for anything unwrapped:

```bash
zero_get  /usage/daily?year=2026\&month=9
zero_post /memory/delete '{"id":123}'
```

`zero_post` always sends a body — several routes destructure `req.body` without a default and
**crash on a bodyless POST** (`/workflow-runs/cancel`, `/agent/stop`, `/alerts/read`,
`/migrate`). Pass `'{}'` when you have nothing to send.

Env overrides: `ZERO_BASE`, `ZERO_USER`.

## Security posture — read once, then stop worrying

The backend has **no authentication**, and its network shape is asymmetric: **inbound is
internal-only** (bound to this machine, not publicly reachable), while **outbound egress is
unrestricted** — the container can reach anything on the internet.

- `x-username: <anything>` authenticates as that user and **auto-creates** them. `POST /auth/login` mints a token for any username, no password.
- `checkLocalAccess`, despite the name, checks **no IP** — it is a global on/off flag (`ALLOW_LOCAL_ACCESS`, default on). `ADMIN_IPS` is dead config, referenced nowhere.
- **`GET /state/:username` returns provider API keys in plaintext** (`apiKeys[].value`, `modelConfigs[].apiKey`) with no ownership check. Never dump that response raw into a transcript, log, or paste — extract only the fields you need. `zero_models` already does.
- `POST /proxy` is an **open SSRF relay**: arbitrary `targetUrl`, no allowlist, no auth. Combined with unrestricted egress this reaches any external host — and any host on the container's Docker networks.
- `/system/exec`, `/system/python`, `/system/fs/*` are arbitrary shell and arbitrary-path file I/O with no sandboxing.

The inbound restriction is the only thing making this acceptable. It stops being acceptable the
moment any of it is bound publicly or proxied out.

## The API surface

All paths below are relative to `/api`, and `x-username`-scoped wherever scoping exists at all.

### Agents & models

`GET|POST /agents` · `PUT|DELETE /agents/:id` · `GET /state/:username` (whole user blob:
`modelConfigs`, `apiKeys`, settings — **contains plaintext keys**).

Naming convention: `cortex.*` are master agents, `neuron.*` workers, `glia.*` workflow-bound
operators. There is also a large prompt-composition system:
`/agents/:id/prompt-document|-versions|-blocks|-refs|-assignments|-publish|-rollback`, plus
global `/settings/prompt-*`.

Two destructive shapes to avoid firing by accident:
- `POST /agents {agents:[...], replaceAll:true}` **deletes every agent absent from the payload.**
- `POST /settings/prompt-publish` rewrites `systemPrompt` on **every** typed agent.

### Memory store

`GET /memory/list` (all rows, no embeddings) · `POST /memory/search` `{query, embedding, limit, threshold, category, tags}` · `POST /memory/add` `{content*, tags, category, importance, agentId, embedding}` · `POST /memory/update` `{id*, ...}` · `POST /memory/delete` `{id*}`.

- The HTTP layer **never generates embeddings.** Omit `embedding` and search degrades to naive substring keyword matching — expect to miss paraphrases.
- Rows are **global**: nothing filters by user.
- `add` dedupes on a content fingerprint and returns the existing id **without updating it** — a re-add with changed text is a silent no-op. Use `/memory/update`.
- `search` mutates rows (bumps `accessCount`), and returns the full `embedding` vector per hit; `zero_mem_search` strips it.

### Filesystem

`POST /system/fs/read` `{path*, start_line, end_line}` · `fs/write` `{path*, content}` (full overwrite, creates parent dirs) · `fs/list` `{path}` · `fs/find` `{pattern, path, maxDepth, type, exclude}` (caps at 200 hits) · `fs/patch` `{path*, oldStr*, newStr, replaceAll}`.

Paths are the **container's** view: the host's `/home/ettore` is `/host_system`, and `/app` is
the Zero checkout. No path confinement. For host paths prefer your own local Bash tools — reach
for these only when the target is something only the container can see.

### Sessions & history

`GET /sessions?agentId` · `GET /sessions/:id` (includes messages) · `POST /sessions` `{id*, agentId*, title}` · `DELETE /sessions/:id`. Plus a session-notes API (`/sessions/:id/notes*`) with optimistic concurrency — `PATCH` returns **409 `version_conflict`** on a stale `expectedVersion`.

### Usage & cost

`GET /usage` (`totals` + `byAgent` + `byModel` + `daily` + `recent`) · `GET /usage/summary` (all-time per model) · `GET /usage/agent/:agentId` · `GET /usage/daily?year&month` · `GET /usage/sessions` · `POST /usage/record`.

`cost` is whatever a caller stored — nothing derives it from a rate card, and `daily`/`summary`
omit it entirely. Treat token counts as real, cost as advisory.

### Control & observability

`POST /agent/stop` `{agentId, sessionId}` (omit both to abort **all** of the user's runs) · `GET|POST /admin/circuit-breaker/status|reset` · `GET /stream?username=` (per-user SSE firehose of every agent event) · `GET /alerts?username=` · `POST /alerts/read` (omitting `ids` marks **all** read) · `GET|POST /workflow-runs`, `/workflow-runs/start|cancel`.

### Integrations

`GET /jira/queue`, `POST /jira/action` (no `checkLocalAccess` at all; token via `x-jira-token`
or the stored `JIRA_KEY`) · `POST /transcribe` (raw `audio/*` body, 10 MB cap) ·
`POST /llm/complete` and `/ollama/*` (raw local-Ollama passthroughs, no DB keys) ·
`POST /proxy` (the SSRF relay — see security posture; it injects **no** credentials, the caller
supplies its own `Authorization`, so it is not a key-hiding gateway).

## Known broken

- **`/system/exec`, `/system/python` and every `/git/*` route** throw `BASH_BIN is not defined`. `BASH_BIN` is a module-local `const` in `services/llmService.js:54` but referenced as a global at `routes/system.routes.js:118` and `routes/git.routes.js:17`. exec returns HTTP 200 with `{"error":"BASH_BIN is not defined","exitCode":1}`; git returns HTTP 500. `fs/*` is unaffected. Use local Bash, or fix the import.
- `GET /git/diff` interpolates its `files` query param into a shell string unescaped — command injection. Every other git route uses `escapeShellArg`. Fix before relying on it.
- Bodyless POSTs crash on `/workflow-runs/cancel`, `/agent/stop`, `/alerts/read`, `/migrate` — always send at least `{}`.
- `/nebula/*` is a 501 stub, and a path bug puts it at `/nebula/nebula/*`. `routes/static.routes.js` is dead code, never mounted. `POST /admin/digest` is a hard-coded stub.

## Adding an endpoint

Zero is **the** place to add a capability this skill lacks — never stand up a separate service.

1. Thin router in `routes/<topic>.routes.js`; real logic in `services/`.
2. Register it in `app.js` (mounted under both `/api` and `${BASE_PATH}/api`).
3. Anything reaching SQLite must not be statically imported before `initDb()` — see the ESM-hoisting comment in `server.js`.
4. **Rebuild the container.** `zero` runs the built image, so a code change on disk is not live until rebuild/restart.
5. Wrap the new route in `helpers.sh` and document it here, in the same change.

**Scope boundary:** Zero is personal and lives only on this machine. Anything intended for the
user's Stefanini team belongs in the **SAMS plugin**, not here — confirm before building shared
tooling into Zero.

## Routing a prompt through Zero (rarely what you want)

`POST /chat` is the only route that reaches a DB-stored provider key, but it is not a completion
endpoint: it requires an `agentId`, is SSE-only, and runs the **full agent loop with every
server-side tool enabled**.

```bash
zero_ask <agentId> <model> "<prompt>"
```

- **~3.4k prompt tokens of overhead per call** — every request ships the agent's system prompt plus the whole tool schema set. Measured: a bare "reply pong" cost 3420 prompt tokens.
- **Tools execute server-side, unrestricted.** `runAgentLoop` enables all `SYSTEM_TOOLS` (`run_terminal_command`, `write_file`, `git_commit`, `delegate_task`) unless that agent has a persisted `allowedTools` allowlist. There is **no per-request way to disable tools**, and only `request_plan_approval` is approval-gated. Treat a `/chat` call as "let a model act on this machine", not "ask a question".
- **Model resolution** (`resolveModelConfig`): `model` overrides the agent default, matched case-insensitively against `modelId` **or** `id` **or** `name`, first hit wins. A `name:tag` string with no match synthesizes an Ollama config. **Any other unmatched string silently falls back to the agent's model** — verify `done.model` is what you asked for.
- Body: `agentId` (required) · `messages` (legacy form, no session written) **or** `newMessage` + `sessionId` (persists) · `model` (optional).
- SSE events: `llm_request` · `chunk` · `assistant_message` · `llm_response` · `tool_call` · `tool_result` · `terminal_signal` · `session_updated` · `done` · `error`. `done` → `{content, toolSummary, model, usage:{...}}`. Failures after the headers flush arrive as an SSE `error` at **HTTP 200**, not an error status.

If you need plain inference, use your own model — not this route.
