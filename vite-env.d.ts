/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_APP_BASE_PATH?: string;
  readonly VITE_APP_STORAGE_NAMESPACE?: string;
  readonly VITE_APP_INSTANCE_SLUG?: string;
  readonly VITE_SYSTEM_AGENT_ID?: string;
  readonly VITE_APP_LOG_PREFIX?: string;
  readonly VITE_APP_DISPLAY_NAME?: string;
  readonly VITE_SYSTEM_AGENT_LABEL?: string;
  readonly VITE_DEV_SERVER_TARGET?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
