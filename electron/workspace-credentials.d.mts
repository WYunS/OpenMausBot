import type { AppConfig } from "../server/config.ts";

export type WorkspaceCredentialSyncMessage = {
  type: "openmausbot:workspace-credentials";
  credentials: Record<string, string>;
  sandboxManagerUrl?: string;
};

export function applyWorkspaceCredentialSyncMessage(
  raw: unknown,
  state: { target: AppConfig; environment: NodeJS.ProcessEnv },
): boolean;
