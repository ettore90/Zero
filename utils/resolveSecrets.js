// =============================================================================
// resolveSecrets.js — Interpolação de variáveis de ambiente/secrets
//
// Substitui {{VAR_NAME}} pelo valor correspondente em apiKeys[].
// Funciona em strings, objetos e arrays (recursivo).
//
// Uso:
//   import { resolveSecrets, resolveSecretsInObject } from '../utils/resolveSecrets.js';
//   const url = resolveSecrets('{{JIRA_BASE_URL}}/rest/api/2/issue', apiKeys);
//   const cfg = resolveSecretsInObject(node.config, apiKeys);
// =============================================================================

/**
 * Resolve {{VAR_NAME}} em uma string usando a lista de apiKeys.
 * @param {string} value
 * @param {Array<{name: string, value: string}>} apiKeys
 * @returns {string}
 */
export function resolveSecrets(value, apiKeys = []) {
    if (typeof value !== 'string') return value;
    return value.replace(/\{\{([^}]+)\}\}/g, (match, varName) => {
        const key = varName.trim();
        const entry = apiKeys.find(k => k.name === key);
        if (entry) return entry.value ?? '';
        // Fallback: tentar process.env
        if (process.env[key] !== undefined) return process.env[key];
        return match; // mantém o placeholder se não encontrar
    });
}

/**
 * Resolve {{VAR_NAME}} recursivamente em um objeto ou array.
 * Strings são interpoladas, outros tipos passam sem alteração.
 * @param {any} obj
 * @param {Array<{name: string, value: string}>} apiKeys
 * @returns {any}
 */
export function resolveSecretsInObject(obj, apiKeys = []) {
    if (typeof obj === 'string') return resolveSecrets(obj, apiKeys);
    if (Array.isArray(obj)) return obj.map(item => resolveSecretsInObject(item, apiKeys));
    if (obj !== null && typeof obj === 'object') {
        const result = {};
        for (const [k, v] of Object.entries(obj)) {
            result[k] = resolveSecretsInObject(v, apiKeys);
        }
        return result;
    }
    return obj;
}
