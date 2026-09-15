import { getMcpBundle, normalizeMcpBundleIds } from './mcpBundleRegistry.js';
import { listMcpToolContractsForBundle } from './mcpToolContract.js';

function freezeBundleDescriptor(bundle) {
  return Object.freeze({
    id: bundle.id,
    label: bundle.label,
    transport: bundle.transport,
    mode: bundle.mode,
    risk: bundle.risk,
    capabilities: Object.freeze([...bundle.capabilities]),
  });
}

function readAgentValue(agent, key) {
  if (!agent || typeof agent !== 'object') return undefined;
  try {
    return agent[key];
  } catch {
    return undefined;
  }
}

function invalidAssignment() {
  return { ids: Object.freeze([]), invalidAssignment: true };
}

function resolveAssignment(value) {
  try {
    if (value === undefined || value === null) {
      return { ids: Object.freeze([]), invalidAssignment: false };
    }

    if (!Array.isArray(value)) {
      return invalidAssignment();
    }

    return {
      ids: normalizeMcpBundleIds(value),
      invalidAssignment: false,
    };
  } catch {
    return invalidAssignment();
  }
}

function resolveMcpBundlesAssignment(agent) {
  try {
    if (!agent || typeof agent !== 'object') {
      return resolveAssignment(undefined);
    }
    return resolveAssignment(agent.mcpBundles);
  } catch {
    return invalidAssignment();
  }
}

function resolveToolContracts(bundleIds, invalidAssignment) {
  if (invalidAssignment) return Object.freeze([]);

  try {
    const contracts = [];
    for (const bundleId of [...bundleIds].sort()) {
      const bundleContracts = listMcpToolContractsForBundle(bundleId);
      if (Array.isArray(bundleContracts)) contracts.push(...bundleContracts);
    }
    return Object.freeze(contracts);
  } catch {
    return Object.freeze([]);
  }
}

function resolveAllowedToolsPolicy(value, invalidAssignment, bundleIds) {
  const emptyMcpToolNames = Object.freeze([]);
  const base = {
    mcpToolNames: emptyMcpToolNames,
    mcpToolExecutionAvailable: !invalidAssignment && Array.isArray(bundleIds) && bundleIds.includes('atlassian-read'),
    invalidAssignment: Boolean(invalidAssignment),
  };
  const policy = (setting) => Object.freeze({ ...base, setting });
  const inertFallback = () => policy('tools-disabled');

  try {
    if (!Array.isArray(value) || value.length === 0) {
      return policy('legacy-unrestricted');
    }

    if (value.some((tool) => tool === '__none__')) {
      return policy('tools-disabled');
    }

    if (value.every((tool) => typeof tool === 'string' && tool.length > 0)) {
      return policy('explicit-allowlist');
    }

    return policy('legacy-unrestricted');
  } catch {
    return inertFallback();
  }
}

/**
 * Resolves registry-backed MCP bundle descriptors without attaching tools to a runtime.
 */
export function resolveMcpBundlesForAgent(agent) {
  const assignment = resolveMcpBundlesAssignment(agent);
  const allowedToolsPolicy = resolveAllowedToolsPolicy(
    readAgentValue(agent, 'allowedTools'),
    assignment.invalidAssignment,
    assignment.ids,
  );
  const bundles = Object.freeze(assignment.ids
    .map((id) => getMcpBundle(id))
    .filter(Boolean)
    .map(freezeBundleDescriptor));
  const bundleIds = Object.freeze(bundles.map((bundle) => bundle.id));
  const toolContracts = resolveToolContracts(bundleIds, assignment.invalidAssignment);
  const toolsDisabled = allowedToolsPolicy.setting === 'tools-disabled';

  return Object.freeze({
    bundles,
    bundleIds,
    mode: bundles.length > 0 ? 'inert' : 'none',
    eligible: bundles.length > 0 && !toolsDisabled,
    reason: assignment.invalidAssignment
      ? 'invalid-assignment'
      : toolsDisabled
        ? 'tools-disabled'
        : bundles.length > 0
          ? 'assigned'
          : 'no-assignment',
    allowedToolsPolicy,
    toolContracts,
  });
}
