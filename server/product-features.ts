/** Release gates shared by the renderer and server. This local Ruijie build
 * ships the persistent sandbox integration as its primary cloud computer. */
export const RUIJIE_SANDBOX_ENABLED = true;
export const DEFAULT_CLOUD_BACKEND = "ruijie-sandbox" as const;

export const RUIJIE_SANDBOX_UNAVAILABLE_MESSAGE = "Ruijie sandbox is temporarily unavailable";
