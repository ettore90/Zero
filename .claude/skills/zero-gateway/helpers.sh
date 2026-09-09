#!/usr/bin/env bash
# Zero backend API helpers.  Usage:  source .claude/skills/zero-gateway/helpers.sh
# Every function prints JSON on stdout; pipe through jq to shape it.
# Requires: curl, jq.  Backend must be reachable (zero_health).

ZERO_BASE="${ZERO_BASE:-https://localhost/zero/api}"
ZERO_USER="${ZERO_USER:-ettore}"

# ---- transport -------------------------------------------------------------

# zero_get <path> [extra curl args...]        e.g. zero_get /usage
zero_get() {
  local path="$1"; shift
  curl -sk -m 60 "$ZERO_BASE$path" -H "x-username: $ZERO_USER" "$@"
}

# zero_post <path> <json-body> [extra curl args...]
# Always send a body — several routes crash on a bodyless POST. Use '{}' if empty.
zero_post() {
  local path="$1" body="${2:-\{\}}"; shift 2 2>/dev/null || shift
  curl -sk -m 120 -X POST "$ZERO_BASE$path" \
    -H 'Content-Type: application/json' -H "x-username: $ZERO_USER" \
    -d "$body" "$@"
}

zero_health() { zero_get /health; }

# ---- discovery -------------------------------------------------------------

# Models: id / name / provider / modelId.  Never prints apiKey.
zero_models() {
  zero_get "/state/$ZERO_USER" \
    | jq -r '.modelConfigs[]? | "\(.id)\t\(.name)\t[\(.provider)]\t\(.modelId)"'
}

# Agents: id / name / master flag.
zero_agents() {
  zero_get /agents | jq -r '.agents[]? | "\(.id)\t\(.name)\tmaster=\(.isMaster)"'
}

# ---- memory ----------------------------------------------------------------
# The HTTP layer never generates embeddings: omitting `embedding` degrades
# search to substring keyword matching. Rows are global, not per-user.

# zero_mem_search <query> [limit]
# Strips the `embedding` vector from each hit — it is thousands of floats and
# will blow up your context. Drop the `| jq` to see it.
zero_mem_search() {
  zero_post /memory/search "$(jq -n --arg q "$1" --argjson l "${2:-10}" \
    '{query:$q, limit:$l}')" | jq '.results |= map(del(.embedding))'
}

# zero_mem_add <content> [tags-csv] [category]
zero_mem_add() {
  zero_post /memory/add "$(jq -n --arg c "$1" --arg t "${2:-}" --arg cat "${3:-}" \
    '{content:$c} + (if $t=="" then {} else {tags:($t|split(","))} end)
              + (if $cat=="" then {} else {category:$cat} end)')"
}

zero_mem_list() { zero_get /memory/list; }

# ---- filesystem (container view) -------------------------------------------
# Host /home/ettore == container /host_system.  /app == the Zero checkout.
# No path confinement. Prefer local Bash for host paths; use these to reach
# paths only the container can see.

# zero_read <path> [start_line] [end_line]
zero_read() {
  zero_post /system/fs/read "$(jq -n --arg p "$1" --arg s "${2:-}" --arg e "${3:-}" \
    '{path:$p} + (if $s=="" then {} else {start_line:($s|tonumber)} end)
              + (if $e=="" then {} else {end_line:($e|tonumber)} end)')"
}

# zero_write <path> <content>   — full overwrite, creates parent dirs
zero_write() {
  zero_post /system/fs/write "$(jq -n --arg p "$1" --arg c "$2" '{path:$p, content:$c}')"
}

# zero_ls <path>
zero_ls() { zero_post /system/fs/list "$(jq -n --arg p "$1" '{path:$p}')"; }

# zero_find <pattern> [path]    — caps at 200 hits
zero_find() {
  zero_post /system/fs/find "$(jq -n --arg pat "$1" --arg p "${2:-}" \
    '{pattern:$pat} + (if $p=="" then {} else {path:$p} end)')"
}

# zero_patch <path> <oldStr> <newStr>
zero_patch() {
  zero_post /system/fs/patch "$(jq -n --arg p "$1" --arg o "$2" --arg n "$3" \
    '{path:$p, oldStr:$o, newStr:$n}')"
}

# ---- shell / python (container, root, unsandboxed) -------------------------
# cwd is REQUIRED in practice: the server default is an unmounted path and the
# call fails with `spawn /bin/bash ENOENT`. Mounted: /app, /app/storage, /uby.

# zero_exec <command> [cwd]
zero_exec() {
  zero_post /system/exec "$(jq -n --arg c "$1" --arg d "${2:-/app}" '{command:$c, cwd:$d}')"
}

# zero_py <code> [cwd]
zero_py() {
  zero_post /system/python "$(jq -n --arg c "$1" --arg d "${2:-/app}" '{code:$c, cwd:$d}')"
}

# zero_git <path-under-/app-or-/uby> — repo status via the git routes
zero_git_status() { zero_get "/git/status?cwd=${1:-/app}"; }

# ---- usage / sessions / control --------------------------------------------

zero_usage()   { zero_get /usage; }
zero_summary() { zero_get /usage/summary; }

# zero_sessions [agentId]
zero_sessions() {
  if [ -n "${1:-}" ]; then zero_get "/sessions?agentId=$1"; else zero_get /sessions; fi
}
zero_session() { zero_get "/sessions/$1"; }   # includes messages

# zero_stop [agentId] [sessionId]  — no args aborts all of this user's runs
zero_stop() {
  zero_post /agent/stop "$(jq -n --arg a "${1:-}" --arg s "${2:-}" \
    '(if $a=="" then {} else {agentId:$a} end) + (if $s=="" then {} else {sessionId:$s} end)')"
}

zero_alerts() { zero_get "/alerts?username=$ZERO_USER"; }
zero_breaker() { zero_get /admin/circuit-breaker/status; }

# ---- inference (heavy — see SKILL.md before using) -------------------------
# Runs the full agent loop with all server-side tools enabled. ~3.4k prompt
# tokens of overhead per call. Not a plain "ask a model" endpoint.

# zero_ask <agentId> <model> <prompt>
zero_ask() {
  curl -skN -m 300 -X POST "$ZERO_BASE/chat" \
    -H 'Content-Type: application/json' -H "x-username: $ZERO_USER" \
    -d "$(jq -n --arg a "$1" --arg m "$2" --arg p "$3" \
        '{agentId:$a, model:$m, messages:[{role:"user",content:$p}]}')" \
  | grep -A1 '^event: done' | tail -1 | sed 's/^data: //' | jq -r '.content'
}
