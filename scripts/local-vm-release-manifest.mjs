export function validateReleaseManifest(manifest, source) {
  const apps = Array.isArray(manifest?.enterpriseApps) ? new Set(manifest.enterpriseApps) : new Set();
  if (!apps.has("feishu") || !apps.has("feilian")) {
    throw new Error(`Local VM release manifest must include reviewed Feishu and Feilian packages: ${source}`);
  }
}
