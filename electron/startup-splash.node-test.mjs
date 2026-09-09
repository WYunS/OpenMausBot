import assert from "node:assert/strict";
import test from "node:test";

import splash from "./startup-splash.cjs";

test("startup splash is branded, animated, and accessible", () => {
  const url = splash.startupSplashDataUrl();
  assert.match(url, /^data:text\/html;charset=utf-8,/);
  const html = decodeURIComponent(url.slice(url.indexOf(",") + 1));
  assert.match(html, /<title>锐捷Bot 正在启动<\/title>/);
  assert.match(html, /role="status"/);
  assert.match(html, /正在启动锐捷Bot/);
  assert.match(html, />RJ</);
  assert.doesNotMatch(html, />锐</);
  assert.match(html, /color:\s*#fff/);
  assert.match(html, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(html, /animation:/);
});
