// =============================================================================
// useSettingsForm.ts — estado local e fetch-on-open do SettingsModal
// =============================================================================

import { useState, useEffect } from 'react';
import { ModelConfig, ApiKey, MemoryConfig, SummaryConfig } from '../types';

const normalizeModelConfig = (model: any): ModelConfig | null => {
  if (!model || typeof model !== 'object') {
    return null;
  }
  const provider = String(model.provider || '').trim();
  const modelId = String(model.modelId || model.id || model.name || '').trim();
  if (!provider || !modelId) {
    return null;
  }
  return {
    ...model,
    id: String(model.id || `${provider}:${modelId}`),
    name: String(model.name || modelId),
    provider: provider as ModelConfig['provider'],
    modelId,
  };
};

const normalizeModelConfigs = (models: any[]): ModelConfig[] => {
  const seen = new Set<string>();
  const normalized: ModelConfig[] = [];
  for (const raw of Array.isArray(models) ? models : []) {
    const model = normalizeModelConfig(raw);
    if (!model) continue;
    const key = `${model.provider}:${model.modelId}`;
    if (seen.has(key)) {
      continue;
    }
    seen.add(key);
    normalized.push(model);
  }
  return normalized;
};

interface UseSettingsFormOptions {
  username: string;
  currentHost: string;
  models: ModelConfig[];
  guidelines: string;
  apiKeys: ApiKey[];
  memoryConfig: MemoryConfig;
  summaryConfig: SummaryConfig;
  timezone?: string;
  displayName?: string;
}

const DEFAULT_SUMMARY_CONFIG: SummaryConfig = {
  summaryAgentId: 'summary-agent',
  tokenLimit: 8000,
  windowSize: 20,
  summaryMaxChars: 1600,
};

export const useSettingsForm = ({
  username, currentHost, models, guidelines, apiKeys, memoryConfig, summaryConfig, timezone: tzProp, displayName: displayNameProp,
}: UseSettingsFormOptions) => {
  const [activeTab, setActiveTab] = useState<string>('general');
  const [host, setHost] = useState<string>(currentHost);
  const [localGuidelines, setLocalGuidelines] = useState<string>(guidelines);
  const [localModels, setLocalModels] = useState<ModelConfig[]>(models);
  const [localApiKeys, setLocalApiKeys] = useState<ApiKey[]>(apiKeys);
  const [localMemoryConfig, setLocalMemoryConfig] = useState<MemoryConfig>(memoryConfig);
  const [localSummaryConfig, setLocalSummaryConfig] = useState<SummaryConfig>({ ...DEFAULT_SUMMARY_CONFIG, ...summaryConfig });
  const [localTimezone, setLocalTimezone] = useState<string>(tzProp || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [localDisplayName, setLocalDisplayName] = useState<string>(displayNameProp || '');
  const [editingPayloadModelId, setEditingPayloadModelId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [revealedKeys, setRevealedKeys] = useState<Set<string>>(new Set());

  useEffect(() => {
    setIsLoading(true);
    const normalizedModels = normalizeModelConfigs(Array.isArray(models) ? models : []);
    setHost(currentHost);
    setLocalModels(normalizedModels);
    setLocalGuidelines(guidelines);
    setLocalApiKeys(apiKeys);
    setLocalMemoryConfig({ maintenanceAgentId: 'memory-maintenance-agent', ...memoryConfig });
    setLocalSummaryConfig({ ...DEFAULT_SUMMARY_CONFIG, ...summaryConfig });
    setLocalTimezone(tzProp || Intl.DateTimeFormat().resolvedOptions().timeZone);
    setLocalDisplayName(displayNameProp || '');
    setIsLoading(false);
  }, [username, currentHost, models, guidelines, apiKeys, memoryConfig, summaryConfig, tzProp, displayNameProp]);

  const handleRateLimitChange = (id: string, key: 'rpm' | 'tpm' | 'rpd', value: string) => {
    const numValue = parseInt(value) || 0;
    setLocalModels(prev => prev.map(c => c.id === id
      ? { ...c, rateLimits: { ...(c.rateLimits || { rpm: 0, tpm: 0, rpd: 0 }), [key]: numValue } }
      : c));
  };

  const updateModelField = (id: string, field: keyof ModelConfig, value: any) => {
    setLocalModels(prev => prev.map(m => m.id === id ? { ...m, [field]: value } : m));
  };

  const addApiKey = () => {
    setLocalApiKeys([...localApiKeys, { id: Date.now().toString(), name: 'NEW_VAR', value: '', created: Date.now() }]);
  };

  const removeApiKey = (id: string) => {
    setLocalApiKeys(localApiKeys.filter(k => k.id !== id));
  };

  const toggleReveal = (id: string) => {
    setRevealedKeys(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  return {
    activeTab, setActiveTab,
    host, setHost,
    localGuidelines, setLocalGuidelines,
    localModels, setLocalModels,
    localApiKeys, setLocalApiKeys,
    localMemoryConfig, setLocalMemoryConfig,
    localSummaryConfig, setLocalSummaryConfig,
    localTimezone, setLocalTimezone,
    localDisplayName, setLocalDisplayName,
    editingPayloadModelId, setEditingPayloadModelId,
    isLoading,
    revealedKeys,
    handleRateLimitChange,
    updateModelField,
    addApiKey,
    removeApiKey,
    toggleReveal,
  };
};
