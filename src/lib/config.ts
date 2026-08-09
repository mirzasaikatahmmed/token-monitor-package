import type { AgentConfig } from './python.js';
import { writeEncryptedConfig, loadAgentConfig } from './python.js';

export type { AgentConfig };

/** Merge partial updates into existing encrypted config and save. */
export function updateConfig(partial: Partial<AgentConfig>): AgentConfig {
  let current: AgentConfig;
  try {
    current = loadAgentConfig();
  } catch {
    current = {
      backendUrl: 'http://localhost:3001',
      agentToken: '',
      deviceId: '',
      hostname: '',
      pushIntervalSeconds: 30,
    };
  }
  const next: AgentConfig = {
    ...current,
    ...partial,
    pushIntervalSeconds:
      partial.pushIntervalSeconds ?? current.pushIntervalSeconds ?? 30,
  };
  writeEncryptedConfig(next);
  return next;
}
