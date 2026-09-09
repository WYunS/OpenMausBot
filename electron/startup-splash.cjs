"use strict";

function startupSplashDataUrl() {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>锐捷Bot 正在启动</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, "Segoe UI", "Microsoft YaHei", sans-serif; }
    * { box-sizing: border-box; }
    html, body { width: 100%; height: 100%; margin: 0; }
    body {
      display: grid; place-items: center; overflow: hidden; color: #f5f3f2;
      background: radial-gradient(circle at 50% 44%, rgba(191, 59, 49, .11), transparent 30%), #070707;
    }
    .startup { display: grid; justify-items: center; gap: 26px; transform: translateY(-2vh); }
    .mark { position: relative; display: grid; width: 104px; height: 104px; place-items: center; }
    .orbit {
      position: absolute; inset: 0; border: 1px solid rgba(255, 255, 255, .1);
      border-top-color: #d65349; border-right-color: rgba(191, 59, 49, .32); border-radius: 50%;
      animation: orbit 1.15s cubic-bezier(.55, .1, .45, .9) infinite;
    }
    .brand {
      display: grid; width: 72px; height: 72px; place-items: center;
      border: 1px solid rgba(255, 255, 255, .13); border-radius: 22px;
      color: #fff; background: rgba(255, 255, 255, .035);
      font-family: Arial, "Segoe UI", sans-serif; font-size: 29px; font-weight: 750;
      letter-spacing: -.055em; text-indent: -.055em; box-shadow: 0 18px 48px rgba(0, 0, 0, .38);
    }
    .copy { text-align: center; }
    .title { margin: 0; font-size: 18px; font-weight: 600; letter-spacing: .015em; }
    .hint { margin: 9px 0 0; color: #999491; font-size: 14px; }
    @keyframes orbit { to { transform: rotate(360deg); } }
    @media (prefers-reduced-motion: reduce) {
      .orbit { animation: none; border-color: rgba(191, 59, 49, .55); }
    }
  </style>
</head>
<body>
  <main class="startup" role="status" aria-live="polite">
    <div class="mark" aria-hidden="true"><div class="orbit"></div><div class="brand">RJ</div></div>
    <div class="copy"><p class="title">正在启动锐捷Bot</p><p class="hint">正在准备工作区…</p></div>
  </main>
</body>
</html>`;
  return `data:text/html;charset=utf-8,${encodeURIComponent(html)}`;
}

module.exports = { startupSplashDataUrl };
