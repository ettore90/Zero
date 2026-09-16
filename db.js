// =============================================================================
// db.js — SQLite database initialization and schema management
// =============================================================================
// Single source of truth for all persistent data previously stored in JSON files:
//   - sessions.json      → table: sessions
//   - vector_memory.json → table: memories
//   - usage (ettore.json usageHistory) → table: usage_records
//   - agents.json state payloads       → table: agents
//   - workflow run logs                → tables: workflow_runs, workflow_run_events
//   - prompt documents/versioning      → tables: prompt_documents, prompt_versions
// =============================================================================

import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';
import crypto from 'crypto';

let _db = null;

export function getDb() {
  if (!_db) throw new Error('Database not initialized. Call initDb() first.');
  return _db;
}

export function initDb(dbPath) {
  if (_db) {
    _ensureRuntimeSchema(_db);
    return _db;
  }
  const dir = path.dirname(dbPath);
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  _db = new Database(dbPath);
  _db.pragma('journal_mode = WAL');
  _db.pragma('synchronous = NORMAL');
  _db.pragma('foreign_keys = ON');
  _ensureRuntimeSchema(_db);
  _migratePluginAccessGrants(_db);
  _migrateGithubPrivateAccessToRefScope(_db);
  _migrateGithubPrivateAccessToPersistent(_db);
  _migratePromptPackageSyncSourcesToRefs(_db);
  _createSchema(_db);
  _ensureRuntimeSchema(_db);
  console.log(`[db] SQLite initialized at ${dbPath}`);
  return _db;
}

function _ensureRuntimeSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_tool_artifacts (
      artifact_ref TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workflow_id TEXT,
      workflow_name TEXT NOT NULL,
      node_id TEXT,
      node_label TEXT,
      tool_name TEXT NOT NULL,
      output_class TEXT NOT NULL DEFAULT 'artifact',
      payload TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_tool_artifacts_run_id ON workflow_tool_artifacts(run_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_workflow_tool_artifacts_workflow_id ON workflow_tool_artifacts(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_tool_artifacts_tool_name ON workflow_tool_artifacts(tool_name);
    CREATE INDEX IF NOT EXISTS idx_workflow_tool_artifacts_created_at ON workflow_tool_artifacts(created_at DESC);

    CREATE TABLE IF NOT EXISTS workflow_node_artifacts (
      artifact_ref TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workflow_id TEXT,
      workflow_name TEXT NOT NULL,
      node_id TEXT NOT NULL,
      node_label TEXT,
      node_type TEXT NOT NULL,
      producer_id TEXT,
      output_class TEXT NOT NULL DEFAULT 'artifact',
      payload TEXT NOT NULL DEFAULT '{}',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_node_artifacts_run_id ON workflow_node_artifacts(run_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_artifacts_workflow_id ON workflow_node_artifacts(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_artifacts_node_type ON workflow_node_artifacts(node_type);
    CREATE INDEX IF NOT EXISTS idx_workflow_node_artifacts_created_at ON workflow_node_artifacts(created_at DESC);
  `);
}

function _createSchema(db) {
  db.exec(`
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      agent_id TEXT,
      title TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      data TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_sessions_agent_id ON sessions(agent_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_updated_at ON sessions(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agents (
      id TEXT NOT NULL,
      username TEXT NOT NULL,
      name TEXT,
      is_master INTEGER NOT NULL DEFAULT 0,
      data TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      PRIMARY KEY (username, id)
    );
    CREATE INDEX IF NOT EXISTS idx_agents_username ON agents(username);
    CREATE INDEX IF NOT EXISTS idx_agents_is_master ON agents(username, is_master);
    CREATE INDEX IF NOT EXISTS idx_agents_updated_at ON agents(username, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      display_name TEXT,
      email TEXT,
      role TEXT NOT NULL DEFAULT 'admin',
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_users_username ON users(username);
    CREATE INDEX IF NOT EXISTS idx_users_updated_at ON users(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_sessions (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL,
      session_token TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      expires_at INTEGER,
      last_seen_at INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON user_sessions(expires_at);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_updated_at ON user_sessions(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_preferences (
      user_id TEXT PRIMARY KEY,
      preferences TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_preferences_updated_at ON user_preferences(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS user_config (
      user_id TEXT PRIMARY KEY,
      config_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_user_config_updated_at ON user_config(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS model_configs (
      id TEXT PRIMARY KEY,
      user_id TEXT,
      model_key TEXT NOT NULL,
      config TEXT NOT NULL DEFAULT '{}',
      is_default INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_model_configs_user_id ON model_configs(user_id);
    CREATE INDEX IF NOT EXISTS idx_model_configs_model_key ON model_configs(model_key);
    CREATE INDEX IF NOT EXISTS idx_model_configs_is_default ON model_configs(is_default);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS agent_state_meta (
      username TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      revision INTEGER NOT NULL DEFAULT 0,
      deleted INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT NOT NULL DEFAULT '{}',
      PRIMARY KEY (username, agent_id)
    );
    CREATE INDEX IF NOT EXISTS idx_agent_state_meta_username ON agent_state_meta(username);
    CREATE INDEX IF NOT EXISTS idx_agent_state_meta_deleted ON agent_state_meta(username, deleted);
    CREATE INDEX IF NOT EXISTS idx_agent_state_meta_updated_at ON agent_state_meta(username, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS memories (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL DEFAULT 'fact',
      content TEXT NOT NULL,
      summary TEXT,
      tags TEXT NOT NULL DEFAULT '[]',
      embedding TEXT,
      confidence REAL NOT NULL DEFAULT 1.0,
      importance REAL NOT NULL DEFAULT 0.5,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      agent_id TEXT NOT NULL DEFAULT 'default',
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_memories_category ON memories(category);
    CREATE INDEX IF NOT EXISTS idx_memories_agent_id ON memories(agent_id);
    CREATE INDEX IF NOT EXISTS idx_memories_updated_at ON memories(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS usage_records (
      id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      model TEXT,
      prompt_tokens INTEGER NOT NULL DEFAULT 0,
      completion_tokens INTEGER NOT NULL DEFAULT 0,
      total_tokens INTEGER NOT NULL DEFAULT 0,
      cost REAL NOT NULL DEFAULT 0,
      timestamp INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT NOT NULL DEFAULT '{}',
      session_id TEXT,
      requests INTEGER NOT NULL DEFAULT 1
    );
    CREATE INDEX IF NOT EXISTS idx_usage_agent_id ON usage_records(agent_id);
    CREATE INDEX IF NOT EXISTS idx_usage_timestamp ON usage_records(timestamp DESC);
    CREATE INDEX IF NOT EXISTS idx_usage_model ON usage_records(model);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS strategy_plans (
      plan_key TEXT PRIMARY KEY,
      request_id TEXT NOT NULL UNIQUE,
      username TEXT NOT NULL,
      agent_id TEXT,
      session_id TEXT,
      tool_call_id TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      payload TEXT NOT NULL DEFAULT '{}',
      decision TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_strategy_plans_request_id ON strategy_plans(request_id);
    CREATE INDEX IF NOT EXISTS idx_strategy_plans_username ON strategy_plans(username);
    CREATE INDEX IF NOT EXISTS idx_strategy_plans_agent_session ON strategy_plans(username, agent_id, session_id);
    CREATE INDEX IF NOT EXISTS idx_strategy_plans_updated_at ON strategy_plans(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS subagent_audit (
      id TEXT PRIMARY KEY,
      parent_audit_id TEXT,
      root_audit_id TEXT,
      username TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      agent_name TEXT,
      orchestrator_agent_id TEXT,
      task TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      iteration_count INTEGER NOT NULL DEFAULT 0,
      repeated_call_killed INTEGER NOT NULL DEFAULT 0,
      final_answer TEXT,
      tool_summary TEXT NOT NULL DEFAULT '[]',
      execution_log TEXT NOT NULL DEFAULT '[]',
      started_at INTEGER NOT NULL,
      completed_at INTEGER,
      expires_at INTEGER NOT NULL,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_subagent_audit_username ON subagent_audit(username);
    CREATE INDEX IF NOT EXISTS idx_subagent_audit_agent_id ON subagent_audit(agent_id);
    CREATE INDEX IF NOT EXISTS idx_subagent_audit_parent ON subagent_audit(parent_audit_id);
    CREATE INDEX IF NOT EXISTS idx_subagent_audit_root ON subagent_audit(root_audit_id);
    CREATE INDEX IF NOT EXISTS idx_subagent_audit_expires_at ON subagent_audit(expires_at);
    CREATE INDEX IF NOT EXISTS idx_subagent_audit_started_at ON subagent_audit(started_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_runs (
      id TEXT PRIMARY KEY,
      workflow_id TEXT,
      workflow_name TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'running',
      started_at INTEGER NOT NULL,
      finished_at INTEGER,
      last_event_at INTEGER,
      error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_id ON workflow_runs(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_workflow_name ON workflow_runs(workflow_name);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_status ON workflow_runs(status);
    CREATE INDEX IF NOT EXISTS idx_workflow_runs_started_at ON workflow_runs(started_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS workflow_run_events (
      id TEXT PRIMARY KEY,
      run_id TEXT NOT NULL,
      workflow_id TEXT,
      workflow_name TEXT NOT NULL,
      event TEXT NOT NULL,
      node_id TEXT,
      node_label TEXT,
      agent_id TEXT,
      message TEXT,
      payload TEXT NOT NULL DEFAULT '{}',
      timestamp INTEGER NOT NULL,
      FOREIGN KEY (run_id) REFERENCES workflow_runs(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_run_events_run_id ON workflow_run_events(run_id, timestamp ASC);
    CREATE INDEX IF NOT EXISTS idx_workflow_run_events_workflow_id ON workflow_run_events(workflow_id);
    CREATE INDEX IF NOT EXISTS idx_workflow_run_events_event ON workflow_run_events(event);
    CREATE INDEX IF NOT EXISTS idx_workflow_run_events_timestamp ON workflow_run_events(timestamp DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_documents (
      id TEXT PRIMARY KEY,
      key TEXT NOT NULL UNIQUE,
      title TEXT NOT NULL DEFAULT '',
      current_version_id TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      metadata TEXT NOT NULL DEFAULT '{}'
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_documents_key ON prompt_documents(key);
    CREATE INDEX IF NOT EXISTS idx_prompt_documents_updated_at ON prompt_documents(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_versions (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (document_id) REFERENCES prompt_documents(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_versions_document_version ON prompt_versions(document_id, version);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_document_id ON prompt_versions(document_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_versions_created_at ON prompt_versions(created_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_blocks (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      block_key TEXT NOT NULL,
      block_type TEXT NOT NULL DEFAULT 'text',
      title TEXT NOT NULL DEFAULT '',
      content TEXT NOT NULL DEFAULT '',
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES prompt_documents(id) ON DELETE CASCADE,
      UNIQUE (document_id, block_key)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_blocks_document_id ON prompt_blocks(document_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_blocks_updated_at ON prompt_blocks(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_block_versions (
      id TEXT PRIMARY KEY,
      block_id TEXT NOT NULL,
      version INTEGER NOT NULL,
      content TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      created_by TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      FOREIGN KEY (block_id) REFERENCES prompt_blocks(id) ON DELETE CASCADE
    );
    CREATE UNIQUE INDEX IF NOT EXISTS idx_prompt_block_versions_block_version ON prompt_block_versions(block_id, version);
    CREATE INDEX IF NOT EXISTS idx_prompt_block_versions_block_id ON prompt_block_versions(block_id);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_block_type_assignments (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      block_type TEXT NOT NULL,
      auto_include INTEGER NOT NULL DEFAULT 1,
      force_include INTEGER NOT NULL DEFAULT 0,
      forced_position INTEGER,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES prompt_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (block_id) REFERENCES prompt_blocks(id) ON DELETE CASCADE,
      UNIQUE (document_id, block_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_block_type_assignments_document_id ON prompt_block_type_assignments(document_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_block_type_assignments_block_type ON prompt_block_type_assignments(block_type);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_document_block_refs (
      id TEXT PRIMARY KEY,
      document_id TEXT NOT NULL,
      block_id TEXT NOT NULL,
      block_version_id TEXT,
      block_type TEXT,
      position INTEGER NOT NULL DEFAULT 0,
      included INTEGER NOT NULL DEFAULT 1,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (document_id) REFERENCES prompt_documents(id) ON DELETE CASCADE,
      FOREIGN KEY (block_id) REFERENCES prompt_blocks(id) ON DELETE CASCADE,
      FOREIGN KEY (block_version_id) REFERENCES prompt_block_versions(id) ON DELETE SET NULL,
      UNIQUE (document_id, block_id)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_document_block_refs_document_id ON prompt_document_block_refs(document_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_document_block_refs_position ON prompt_document_block_refs(document_id, position ASC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_packages (
      id TEXT PRIMARY KEY,
      package_key TEXT NOT NULL UNIQUE,
      source TEXT NOT NULL,
      repository TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'active', 'disabled', 'superseded', 'failed')),
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_packages_source_repository ON prompt_packages(source, repository);
    CREATE INDEX IF NOT EXISTS idx_prompt_packages_status ON prompt_packages(status);
    CREATE INDEX IF NOT EXISTS idx_prompt_packages_updated_at ON prompt_packages(updated_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_package_versions (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      version TEXT NOT NULL,
      source_commit TEXT NOT NULL,
      source_ref TEXT,
      manifest TEXT NOT NULL DEFAULT '{}',
      validation TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'active', 'disabled', 'superseded', 'failed')),
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (package_id) REFERENCES prompt_packages(id) ON DELETE CASCADE,
      UNIQUE (package_id, id),
      UNIQUE (package_id, source_commit)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_package_versions_package_id ON prompt_package_versions(package_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_versions_status ON prompt_package_versions(status);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_versions_created_at ON prompt_package_versions(created_at DESC);

    CREATE TABLE IF NOT EXISTS prompt_package_artifacts (
      id TEXT PRIMARY KEY,
      package_version_id TEXT NOT NULL,
      type TEXT NOT NULL,
      artifact_key TEXT NOT NULL,
      source_path TEXT,
      content_hash TEXT,
      prompt_block_id TEXT,
      prompt_block_version_id TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (package_version_id) REFERENCES prompt_package_versions(id) ON DELETE CASCADE,
      FOREIGN KEY (prompt_block_id) REFERENCES prompt_blocks(id) ON DELETE SET NULL,
      FOREIGN KEY (prompt_block_version_id) REFERENCES prompt_block_versions(id) ON DELETE SET NULL,
      UNIQUE (package_version_id, type, artifact_key)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_package_artifacts_package_version_id ON prompt_package_artifacts(package_version_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_artifacts_prompt_block_id ON prompt_package_artifacts(prompt_block_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_artifacts_prompt_block_version_id ON prompt_package_artifacts(prompt_block_version_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_artifacts_content_hash ON prompt_package_artifacts(content_hash);

    CREATE TABLE IF NOT EXISTS prompt_package_events (
      id TEXT PRIMARY KEY,
      package_id TEXT NOT NULL,
      package_version_id TEXT,
      event TEXT NOT NULL,
      actor TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      FOREIGN KEY (package_id) REFERENCES prompt_packages(id) ON DELETE CASCADE,
      FOREIGN KEY (package_id, package_version_id) REFERENCES prompt_package_versions(package_id, id)
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_package_events_package_id ON prompt_package_events(package_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_events_package_version_id ON prompt_package_events(package_version_id);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_events_event ON prompt_package_events(event);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_events_created_at ON prompt_package_events(created_at DESC);

    -- Access records are declarative only. They never activate a package or configure tools.
    CREATE TABLE IF NOT EXISTS plugin_access_grants (
      id TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      package_version_id TEXT NOT NULL,
      mode TEXT NOT NULL CHECK (mode IN ('direct', 'request', 'unavailable')),
      exclusions TEXT NOT NULL DEFAULT '{"skills":[],"bundles":[],"tools":[]}',
      approved_features TEXT NOT NULL DEFAULT '{"skills":[],"bundles":[],"tools":[]}',
      actor TEXT,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      UNIQUE (owner_username, agent_id, package_version_id),
      FOREIGN KEY (package_version_id) REFERENCES prompt_package_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_access_grants_owner_agent ON plugin_access_grants(owner_username, agent_id, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plugin_access_grants_owner_version ON plugin_access_grants(owner_username, package_version_id);

    CREATE TABLE IF NOT EXISTS plugin_access_requests (
      id TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      agent_id TEXT NOT NULL,
      package_version_id TEXT NOT NULL,
      selections TEXT NOT NULL DEFAULT '{"skills":[],"bundles":[],"tools":[]}',
      reason TEXT,
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
      requester_actor TEXT,
      decision_actor TEXT,
      decision_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      FOREIGN KEY (package_version_id) REFERENCES prompt_package_versions(id) ON DELETE CASCADE
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_access_requests_owner_agent ON plugin_access_requests(owner_username, agent_id, created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_plugin_access_requests_owner_status_version ON plugin_access_requests(owner_username, status, package_version_id, created_at DESC);

    CREATE TABLE IF NOT EXISTS plugin_access_events (
      id TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      grant_id TEXT REFERENCES plugin_access_grants(id) ON DELETE SET NULL,
      request_id TEXT REFERENCES plugin_access_requests(id) ON DELETE SET NULL,
      package_version_id TEXT NOT NULL REFERENCES prompt_package_versions(id) ON DELETE CASCADE,
      event TEXT NOT NULL,
      actor TEXT,
      details TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_plugin_access_events_owner_grant ON plugin_access_events(owner_username, grant_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_plugin_access_events_owner_request ON plugin_access_events(owner_username, request_id, created_at ASC);
    CREATE INDEX IF NOT EXISTS idx_plugin_access_events_owner_version ON plugin_access_events(owner_username, package_version_id, created_at ASC);
  `);

  db.exec(`
    -- Declarative authorization records only. No credential material or request metadata is stored.
    CREATE TABLE IF NOT EXISTS github_private_access_requests (
      id TEXT PRIMARY KEY,
      owner_username TEXT NOT NULL,
      source_repository TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose = 'read_only'),
      status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
      requested_by TEXT,
      decided_by TEXT,
      requested_at INTEGER NOT NULL,
      decided_at INTEGER,
      expires_at INTEGER,
      revoked_by TEXT,
      revoked_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      CHECK ((status = 'pending' AND decided_at IS NULL AND expires_at IS NULL AND revoked_at IS NULL)
        OR (status = 'approved' AND decided_at IS NOT NULL AND revoked_at IS NULL)
        OR (status = 'rejected' AND decided_at IS NOT NULL AND expires_at IS NULL AND revoked_at IS NULL)
        OR (status = 'revoked' AND decided_at IS NOT NULL AND expires_at IS NOT NULL AND revoked_at IS NOT NULL))
    );
    CREATE INDEX IF NOT EXISTS idx_github_private_access_requests_owner ON github_private_access_requests(owner_username, requested_at DESC, id DESC);
    CREATE INDEX IF NOT EXISTS idx_github_private_access_requests_effective ON github_private_access_requests(owner_username, source_repository, source_ref, purpose, status, expires_at DESC);

    CREATE TABLE IF NOT EXISTS github_private_access_events (
      id TEXT PRIMARY KEY,
      request_id TEXT NOT NULL REFERENCES github_private_access_requests(id) ON DELETE CASCADE,
      owner_username TEXT NOT NULL,
      source_repository TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      purpose TEXT NOT NULL CHECK (purpose = 'read_only'),
      event TEXT NOT NULL CHECK (event IN ('requested', 'approved', 'rejected', 'revoked')),
      actor TEXT,
      occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_github_private_access_events_request ON github_private_access_events(request_id, occurred_at ASC, id ASC);
    CREATE INDEX IF NOT EXISTS idx_github_private_access_events_owner ON github_private_access_events(owner_username, occurred_at DESC, id DESC);
  `);

  db.exec(`
    -- OAuth credentials are encrypted server-side and never serialized into API responses or audits.
    CREATE TABLE IF NOT EXISTS github_oauth_connections (
      owner_username TEXT PRIMARY KEY,
      token_ciphertext TEXT NOT NULL,
      token_iv TEXT NOT NULL,
      token_tag TEXT NOT NULL,
      scopes TEXT NOT NULL,
      github_login TEXT,
      expires_at INTEGER,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS grafana_loki_audits (
      id TEXT PRIMARY KEY, actor TEXT, operation TEXT NOT NULL, status INTEGER NOT NULL,
      estimated_bytes INTEGER NOT NULL DEFAULT 0, returned INTEGER NOT NULL DEFAULT 0, occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_grafana_loki_audits_occurred ON grafana_loki_audits(occurred_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS mongo_read_audits (
      id TEXT PRIMARY KEY, actor TEXT, mode TEXT NOT NULL, operation TEXT NOT NULL,
      status INTEGER NOT NULL, returned INTEGER NOT NULL DEFAULT 0, occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_mongo_read_audits_occurred ON mongo_read_audits(occurred_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS jira_proxy_audits (
      id TEXT PRIMARY KEY, actor TEXT, method TEXT NOT NULL, path TEXT NOT NULL,
      status INTEGER NOT NULL, mutable INTEGER NOT NULL DEFAULT 0, occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_jira_proxy_audits_occurred ON jira_proxy_audits(occurred_at DESC);
  `);

  db.exec(`
    -- One intentionally global Atlassian MCP OAuth connection. Both refresh and
    -- registration secrets are encrypted; the UI only receives redacted status.
    CREATE TABLE IF NOT EXISTS atlassian_mcp_connection (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      access_ciphertext TEXT NOT NULL, access_iv TEXT NOT NULL, access_tag TEXT NOT NULL,
      refresh_ciphertext TEXT, refresh_iv TEXT, refresh_tag TEXT,
      client_ciphertext TEXT NOT NULL, client_iv TEXT NOT NULL, client_tag TEXT NOT NULL,
      client_secret_ciphertext TEXT, client_secret_iv TEXT, client_secret_tag TEXT,
      scopes TEXT NOT NULL DEFAULT '', expires_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS atlassian_mcp_audits (
      id TEXT PRIMARY KEY, event TEXT NOT NULL, actor TEXT, tool_name TEXT,
      mutable INTEGER NOT NULL DEFAULT 0, status TEXT NOT NULL, details TEXT NOT NULL DEFAULT '{}', occurred_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_atlassian_mcp_audits_occurred ON atlassian_mcp_audits(occurred_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_package_sync_sources (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE,
      provider TEXT NOT NULL CHECK (provider = 'github'),
      repository TEXT NOT NULL,
      source_ref TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      last_seen_commit TEXT,
      last_staged_commit TEXT,
      last_sync_at INTEGER,
      last_error TEXT,
      metadata TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_package_sync_sources_enabled ON prompt_package_sync_sources(enabled);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_sync_sources_repository_ref ON prompt_package_sync_sources(repository, source_ref);
    CREATE INDEX IF NOT EXISTS idx_prompt_package_sync_sources_updated_at ON prompt_package_sync_sources(updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_package_sync_jobs (
      id TEXT PRIMARY KEY,
      source_key TEXT NOT NULL UNIQUE REFERENCES prompt_package_sync_sources(source_key) ON DELETE CASCADE,
      enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
      interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 60 AND 86400),
      descriptor TEXT NOT NULL,
      package TEXT NOT NULL,
      version TEXT NOT NULL,
      document_key TEXT NOT NULL,
      artifact_mappings TEXT NOT NULL,
      "references" TEXT NOT NULL,
      details TEXT NOT NULL,
      created_by TEXT,
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_package_sync_jobs_enabled_updated_at ON prompt_package_sync_jobs(enabled, updated_at DESC);
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS prompt_composition_audits (
      id TEXT PRIMARY KEY,
      audit_kind TEXT NOT NULL,
      document_id TEXT REFERENCES prompt_documents(id) ON DELETE SET NULL,
      document_version_id TEXT REFERENCES prompt_versions(id) ON DELETE SET NULL,
      package_version_id TEXT REFERENCES prompt_package_versions(id) ON DELETE SET NULL,
      agent_id TEXT,
      session_id TEXT,
      execution_id TEXT,
      request_id TEXT,
      idempotency_key TEXT,
      composition_hash TEXT NOT NULL,
      input_hash TEXT,
      selected_items TEXT NOT NULL DEFAULT '[]',
      excluded_items TEXT NOT NULL DEFAULT '[]',
      context_ids TEXT NOT NULL DEFAULT '{}',
      budget TEXT NOT NULL DEFAULT '{}',
      candidate_count INTEGER NOT NULL,
      selected_count INTEGER NOT NULL,
      excluded_count INTEGER NOT NULL,
      created_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_prompt_composition_audits_created_at ON prompt_composition_audits(created_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_composition_audits_execution_id_created_at ON prompt_composition_audits(execution_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_composition_audits_request_id_created_at ON prompt_composition_audits(request_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_composition_audits_document_id_created_at ON prompt_composition_audits(document_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_composition_audits_session_id_created_at ON prompt_composition_audits(session_id, created_at);
    CREATE INDEX IF NOT EXISTS idx_prompt_composition_audits_composition_hash ON prompt_composition_audits(composition_hash);
    CREATE UNIQUE INDEX IF NOT EXISTS uq_prompt_composition_audits_idempotency_key ON prompt_composition_audits(idempotency_key) WHERE idempotency_key IS NOT NULL;
  `);

  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);

  _migratePromptPackageSchema(db);
  _migratePluginAccessGrants(db);
  _migrateStrategyPlans(db);
}

function _migratePromptPackageSchema(db) {
  const packageSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'prompt_packages'`).get()?.sql || '';
  const versionSql = db.prepare(`SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'prompt_package_versions'`).get()?.sql || '';
  const normalizedPackageSql = packageSql.toLowerCase().replace(/\s+/g, '');
  const normalizedVersionSql = versionSql.toLowerCase().replace(/\s+/g, '');
  const statusCheckPattern = /check\(statusin\(['"]staged['"],['"]active['"],['"]disabled['"],['"]superseded['"],['"]failed['"]\)\)/;
  const hasPackageStatusCheck = statusCheckPattern.test(normalizedPackageSql);
  const hasVersionStatusCheck = statusCheckPattern.test(normalizedVersionSql);
  const hasVersionPackageIdUnique = db.prepare(`PRAGMA index_list(prompt_package_versions)`).all()
    .some((index) => index.unique && db.prepare(`PRAGMA index_info(${_quoteIdentifier(index.name)})`).all()
      .sort((a, b) => a.seqno - b.seqno)
      .map((column) => column.name)
      .join(',') === 'package_id,id');
  const eventForeignKeys = db.prepare(`PRAGMA foreign_key_list(prompt_package_events)`).all();
  const eventForeignKeysById = new Map();
  for (const foreignKey of eventForeignKeys) {
    const foreignKeys = eventForeignKeysById.get(foreignKey.id) || [];
    foreignKeys.push(foreignKey);
    eventForeignKeysById.set(foreignKey.id, foreignKeys);
  }
  const hasEventCompositeForeignKey = [...eventForeignKeysById.values()]
    .some((foreignKeys) => foreignKeys.length === 2
      && foreignKeys.every((foreignKey) => foreignKey.table === 'prompt_package_versions')
      && foreignKeys.some((foreignKey) => foreignKey.seq === 0 && foreignKey.from === 'package_id' && foreignKey.to === 'package_id')
      && foreignKeys.some((foreignKey) => foreignKey.seq === 1 && foreignKey.from === 'package_version_id' && foreignKey.to === 'id'));

  db.exec('CREATE INDEX IF NOT EXISTS idx_prompt_package_artifacts_prompt_block_version_id ON prompt_package_artifacts(prompt_block_version_id)');
  if (hasPackageStatusCheck && hasVersionStatusCheck && hasVersionPackageIdUnique && hasEventCompositeForeignKey) return;

  const invalidStatus = db.prepare(`
    SELECT 'prompt_packages' AS table_name, id, status FROM prompt_packages
    WHERE status NOT IN ('staged', 'active', 'disabled', 'superseded', 'failed')
    UNION ALL
    SELECT 'prompt_package_versions' AS table_name, id, status FROM prompt_package_versions
    WHERE status NOT IN ('staged', 'active', 'disabled', 'superseded', 'failed')
    LIMIT 1
  `).get();
  if (invalidStatus) throw new Error(`Cannot migrate prompt package schema: invalid status in ${invalidStatus.table_name} (${invalidStatus.id}).`);

  const orphan = db.prepare(`
    SELECT 'prompt_package_versions.package_id' AS relation, v.id FROM prompt_package_versions v
      LEFT JOIN prompt_packages p ON p.id = v.package_id WHERE p.id IS NULL
    UNION ALL
    SELECT 'prompt_package_artifacts.package_version_id' AS relation, a.id FROM prompt_package_artifacts a
      LEFT JOIN prompt_package_versions v ON v.id = a.package_version_id WHERE v.id IS NULL
    UNION ALL
    SELECT 'prompt_package_artifacts.prompt_block_id' AS relation, a.id FROM prompt_package_artifacts a
      LEFT JOIN prompt_blocks b ON b.id = a.prompt_block_id WHERE a.prompt_block_id IS NOT NULL AND b.id IS NULL
    UNION ALL
    SELECT 'prompt_package_artifacts.prompt_block_version_id' AS relation, a.id FROM prompt_package_artifacts a
      LEFT JOIN prompt_block_versions bv ON bv.id = a.prompt_block_version_id WHERE a.prompt_block_version_id IS NOT NULL AND bv.id IS NULL
    UNION ALL
    SELECT 'prompt_package_events.package_id' AS relation, e.id FROM prompt_package_events e
      LEFT JOIN prompt_packages p ON p.id = e.package_id WHERE p.id IS NULL
    UNION ALL
    SELECT 'prompt_package_events.package_version_id' AS relation, e.id FROM prompt_package_events e
      LEFT JOIN prompt_package_versions v ON v.id = e.package_version_id AND v.package_id = e.package_id
      WHERE e.package_version_id IS NOT NULL AND v.id IS NULL
    LIMIT 1
  `).get();
  if (orphan) throw new Error(`Cannot migrate prompt package schema: orphaned ${orphan.relation} (${orphan.id}).`);

  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  let transactionStarted = false;
  try {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    transactionStarted = true;
    db.exec(`
      ALTER TABLE prompt_packages RENAME TO prompt_packages_legacy;
      ALTER TABLE prompt_package_versions RENAME TO prompt_package_versions_legacy;
      ALTER TABLE prompt_package_artifacts RENAME TO prompt_package_artifacts_legacy;
      ALTER TABLE prompt_package_events RENAME TO prompt_package_events_legacy;

      CREATE TABLE prompt_packages (
        id TEXT PRIMARY KEY, package_key TEXT NOT NULL UNIQUE, source TEXT NOT NULL, repository TEXT NOT NULL,
        status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'active', 'disabled', 'superseded', 'failed')),
        metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE prompt_package_versions (
        id TEXT PRIMARY KEY, package_id TEXT NOT NULL, version TEXT NOT NULL, source_commit TEXT NOT NULL, source_ref TEXT,
        manifest TEXT NOT NULL DEFAULT '{}', validation TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'staged' CHECK (status IN ('staged', 'active', 'disabled', 'superseded', 'failed')),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (package_id) REFERENCES prompt_packages(id) ON DELETE CASCADE, UNIQUE (package_id, id), UNIQUE (package_id, source_commit)
      );
      CREATE TABLE prompt_package_artifacts (
        id TEXT PRIMARY KEY, package_version_id TEXT NOT NULL, type TEXT NOT NULL, artifact_key TEXT NOT NULL, source_path TEXT,
        content_hash TEXT, prompt_block_id TEXT, prompt_block_version_id TEXT, metadata TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (package_version_id) REFERENCES prompt_package_versions(id) ON DELETE CASCADE,
        FOREIGN KEY (prompt_block_id) REFERENCES prompt_blocks(id) ON DELETE SET NULL,
        FOREIGN KEY (prompt_block_version_id) REFERENCES prompt_block_versions(id) ON DELETE SET NULL,
        UNIQUE (package_version_id, type, artifact_key)
      );
      CREATE TABLE prompt_package_events (
        id TEXT PRIMARY KEY, package_id TEXT NOT NULL, package_version_id TEXT, event TEXT NOT NULL, actor TEXT,
        details TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (package_id) REFERENCES prompt_packages(id) ON DELETE CASCADE,
        FOREIGN KEY (package_id, package_version_id) REFERENCES prompt_package_versions(package_id, id)
      );

      INSERT INTO prompt_packages (id, package_key, source, repository, status, metadata, created_at, updated_at)
        SELECT id, package_key, source, repository, status, metadata, created_at, updated_at FROM prompt_packages_legacy;
      INSERT INTO prompt_package_versions (id, package_id, version, source_commit, source_ref, manifest, validation, status, created_at, updated_at)
        SELECT id, package_id, version, source_commit, source_ref, manifest, validation, status, created_at, updated_at FROM prompt_package_versions_legacy;
      INSERT INTO prompt_package_artifacts (id, package_version_id, type, artifact_key, source_path, content_hash, prompt_block_id, prompt_block_version_id, metadata, created_at, updated_at)
        SELECT id, package_version_id, type, artifact_key, source_path, content_hash, prompt_block_id, prompt_block_version_id, metadata, created_at, updated_at FROM prompt_package_artifacts_legacy;
      INSERT INTO prompt_package_events (id, package_id, package_version_id, event, actor, details, created_at)
        SELECT id, package_id, package_version_id, event, actor, details, created_at FROM prompt_package_events_legacy;

      DROP TABLE prompt_package_events_legacy;
      DROP TABLE prompt_package_artifacts_legacy;
      DROP TABLE prompt_package_versions_legacy;
      DROP TABLE prompt_packages_legacy;

      CREATE INDEX idx_prompt_packages_source_repository ON prompt_packages(source, repository);
      CREATE INDEX idx_prompt_packages_status ON prompt_packages(status);
      CREATE INDEX idx_prompt_packages_updated_at ON prompt_packages(updated_at DESC);
      CREATE INDEX idx_prompt_package_versions_package_id ON prompt_package_versions(package_id);
      CREATE INDEX idx_prompt_package_versions_status ON prompt_package_versions(status);
      CREATE INDEX idx_prompt_package_versions_created_at ON prompt_package_versions(created_at DESC);
      CREATE INDEX idx_prompt_package_artifacts_package_version_id ON prompt_package_artifacts(package_version_id);
      CREATE INDEX idx_prompt_package_artifacts_prompt_block_id ON prompt_package_artifacts(prompt_block_id);
      CREATE INDEX idx_prompt_package_artifacts_prompt_block_version_id ON prompt_package_artifacts(prompt_block_version_id);
      CREATE INDEX idx_prompt_package_artifacts_content_hash ON prompt_package_artifacts(content_hash);
      CREATE INDEX idx_prompt_package_events_package_id ON prompt_package_events(package_id, created_at ASC);
      CREATE INDEX idx_prompt_package_events_package_version_id ON prompt_package_events(package_version_id);
      CREATE INDEX idx_prompt_package_events_event ON prompt_package_events(event);
      CREATE INDEX idx_prompt_package_events_created_at ON prompt_package_events(created_at DESC);
    `);
    const foreignKeyErrors = db.prepare('PRAGMA foreign_key_check').all();
    if (foreignKeyErrors.length) throw new Error(`Cannot migrate prompt package schema: foreign_key_check failed (${foreignKeyErrors[0].table}, row ${foreignKeyErrors[0].rowid}).`);
    db.exec('COMMIT');
    transactionStarted = false;
  } catch (error) {
    if (transactionStarted) db.exec('ROLLBACK');
    throw error;
  } finally {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON');
  }
}

function _migratePromptPackageSyncSourcesToRefs(db) {
  const columns = db.prepare('PRAGMA table_info(prompt_package_sync_sources)').all();
  if (!columns.length || !columns.some((column) => column.name === 'pinned_commit')) return;
  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  try {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    db.exec(`ALTER TABLE prompt_package_sync_jobs RENAME TO prompt_package_sync_jobs_legacy;
      ALTER TABLE prompt_package_sync_sources RENAME TO prompt_package_sync_sources_legacy;
      CREATE TABLE prompt_package_sync_sources (
        id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE, provider TEXT NOT NULL CHECK (provider = 'github'),
        repository TEXT NOT NULL, source_ref TEXT NOT NULL, enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)),
        last_seen_commit TEXT, last_staged_commit TEXT, last_sync_at INTEGER, last_error TEXT,
        metadata TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE TABLE prompt_package_sync_jobs (
        id TEXT PRIMARY KEY, source_key TEXT NOT NULL UNIQUE REFERENCES prompt_package_sync_sources(source_key) ON DELETE CASCADE,
        enabled INTEGER NOT NULL DEFAULT 0 CHECK (enabled IN (0, 1)), interval_seconds INTEGER NOT NULL CHECK (interval_seconds BETWEEN 60 AND 86400),
        descriptor TEXT NOT NULL, package TEXT NOT NULL, version TEXT NOT NULL, document_key TEXT NOT NULL, artifact_mappings TEXT NOT NULL,
        "references" TEXT NOT NULL, details TEXT NOT NULL, created_by TEXT, created_at INTEGER NOT NULL DEFAULT (unixepoch()), updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      INSERT INTO prompt_package_sync_sources (id, source_key, provider, repository, source_ref, enabled, last_seen_commit, last_staged_commit, last_sync_at, last_error, metadata, created_at, updated_at)
        SELECT id, source_key, provider, repository, source_ref, enabled, COALESCE(last_seen_commit, pinned_commit), COALESCE(last_staged_commit, pinned_commit), last_sync_at, last_error, metadata, created_at, updated_at FROM prompt_package_sync_sources_legacy;
      INSERT INTO prompt_package_sync_jobs SELECT * FROM prompt_package_sync_jobs_legacy;
      DROP TABLE prompt_package_sync_jobs_legacy; DROP TABLE prompt_package_sync_sources_legacy;
      CREATE INDEX idx_prompt_package_sync_sources_enabled ON prompt_package_sync_sources(enabled);
      CREATE INDEX idx_prompt_package_sync_sources_repository_ref ON prompt_package_sync_sources(repository, source_ref);
      CREATE INDEX idx_prompt_package_sync_sources_updated_at ON prompt_package_sync_sources(updated_at DESC);
      CREATE INDEX idx_prompt_package_sync_jobs_enabled_updated_at ON prompt_package_sync_jobs(enabled, updated_at DESC);`);
    const errors = db.prepare('PRAGMA foreign_key_check').all(); if (errors.length) throw new Error(`Cannot migrate prompt package sync sources: foreign_key_check failed (${errors[0].table}).`);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* no transaction */ } throw error; }
  finally { if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON'); }
}

function _migrateGithubPrivateAccessToPersistent(db) {
  const columns = db.prepare('PRAGMA table_info(github_private_access_requests)').all();
  if (!columns.length) return;
  const schema = db.prepare("SELECT sql FROM sqlite_master WHERE type='table' AND name='github_private_access_requests'").get()?.sql || '';
  if (schema.includes("status = 'approved' AND decided_at IS NOT NULL AND revoked_at IS NULL)")) return;
  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  try {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    db.exec(`ALTER TABLE github_private_access_events RENAME TO github_private_access_events_legacy;
      ALTER TABLE github_private_access_requests RENAME TO github_private_access_requests_legacy;
      CREATE TABLE github_private_access_requests (
        id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, source_repository TEXT NOT NULL, source_ref TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose = 'read_only'), status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
        requested_by TEXT, decided_by TEXT, requested_at INTEGER NOT NULL, decided_at INTEGER, expires_at INTEGER,
        revoked_by TEXT, revoked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        CHECK ((status = 'pending' AND decided_at IS NULL AND expires_at IS NULL AND revoked_at IS NULL)
          OR (status = 'approved' AND decided_at IS NOT NULL AND revoked_at IS NULL)
          OR (status = 'rejected' AND decided_at IS NOT NULL AND expires_at IS NULL AND revoked_at IS NULL)
          OR (status = 'revoked' AND decided_at IS NOT NULL AND revoked_at IS NOT NULL))
      );
      CREATE TABLE github_private_access_events (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES github_private_access_requests(id) ON DELETE CASCADE,
        owner_username TEXT NOT NULL, source_repository TEXT NOT NULL, source_ref TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose = 'read_only'), event TEXT NOT NULL CHECK (event IN ('requested', 'approved', 'rejected', 'revoked')),
        actor TEXT, occurred_at INTEGER NOT NULL
      );
      INSERT INTO github_private_access_requests SELECT id, owner_username, source_repository, source_ref, purpose, status, requested_by, decided_by, requested_at, decided_at, CASE WHEN status = 'approved' THEN NULL ELSE expires_at END, revoked_by, revoked_at, created_at, updated_at FROM github_private_access_requests_legacy;
      INSERT INTO github_private_access_events SELECT id, request_id, owner_username, source_repository, source_ref, purpose, event, actor, occurred_at FROM github_private_access_events_legacy;
      DROP TABLE github_private_access_events_legacy; DROP TABLE github_private_access_requests_legacy;
      CREATE INDEX idx_github_private_access_requests_owner ON github_private_access_requests(owner_username, requested_at DESC, id DESC);
      CREATE INDEX idx_github_private_access_requests_effective ON github_private_access_requests(owner_username, source_repository, source_ref, purpose, status, expires_at DESC);
      CREATE INDEX idx_github_private_access_events_request ON github_private_access_events(request_id, occurred_at ASC, id ASC);
      CREATE INDEX idx_github_private_access_events_owner ON github_private_access_events(owner_username, occurred_at DESC, id DESC);`);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* no transaction */ } throw error; }
  finally { if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON'); }
}

function _migrateGithubPrivateAccessToRefScope(db) {
  const columns = db.prepare('PRAGMA table_info(github_private_access_requests)').all();
  if (!columns.length || !columns.some((column) => column.name === 'source_commit')) return;
  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  try {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    db.exec(`ALTER TABLE github_private_access_events RENAME TO github_private_access_events_legacy;
      ALTER TABLE github_private_access_requests RENAME TO github_private_access_requests_legacy;
      CREATE TABLE github_private_access_requests (
        id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, source_repository TEXT NOT NULL, source_ref TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose = 'read_only'), status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'revoked')),
        requested_by TEXT, decided_by TEXT, requested_at INTEGER NOT NULL, decided_at INTEGER, expires_at INTEGER,
        revoked_by TEXT, revoked_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        CHECK ((status = 'pending' AND decided_at IS NULL AND expires_at IS NULL AND revoked_at IS NULL)
          OR (status = 'approved' AND decided_at IS NOT NULL AND revoked_at IS NULL)
          OR (status = 'rejected' AND decided_at IS NOT NULL AND expires_at IS NULL AND revoked_at IS NULL)
          OR (status = 'revoked' AND decided_at IS NOT NULL AND expires_at IS NOT NULL AND revoked_at IS NOT NULL))
      );
      CREATE TABLE github_private_access_events (
        id TEXT PRIMARY KEY, request_id TEXT NOT NULL REFERENCES github_private_access_requests(id) ON DELETE CASCADE,
        owner_username TEXT NOT NULL, source_repository TEXT NOT NULL, source_ref TEXT NOT NULL,
        purpose TEXT NOT NULL CHECK (purpose = 'read_only'), event TEXT NOT NULL CHECK (event IN ('requested', 'approved', 'rejected', 'revoked')),
        actor TEXT, occurred_at INTEGER NOT NULL
      );
      INSERT INTO github_private_access_requests (id, owner_username, source_repository, source_ref, purpose, status, requested_by, decided_by, requested_at, decided_at, expires_at, revoked_by, revoked_at, created_at, updated_at)
        SELECT id, owner_username, source_repository, source_ref, purpose, status, requested_by, decided_by, requested_at, decided_at, expires_at, revoked_by, revoked_at, created_at, updated_at FROM github_private_access_requests_legacy;
      INSERT INTO github_private_access_events (id, request_id, owner_username, source_repository, source_ref, purpose, event, actor, occurred_at)
        SELECT id, request_id, owner_username, source_repository, source_ref, purpose, event, actor, occurred_at FROM github_private_access_events_legacy;
      DROP TABLE github_private_access_events_legacy; DROP TABLE github_private_access_requests_legacy;
      CREATE INDEX idx_github_private_access_requests_owner ON github_private_access_requests(owner_username, requested_at DESC, id DESC);
      CREATE INDEX idx_github_private_access_requests_effective ON github_private_access_requests(owner_username, source_repository, source_ref, purpose, status, expires_at DESC);
      CREATE INDEX idx_github_private_access_events_request ON github_private_access_events(request_id, occurred_at ASC, id ASC);
      CREATE INDEX idx_github_private_access_events_owner ON github_private_access_events(owner_username, occurred_at DESC, id DESC);`);
    db.exec('COMMIT');
  } catch (error) { try { db.exec('ROLLBACK'); } catch { /* no transaction */ } throw error; }
  finally { if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON'); }
}

function _migratePluginAccessGrants(db) {
  const grantColumns = db.prepare('PRAGMA table_info(plugin_access_grants)').all();
  if (!grantColumns.length) return;
  const requestColumns = db.prepare('PRAGMA table_info(plugin_access_requests)').all();
  const eventColumns = db.prepare('PRAGMA table_info(plugin_access_events)').all();
  const hasOwner = (columns) => columns.some((column) => column.name === 'owner_username' && column.notnull);
  const hasApprovedFeatures = grantColumns.some((column) => column.name === 'approved_features');
  const grantNeedsMigration = !hasOwner(grantColumns) || !hasApprovedFeatures;
  const legacyApprovedFeatures = hasApprovedFeatures ? 'approved_features' : "'{\"skills\":[],\"bundles\":[],\"tools\":[]}'";
  if (!grantNeedsMigration && hasOwner(requestColumns) && hasOwner(eventColumns)) return;

  const foreignKeysWereEnabled = db.pragma('foreign_keys', { simple: true }) === 1;
  try {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = OFF');
    db.exec('BEGIN IMMEDIATE');
    db.exec(`
      ALTER TABLE plugin_access_events RENAME TO plugin_access_events_legacy;
      ALTER TABLE plugin_access_requests RENAME TO plugin_access_requests_legacy;
      ALTER TABLE plugin_access_grants RENAME TO plugin_access_grants_legacy;
      CREATE TABLE plugin_access_grants (
        id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, agent_id TEXT NOT NULL, package_version_id TEXT NOT NULL,
        mode TEXT NOT NULL CHECK (mode IN ('direct', 'request', 'unavailable')),
        exclusions TEXT NOT NULL DEFAULT '{"skills":[],"bundles":[],"tools":[]}',
        approved_features TEXT NOT NULL DEFAULT '{"skills":[],"bundles":[],"tools":[]}', actor TEXT,
        created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        UNIQUE (owner_username, agent_id, package_version_id),
        FOREIGN KEY (package_version_id) REFERENCES prompt_package_versions(id) ON DELETE CASCADE
      );
      CREATE TABLE plugin_access_requests (
        id TEXT PRIMARY KEY, owner_username TEXT NOT NULL, agent_id TEXT NOT NULL, package_version_id TEXT NOT NULL,
        selections TEXT NOT NULL DEFAULT '{"skills":[],"bundles":[],"tools":[]}', reason TEXT,
        status TEXT NOT NULL CHECK (status IN ('pending', 'approved', 'rejected', 'cancelled')),
        requester_actor TEXT, decision_actor TEXT, decision_at INTEGER, created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
        FOREIGN KEY (package_version_id) REFERENCES prompt_package_versions(id) ON DELETE CASCADE
      );
      CREATE TABLE plugin_access_events (
        id TEXT PRIMARY KEY, owner_username TEXT NOT NULL,
        grant_id TEXT REFERENCES plugin_access_grants(id) ON DELETE SET NULL,
        request_id TEXT REFERENCES plugin_access_requests(id) ON DELETE SET NULL,
        package_version_id TEXT NOT NULL REFERENCES prompt_package_versions(id) ON DELETE CASCADE,
        event TEXT NOT NULL, actor TEXT, details TEXT NOT NULL DEFAULT '{}', created_at INTEGER NOT NULL
      );
      INSERT INTO plugin_access_grants (id, owner_username, agent_id, package_version_id, mode, exclusions, approved_features, actor, created_at, updated_at)
        SELECT id, '__legacy_unscoped__', agent_id, package_version_id, mode, exclusions,
          ${legacyApprovedFeatures}, actor, created_at, updated_at FROM plugin_access_grants_legacy;
      INSERT INTO plugin_access_requests (id, owner_username, agent_id, package_version_id, selections, reason, status, requester_actor, decision_actor, decision_at, created_at, updated_at)
        SELECT id, '__legacy_unscoped__', agent_id, package_version_id, selections, reason, status, requester_actor, decision_actor, decision_at, created_at, updated_at FROM plugin_access_requests_legacy;
      INSERT INTO plugin_access_events (id, owner_username, grant_id, request_id, package_version_id, event, actor, details, created_at)
        SELECT id, '__legacy_unscoped__', grant_id, request_id, package_version_id, event, actor, details, created_at FROM plugin_access_events_legacy;
      DROP TABLE plugin_access_events_legacy;
      DROP TABLE plugin_access_requests_legacy;
      DROP TABLE plugin_access_grants_legacy;
      CREATE INDEX idx_plugin_access_grants_owner_agent ON plugin_access_grants(owner_username, agent_id, updated_at DESC);
      CREATE INDEX idx_plugin_access_grants_owner_version ON plugin_access_grants(owner_username, package_version_id);
      CREATE INDEX idx_plugin_access_requests_owner_agent ON plugin_access_requests(owner_username, agent_id, created_at DESC);
      CREATE INDEX idx_plugin_access_requests_owner_status_version ON plugin_access_requests(owner_username, status, package_version_id, created_at DESC);
      CREATE INDEX idx_plugin_access_events_owner_grant ON plugin_access_events(owner_username, grant_id, created_at ASC);
      CREATE INDEX idx_plugin_access_events_owner_request ON plugin_access_events(owner_username, request_id, created_at ASC);
      CREATE INDEX idx_plugin_access_events_owner_version ON plugin_access_events(owner_username, package_version_id, created_at ASC);
    `);
    const errors = db.prepare('PRAGMA foreign_key_check').all();
    if (errors.length) throw new Error(`Cannot migrate plugin access schema: foreign_key_check failed (${errors[0].table}, row ${errors[0].rowid}).`);
    db.exec('COMMIT');
  } catch (error) {
    try { db.exec('ROLLBACK'); } catch { /* no transaction */ }
    throw error;
  } finally {
    if (foreignKeysWereEnabled) db.pragma('foreign_keys = ON');
  }
}

function _quoteIdentifier(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function _migrateStrategyPlans(db) {
  const cols = db.prepare(`PRAGMA table_info(strategy_plans)`).all();
  if (!cols.length) return;
  const names = new Set(cols.map((c) => c.name));
  db.exec('BEGIN');
  try {
    if (!names.has('plan_key')) {
      db.exec('ALTER TABLE strategy_plans RENAME TO strategy_plans_legacy');
      db.exec(`
        CREATE TABLE strategy_plans (
          plan_key TEXT PRIMARY KEY,
          request_id TEXT NOT NULL UNIQUE,
          username TEXT NOT NULL,
          agent_id TEXT,
          session_id TEXT,
          tool_call_id TEXT,
          status TEXT NOT NULL DEFAULT 'pending',
          payload TEXT NOT NULL DEFAULT '{}',
          decision TEXT,
          created_at INTEGER NOT NULL,
          updated_at INTEGER NOT NULL
        );
      `);
      db.exec(`
        INSERT INTO strategy_plans (plan_key, request_id, username, agent_id, session_id, tool_call_id, status, payload, decision, created_at, updated_at)
        SELECT TRIM(request_id), request_id, username, agent_id, session_id, tool_call_id, status, payload, decision, created_at, updated_at
        FROM strategy_plans_legacy
        WHERE request_id IS NOT NULL AND TRIM(request_id) <> '';
      `);
      db.exec('DROP TABLE strategy_plans_legacy');
    }
    if (!names.has('request_id')) {
      db.exec('ALTER TABLE strategy_plans ADD COLUMN request_id TEXT');
    }
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function generateId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '')}`;
}
