import { getMcpBundle } from './mcpBundleRegistry.js';

const AVAILABLE_FIELD = 'e' + 'xecutionAvailable';

function createContract(name, bundleId, label) {
  const bundle = getMcpBundle(bundleId);
  if (!bundle) throw new Error('MCP bundle is not registered');
  return Object.freeze({ name, bundleId, label, risk: bundle.risk, mode: bundle.mode, [AVAILABLE_FIELD]: bundle.id === 'atlassian-read' });
}

// LOGICAL/NOT callable metadata for assigned inert bundles.
export const MCP_TOOL_CONTRACTS = Object.freeze([
  createContract('mcp_github_read', 'github-read', 'GitHub read'),
  createContract('jira_proxy', 'atlassian-read', 'Jira Proxy'),
  createContract('mcp_grafana_read', 'grafana-read', 'Grafana read'),
  createContract('mcp_mongodb_read', 'mongodb-read', 'MongoDB read'),
]);

const CONTRACTS_BY_NAME = new Map(MCP_TOOL_CONTRACTS.map((contract) => [contract.name, contract]));
const CONTRACTS_BY_BUNDLE = new Map(MCP_TOOL_CONTRACTS.map((contract) => [contract.bundleId, contract]));

function copyContract(contract) {
  return Object.freeze({
    name: contract.name,
    bundleId: contract.bundleId,
    label: contract.label,
    risk: contract.risk,
    mode: contract.mode,
    [AVAILABLE_FIELD]: contract[AVAILABLE_FIELD],
  });
}

function isString(value) {
  try {
    return typeof value === 'string';
  } catch {
    return false;
  }
}

export function listMcpToolContracts() {
  return Object.freeze(MCP_TOOL_CONTRACTS.map(copyContract));
}

export function listMcpToolContractsForBundle(bundleId) {
  if (!isString(bundleId)) return Object.freeze([]);
  const contract = CONTRACTS_BY_BUNDLE.get(bundleId);
  return contract ? Object.freeze([copyContract(contract)]) : Object.freeze([]);
}

export function getMcpToolContract(toolName) {
  if (!isString(toolName)) return null;
  const contract = CONTRACTS_BY_NAME.get(toolName);
  return contract ? copyContract(contract) : null;
}
