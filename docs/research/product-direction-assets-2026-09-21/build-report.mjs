import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { micromark } from '../../../node_modules/.pnpm/micromark@4.0.2/node_modules/micromark/index.js';
import { gfm, gfmHtml } from '../../../node_modules/.pnpm/micromark-extension-gfm@3.0.0/node_modules/micromark-extension-gfm/index.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const notes = path.dirname(here);
const title = '锐捷 Bot：持续任务助手的产品形态与架构决策';
const mainFile = 'ruijie-bot-product-direction-2026-09-21.md';
const evidence = [
  ['grokbot-product-evidence-2026-09-21.md', 'evidence-product', '对标证据：Grok Bot 的公开承诺与闭源边界'],
  ['runtime-choice-evidence-2026-09-21.md', 'evidence-runtime', '源码证据：Harness 与 Codex 的接入差异和验收门槛'],
];
const escapeHtml = s => s.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;');
function render(markdown) {
  return micromark(markdown, { extensions: [gfm()], htmlExtensions: [gfmHtml()] })
    .replace(/<table>/g, '<div class="table-scroll" tabindex="0" role="region" aria-label="比较与决策表"><table>')
    .replace(/<\/table>/g, '</table></div>')
    .replace(/href="([^"]+)"/g, (all, raw) => {
      if (/^(?:https?:|#)/.test(raw)) return all;
      const embedded = evidence.find(([f]) => raw === f);
      if (embedded) return `href="#${embedded[1]}"`;
      const [target, fragment] = raw.split('#');
      const url = pathToFileURL(path.resolve(notes, target)).href + (fragment ? '#' + fragment : '');
      return `href="${escapeHtml(url)}"`;
    });
}
const diagram = `<figure class="architecture" aria-label="建议架构：桌面入口连接持久工作区，任务执行器调用模型，并操作云环境或授权本机。职责分开，初期可同机部署。">
  <figcaption><span>建议架构</span><strong>任务归属稳定，执行环境可替换</strong></figcaption>
  <div class="entry"><b>桌面入口</b><span>交代任务 · 查询进度 · 批准与接管</span></div>
  <div class="arrow" aria-hidden="true">↓</div>
  <div class="workspace"><div class="workspace-label">托管工作区 · 后台与执行器初期可同机部署</div>
    <div class="workspace-core"><div class="record"><b>持久任务记录与调度</b><span>身份 / 约定 / 当前状态 / 结果</span></div><div class="arrow" aria-hidden="true">↓</div>
    <div class="engine"><b>任务执行器 · Harness</b><span>每项任务有独立会话、权限和执行记录</span></div></div>
    <div class="model"><span class="exchange">↔</span><b>获准的模型服务</b><span>按产品策略调用<br>不等于在本机安装模型权重</span></div>
  </div>
  <div class="target-arrows" aria-hidden="true">↙<span>按任务与授权选择</span>↘</div>
  <div class="targets"><div><b>云执行环境</b><span>应用 · 浏览器 · 文件<br>可更新、恢复与替换</span></div><div><b>授权本机连接 → 办公电脑</b><span>读取 · 操作 · 停止 · 撤权<br>离线时相关步骤等待</span></div></div>
  <p class="diagram-note">动作结果回到任务记录。同机部署不消除整机故障；独立本地任务由本地工作区负责，不自动接管托管任务。</p>
</figure>`;

let body = render(await fs.readFile(path.join(notes, mainFile), 'utf8'));
body = body.replace(/<pre><code class="language-mermaid">[\s\S]*?<\/code><\/pre>/, diagram);
body = body.replace(/<h1>[\s\S]*?<\/h1>/, '');
const ids = ['decision', 'promise', 'hosting', 'assistant', 'runtime', 'journeys', 'benchmark', 'delivery', 'gates', 'sources'];
const shortNames = ['建议决策', '产品承诺', '任务托管位置', '一个助手如何统一', '本机封装与引擎', '六条用户旅程', '对标事实与推断', '源码与研发工作包', '阶段评审与指标', '依据索引'];
let section = 0;
body = body.replace(/<h2>([\s\S]*?)<\/h2>/g, (_, name) => {
  const current = section++;
  return `${current ? '</section>' : ''}<section id="${ids[current]}"><h2>${name}</h2>`;
}) + '</section>';
body = body.replace(/<h3>(J([1-6])[^<]*)<\/h3>/g, (_, name, index) => `<h3 id="journey-${index}">${name}</h3>`);
const appendices = [];
for (const [file, id, label] of evidence) {
  const rendered = render(await fs.readFile(path.join(notes, file), 'utf8')).replace(/<h1>(.*?)<\/h1>/g, '<h3>$1</h3>');
  appendices.push(`<details class="evidence" id="${id}"><summary>${label}</summary><div class="evidence-body">${rendered}</div></details>`);
}
const nav = ids.map((id, i) => `<a href="#${id}"><span>${String(i + 1).padStart(2, '0')}</span>${shortNames[i]}</a>`).join('');
const html = `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${title}</title>
<style>
:root{--ink:#182d37;--muted:#5c7079;--accent:#17675d;--line:#d9e2e3;--paper:#fff;--wash:#f3f6f5;--tint:#eaf3ef;--warm:#faf7ef}
*{box-sizing:border-box}html{scroll-behavior:smooth;scroll-padding-top:35px}body{margin:0;background:var(--wash);color:var(--ink);font-family:"Segoe UI","Microsoft YaHei","PingFang SC",sans-serif;font-size:16px;line-height:1.85}a{color:var(--accent);text-underline-offset:3px;overflow-wrap:anywhere}button{font:inherit;cursor:pointer;border:1px solid var(--line);border-radius:6px;background:var(--paper);color:var(--ink);padding:7px 14px}button:hover{border-color:var(--accent)}a:focus-visible,button:focus-visible,summary:focus-visible,.table-scroll:focus-visible{outline:3px solid #83bba9;outline-offset:4px}
.layout{display:grid;grid-template-columns:240px minmax(0,1040px);max-width:1390px;margin:0 auto;gap:42px;padding:45px 35px 90px}.sidebar{position:sticky;top:28px;height:calc(100vh - 56px);overflow:auto;font-size:13px}.brand{letter-spacing:2px;font-weight:700;font-size:12px;color:var(--accent);padding:0 10px 12px}.sidebar .subtitle{padding:0 10px 20px;color:var(--muted)}nav a{display:flex;gap:12px;text-decoration:none;padding:10px;border-left:2px solid transparent;line-height:1.45;margin:4px 0;color:var(--muted)}nav a span{font-variant-numeric:tabular-nums;font-size:11px;opacity:.7;padding-top:2px}nav a:hover,nav a.active{background:var(--tint);color:var(--accent);border-color:var(--accent)}.side-actions{padding:20px 10px;border-top:1px solid var(--line);margin-top:20px}.side-actions p{font-size:12px;color:var(--muted)}.main{min-width:0}.hero{padding:25px 0 32px;border-bottom:2px solid var(--ink);margin-bottom:32px}.eyebrow{font-size:12px;letter-spacing:2px;color:var(--accent);font-weight:700}.hero h1{font-size:38px;line-height:1.4;letter-spacing:-.8px;margin:16px 0}.hero .lede{font-size:19px;line-height:1.8;color:var(--muted);max-width:840px}.decision-strip{display:grid;grid-template-columns:repeat(3,1fr);gap:1px;background:var(--line);border:1px solid var(--line);margin-top:26px}.decision-strip>div{padding:15px 18px;background:var(--paper)}.decision-strip small{display:block;color:var(--muted);font-size:12px;margin-bottom:3px}.decision-strip strong{font-size:15px}.document{background:var(--paper);padding:34px 42px 44px;border:1px solid var(--line)}p{margin:0 0 19px}strong{font-weight:650}section{padding-top:8px;margin-top:30px}section:first-of-type{margin-top:18px}h2{font-size:24px;line-height:1.55;padding-top:26px;border-top:1px solid var(--line);margin:0 0 25px;letter-spacing:-.4px}h3{font-size:19px;line-height:1.6;margin:29px 0 16px}ul,ol{padding-left:24px;margin:16px 0 24px}li{margin:9px 0}code{font-family:Consolas,monospace;font-size:.88em;background:var(--wash);border-radius:3px;padding:2px 4px;overflow-wrap:anywhere}.table-scroll{overflow:auto;margin:22px 0 27px;border:1px solid var(--line);border-radius:5px}table{border-collapse:collapse;min-width:640px;width:100%;font-size:14px;line-height:1.75}th{background:var(--tint);color:var(--accent);font-weight:650;text-align:left}td,th{padding:13px 14px;border-bottom:1px solid var(--line);vertical-align:top;min-width:105px}tr:last-child td{border-bottom:0}td:first-child{font-weight:550}tbody tr:nth-child(even){background:#fafcfa}blockquote{border-left:3px solid #91b6a5;background:var(--wash);margin:20px 0;padding:16px 20px;color:var(--muted)}blockquote p:last-child{margin:0}
.architecture{margin:28px 0;background:#f7faf8;border:1px solid #c4d9cf;border-radius:8px;padding:24px;line-height:1.6}.architecture figcaption{display:flex;gap:18px;align-items:baseline;margin-bottom:20px}.architecture figcaption span{font-size:12px;color:var(--accent)}.architecture figcaption strong{font-size:18px}.architecture b,.architecture span{display:block}.architecture .entry{border:1px solid #bdd0c7;border-radius:5px;text-align:center;background:#fff;padding:12px}.architecture .entry span,.architecture .targets span,.architecture .workspace span{font-size:12px;color:var(--muted);margin-top:5px}.architecture .arrow{text-align:center;color:var(--accent);line-height:1.4;font-size:22px;padding:4px}.workspace{border:1px solid #93b7a7;border-radius:6px;padding:16px;display:grid;grid-template-columns:1.7fr 1fr;gap:0 22px;background:#eaf3ef}.workspace-label{grid-column:1/-1;font-size:12px;color:var(--accent);margin-bottom:15px}.workspace-core{text-align:center}.record,.engine{background:#fff;border:1px solid #bfd2c9;border-radius:5px;padding:12px}.model{align-self:center;text-align:center;border:1px dashed #a8beb3;padding:13px;border-radius:5px;font-size:14px}.model .exchange{font-size:22px!important;color:var(--accent)!important}.target-arrows{display:flex;align-items:center;justify-content:space-around;font-size:25px;color:var(--accent);padding:6px}.target-arrows span{font-size:12px}.targets{display:grid;grid-template-columns:1fr 1fr;gap:20px;text-align:center}.targets>div{border:1px solid #c9d6d0;padding:14px;border-radius:5px;background:#fff;font-size:14px}.architecture .diagram-note{font-size:12px;color:var(--muted);margin:18px 0 0;border-top:1px solid #d8e3dc;padding-top:13px}
.evidence{margin-top:18px;border:1px solid var(--line);border-radius:5px;background:var(--paper)}.evidence summary{padding:18px 22px;cursor:pointer;font-weight:650;font-size:15px}.evidence-body{border-top:1px solid var(--line);padding:22px 30px;font-size:14px}.evidence-body h2{font-size:20px}.evidence-body h3{font-size:18px}.evidence-body table{font-size:13px}.endnote{font-size:12px;color:var(--muted);margin-top:25px}.mobile-top{display:none}
@media(min-width:1500px){.layout{padding-top:55px}}@media(max-width:1100px){.layout{grid-template-columns:185px minmax(0,1fr);gap:23px;padding:25px 22px}.document{padding:25px}.hero h1{font-size:31px}.decision-strip strong{font-size:14px}.decision-strip>div{padding:12px}}
@media(max-width:760px){body{font-size:15px}.layout{display:block;padding:20px 14px 45px}.sidebar{position:static;height:auto;overflow:visible}.brand{padding:0}.sidebar .subtitle,.side-actions{display:none}nav{display:flex;overflow:auto;gap:5px;padding:8px 0 13px}nav a{white-space:nowrap;padding:7px 10px;border:1px solid var(--line);border-radius:4px;font-size:12px}nav a span{display:none}.hero{padding:12px 3px 24px;margin-bottom:20px}.hero h1{font-size:27px;letter-spacing:0}.hero .lede{font-size:16px}.eyebrow{font-size:10px}.document{padding:21px 17px}.decision-strip{grid-template-columns:1fr;gap:1px}.decision-strip>div{display:flex;justify-content:space-between;gap:15px}.decision-strip small{margin:0}.decision-strip strong{font-size:13px}h2{font-size:21px}h3{font-size:18px}.architecture{padding:14px}.architecture figcaption{display:block}.architecture figcaption strong{font-size:16px;margin-top:5px}.workspace{grid-template-columns:1fr;gap:12px;padding:12px}.model{font-size:13px}.model .exchange{display:none}.targets{gap:10px}.targets>div{padding:10px;font-size:13px}.evidence-body{padding:15px}.mobile-top{display:block;text-align:right;font-size:12px;margin:15px 0}}
@media print{body{background:#fff;font-size:11pt;line-height:1.65}.layout{display:block;padding:0;max-width:none}.sidebar,.mobile-top{display:none}.hero{padding:0 0 15px}.hero h1{font-size:25pt}.hero .lede{font-size:12pt}.document{border:0;padding:0}.decision-strip{break-inside:avoid}section{margin-top:20px}h2,h3{break-after:avoid}h2{font-size:17pt}h3{font-size:13pt}table{font-size:9pt;min-width:0;table-layout:fixed}td,th{min-width:0;padding:7px;overflow-wrap:anywhere}tr{break-inside:avoid}.table-scroll{overflow:visible;border-radius:0}p,li{orphans:3;widows:3}.architecture{break-inside:avoid}.evidence:not([open]){display:none}a{color:inherit}nav{display:none}@page{margin:17mm}}
@media(prefers-reduced-motion:reduce){html{scroll-behavior:auto}}
</style></head><body id="top"><div class="layout">
<aside class="sidebar"><div class="brand">锐捷 BOT · 产品方向</div><div class="subtitle">2026.09.21 / 评审稿<br>产品承诺 → 架构 → 验证</div><nav aria-label="章节目录">${nav}</nav><div class="side-actions"><button id="print">打印 / 保存 PDF</button><p>先看建议决策，再按议题阅读。详细核验资料在文末，可展开查看。</p></div></aside>
<main class="main"><header class="hero"><div class="eyebrow">产品形态探索 / 决策依据 / 建设路径</div><h1>持续任务助手<br>产品形态与架构决策</h1><p class="lede">用户交代目标后，助手记住约定、选择工作环境、持续推进，并把结果或阻碍交代清楚。</p><div class="decision-strip"><div><small>建议路线</small><strong>托管工作区＋可替换执行环境</strong></div><div><small>首版部署</small><strong>职责分开，可以同机</strong></div><div><small>引擎判断</small><strong>Harness 优先验证，可被否决</strong></div></div></header>
<article class="document">${body}</article>
<div class="endnote">以下为随评审稿附带的核验资料。产品事实、源码事实、设计建议和未验证事项分别说明。</div>${appendices.join('\n')}
<p class="endnote">本阅读版由同目录 Markdown 评审稿生成。只整理方案与依据，未改变应用实现。HTML 无需联网即可阅读；源码链接指向本机核查目录。</p><a class="mobile-top" href="#top">返回开头 ↑</a></main></div>
<script>
document.getElementById('print').addEventListener('click',()=>window.print());
document.addEventListener('click',event=>{const a=event.target.closest('a[href^="#"]');if(!a)return;const target=document.getElementById(a.getAttribute('href').slice(1));if(target?.tagName==='DETAILS')target.open=true;});
const observer=new IntersectionObserver(entries=>{for(const entry of entries){if(entry.isIntersecting){document.querySelectorAll('nav a').forEach(a=>a.classList.toggle('active',a.getAttribute('href')==='#'+entry.target.id));}}},{rootMargin:'-5% 0px -70% 0px'});document.querySelectorAll('article section[id]').forEach(s=>observer.observe(s));
</script></body></html>`;
const output = path.join(notes, 'ruijie-bot-product-direction-2026-09-21.html');
await fs.writeFile(output, html, 'utf8');
console.log(JSON.stringify({ output, sections: section, characters: html.length, embeddedEvidence: evidence.length }));
