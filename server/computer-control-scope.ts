import type { BotRecord } from "./store.ts";
import { DEFAULT_CLOUD_BACKEND } from "./product-features.ts";

export const RUIJIE_COMPUTER_CONTROL_SCOPE = "provider:ruijie-sandbox";

/** Human control follows the physical desktop, not the chat identity. */
export function computerControlScope(bot: Pick<BotRecord, "id" | "computer" | "cloudBackend">): string {
  return bot.computer === "cloud" && (bot.cloudBackend ?? DEFAULT_CLOUD_BACKEND) === "ruijie-sandbox"
    ? RUIJIE_COMPUTER_CONTROL_SCOPE
    : `bot:${bot.id}`;
}

export function botIdFromComputerControlScope(scope: string): string | null {
  return scope.startsWith("bot:") ? scope.slice(4) : null;
}
