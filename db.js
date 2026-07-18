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
    CREATE TABLE IF NOT EXISTS schema_meta (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL
    );
  `);
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
