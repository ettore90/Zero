import path from 'path';

export function normalizeSlashes(p) {
  return String(p || '').replace(/\\/g, '/');
}

function hasPathPrefix(targetPath, prefix) {
  return targetPath === prefix || targetPath.startsWith(`${prefix}/`);
}

export function containerToHost(p, env) {
  if (!p) return p;
  const containerHome = normalizeSlashes(env?.CONTAINER_HOME || '/host_system');
  const hostHome = normalizeSlashes(env?.HOST_HOME || '/home/ettore');
  const containerWorkspace = normalizeSlashes(env?.CONTAINER_APP_ROOT || '/uby');
  const hostWorkspace = normalizeSlashes(env?.HOST_WORKSPACE_ROOT || '');

  const np = normalizeSlashes(p);
  if (hasPathPrefix(np, containerHome)) {
    return hostHome + np.slice(containerHome.length);
  }
  if (hasPathPrefix(np, containerWorkspace)) {
    return hostWorkspace ? hostWorkspace + np.slice(containerWorkspace.length) : p;
  }

  return p;
}

export function hostToContainer(p, env) {
  if (!p) return p;
  const containerHome = normalizeSlashes(env?.CONTAINER_HOME || '/host_system');
  const hostHome = normalizeSlashes(env?.HOST_HOME || '/home/ettore');
  const containerWorkspace = normalizeSlashes(env?.CONTAINER_APP_ROOT || '/uby');
  const hostWorkspace = normalizeSlashes(env?.HOST_WORKSPACE_ROOT || '');

  const np = normalizeSlashes(p);
  if (hasPathPrefix(np, hostHome)) {
    return containerHome + np.slice(hostHome.length);
  }
  if (hostWorkspace && hasPathPrefix(np, hostWorkspace)) {
    return containerWorkspace + np.slice(hostWorkspace.length);
  }

  return p;
}

export function resolveSafe(...parts) {
  return path.resolve(...parts.filter(Boolean));
}
