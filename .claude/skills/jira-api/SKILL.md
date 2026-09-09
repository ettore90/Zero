---
name: jira-api
description: Call the Jira Cloud REST API through Zero's credential-injecting passthrough at https://localhost/zero/api/jira/rest/... — no token needed, Zero attaches the stored one. Use when you need Jira data or writes beyond what the Atlassian MCP exposes, when the MCP is throttling, or for bulk reads: JQL search, issue and field detail, comments, transitions, worklogs, attachments, changelogs, users, boards and sprints. Covers the site stefaninisophiedelivery.atlassian.net.
---

# Jira REST API via Zero

Zero holds the Jira credential and forwards requests with it attached, so nothing
here handles a token. Reach for this over the Atlassian MCP when the MCP lacks the
endpoint (it exposes a fraction of the REST surface) or when it starts throttling —
the API's limits are far more generous.

## Calling it

Write the **real Jira REST path** after `/jira/rest/`. Method, query string, body
and the upstream status code all pass through unchanged.

```bash
jira() {  # jira <path> [curl args...]   e.g. jira api/3/myself
  local path="$1"; shift
  curl -sk -m 60 "https://localhost/zero/api/jira/rest/$path" -H 'x-username: ettore' "$@"
}

jira api/3/myself | jq -r '.displayName'
jira 'api/3/project/search?maxResults=50' | jq -r '.values[] | "\(.key)  \(.name)"'
```

Writes take `-X` and a JSON body:

```bash
jira api/3/issue/AAS1-2/comment -X POST -H 'Content-Type: application/json' \
  -d '{"body":{"type":"doc","version":1,"content":[
        {"type":"paragraph","content":[{"type":"text","text":"texto"}]}]}}'
```

`x-username: ettore` is what selects whose stored credential is used. The
credential authenticates as **ettore.mletchol@stefanini.com**, so every write is
attributed to that account — there is no impersonation and no dry-run.

## Three things that will waste your time

1. **`/rest/api/3/search` no longer exists.** Atlassian removed it: it answers
   `The requested API has been removed`. Use **`/rest/api/3/search/jql`**.
2. **JQL must be bounded.** An unrestricted query is rejected upstream with
   `Unbounded JQL queries are not allowed here` — even `order by created DESC`
   alone fails. Always carry a real restriction (`project = X`, `assignee = currentUser()`).
3. **`search/jql` pages by token, not offset.** The response is
   `{issues, nextPageToken, isLast}` — there is no `startAt` and **no `total`**.
   Page by feeding `nextPageToken` back until `isLast` is true.

```bash
jira 'api/3/search/jql?jql=project%3DAAS1%20ORDER%20BY%20created%20DESC&maxResults=50&fields=key,summary,status' \
  | jq -r '.issues[] | "\(.key)  [\(.fields.status.name)]  \(.fields.summary)"'
```

Ask for `fields` explicitly. The default response is enormous and mostly noise.

## Verified endpoints

Each of these was exercised through the passthrough:

| | |
|---|---|
| `api/3/myself` | who the credential is |
| `api/3/project/search?maxResults=N` | projects → `.values[]` |
| `api/3/search/jql?jql=…&fields=…` | JQL search, token-paged |
| `api/3/issue/<KEY>?fields=…` | one issue |
| `api/3/issue/<KEY>/transitions` | available transitions with their ids |
| `api/3/issue/<KEY>/comment` | read (GET) and write (POST, ADF body) |

Anything else in the Jira Cloud v3 REST surface should work the same way —
changelogs, worklogs, attachments, users, `agile/1.0/board/...` — the proxy does
not curate the path.

**Comments use ADF**, not plain text or wiki markup: `{type:"doc", version:1,
content:[{type:"paragraph", content:[{type:"text", text:"…"}]}]}`. A bare string
is rejected.

## Rate limits

Atlassian's `X-RateLimit-*` and `Retry-After` headers are passed through, so
watch them on bulk work. Observed on this site: `x-ratelimit-limit: 350`, with
`x-ratelimit-remaining` counting down — far more headroom than the MCP gives.

```bash
jira api/3/myself -D - -o /dev/null 2>/dev/null | grep -i 'x-ratelimit\|retry-after'
```

On `429`, honour `Retry-After` rather than retrying immediately.

## What this cannot do

- **Only the one site.** The host is a constant in `services/jiraProxyService.js`, not a request parameter. That pinning is what keeps this from being an SSRF relay like `POST /api/proxy`, so do not "fix" it by taking the host from the caller; add a host allowlist if another site is ever needed.
- **Only paths under `rest/`.** Traversal is rejected in literal and percent-encoded form.
- **`GET POST PUT PATCH DELETE` only** — `HEAD` and the rest answer 405.
- 60s timeout, 25MB response cap. Page large reads instead of widening them.

## Zero's own Jira endpoints are a different thing

Not to be confused with the passthrough:

- **`GET /api/jira/queue?jql=…`** collects an issue set and **persists a snapshot into Zero's SQLite**, returning counts (`total`, `returned`, `snapshotKey`, `isLast`) — not the issues themselves. Useful for a workflow that will read the snapshot later; useless if you just want the data now.
- **`POST /api/jira/action`** performs one of six writes: `comment`, `add_label`, `create_issue`, `delete_issue`, `transition`, `update_fields`. Field names are not the ones you would guess — comment takes **`text`** (or `commentBody`), and `add_label` takes **`label`**, singular. There is no read action.

Neither carries `checkLocalAccess`; the passthrough does.

## Scope

This is **work data** for the user's Stefanini account. Customer names, ticket
contents and account details from here are confidential: never paste them into a
public gist, an artifact, or anywhere outside this machine. Team-facing tooling
built on top of this belongs in the **SAMS plugin**, not in Zero — Zero is the
personal harness that happens to hold the credential.
