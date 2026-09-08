import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  BASE_IMAGE_DIGEST,
  CUA_DRIVER_VERSION,
  IMAGE_LAYER_VERSION,
} from "../server/container-computer.ts";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const containerfile = await readFile(path.join(root, "vm-image", "Containerfile"), "utf8");
for (const expected of [
  BASE_IMAGE_DIGEST,
  `ARG CUA_DRIVER_VERSION=${CUA_DRIVER_VERSION}`,
  `ARG IMAGE_LAYER_VERSION=${IMAGE_LAYER_VERSION}`,
  "zh_CN.UTF-8",
  "fonts-noto-cjk",
  "fonts-noto-color-emoji",
  "ibus-libpinyin",
  "xfce4-panel.mo",
  "thunar.mo",
  "com.openmausbot.local-vm=\"1\"",
  "COPY prepare-workspace.sh",
  "COPY start-cua-driver.sh",
  "DefaultSearchProviderName",
  "https://www.bing.com/search?q={searchTerms}",
  "COPY vendor/",
  "REQUIRE_ENTERPRISE_APPS",
  "FEISHU_DEB_SHA256",
  "FEILIAN_DEB_SHA256",
]) assert.ok(containerfile.includes(expected), `Containerfile is missing ${expected}`);

console.log("Local VM image source is synchronized with runtime constants.");
