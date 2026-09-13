const MAX_BUNDLE_ID_LENGTH = 64;

const BUNDLES = [
  {
    id: 'github-read',
    label: 'GitHub read access',
    transport: 'remote',
    mode: 'inert',
    risk: 'read-only',
    capabilities: ['repository-read', 'issue-read'],
  },
  {
    id: 'atlassian-read',
    label: 'Atlassian read access',
    transport: 'remote',
    mode: 'inert',
    risk: 'read-only',
    capabilities: ['project-read', 'issue-read'],
  },
  {
    id: 'grafana-read',
    label: 'Grafana read access',
    transport: 'stdio',
    mode: 'inert',
    risk: 'read-only',
    capabilities: ['dashboard-read'],
  },
  {
    id: 'mongodb-read',
    label: 'MongoDB read access',
    transport: 'stdio',
    mode: 'inert',
    risk: 'read-only',
    capabilities: ['database-read'],
  },
];

function freezeBundle(bundle) {
  return Object.freeze({
    ...bundle,
    capabilities: Object.freeze([...bundle.capabilities]),
  });
}

const REGISTRY = Object.freeze(BUNDLES.map(freezeBundle));
const BUNDLES_BY_ID = new Map(REGISTRY.map((bundle) => [bundle.id, bundle]));

function copyBundle(bundle) {
  return freezeBundle(bundle);
}

function isSafeBundleId(value) {
  return typeof value === 'string'
    && value.length > 0
    && value.length <= MAX_BUNDLE_ID_LENGTH
    && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value)
    && value !== '__none__';
}

export function listMcpBundles() {
  return Object.freeze(REGISTRY.map(copyBundle));
}

export function getMcpBundle(bundleId) {
  if (!isSafeBundleId(bundleId)) return undefined;
  const bundle = BUNDLES_BY_ID.get(bundleId);
  return bundle ? copyBundle(bundle) : undefined;
}

export function normalizeMcpBundleIds(value) {
  if (value === undefined || value === null) return Object.freeze([]);
  if (!Array.isArray(value)) throw new TypeError('MCP bundle ids must be an array');

  const ids = value.map((bundleId) => {
    if (!isSafeBundleId(bundleId) || !BUNDLES_BY_ID.has(bundleId)) {
      throw new TypeError('MCP bundle id is invalid');
    }
    return bundleId;
  });

  if (new Set(ids).size !== ids.length) {
    throw new TypeError('MCP bundle ids must be unique');
  }

  return Object.freeze(ids);
}
