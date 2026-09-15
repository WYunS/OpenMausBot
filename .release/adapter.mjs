import assert from 'node:assert/strict';
import {spawnSync,execFileSync} from 'node:child_process';
import {readFile,mkdir,mkdtemp,cp,readdir} from 'node:fs/promises';
import {createReadStream} from 'node:fs';
import {createHash} from 'node:crypto';
import {tmpdir} from 'node:os';
import path from 'node:path';
const repository='AI-Applications-Team/OpenMausBot';
const commonEnv={OMB_ENTERPRISE_TEST_BUILD:'1',OMB_EXPECTED_UPDATE_OWNER:'AI-Applications-Team',OMB_EXPECTED_UPDATE_REPO:'OpenMausBot'};
function run(command,args,env={}) {
  const result=spawnSync(command,args,{stdio:'inherit',shell:process.platform==='win32'&&command==='corepack',windowsHide:true,env:{...process.env,...commonEnv,...env}});
  if(result.error)throw result.error;
  assert.equal(result.status,0,`${command} ${args.join(' ')} failed`);
}
const pnpm=(args,env)=>run('corepack',['pnpm',...args],env);
const node=(args,env)=>run(process.execPath,args,env);
export async function preflight(ctx) {
  const blockers=[];
  assert.equal(process.env.GITHUB_REPOSITORY || repository,repository,'Use the enterprise repository');
  for(const file of ['electron-builder.enterprise.mjs','scripts/package-enterprise-macos.mjs','scripts/enterprise-macos-sign.mjs','scripts/smoke-feishu-package.mjs']) {
    try {await readFile(file);}catch{blockers.push(`Missing release integration: ${file}`);}
  }
  const files=execFileSync('git',['ls-files','-z'],{encoding:'utf8',windowsHide:true}).split('\0');
  assert(!files.some(f=>/^release-inputs\//.test(f)),'Private handoff inputs must not enter this repository-only release');
  const pkg=JSON.parse(await readFile('package.json','utf8'));
  assert.equal(pkg.packageManager,'pnpm@10.33.0');
  assert(!pkg.scripts['package:mac'].includes('build:sandbox')&&!pkg.scripts['package:win'].includes('build:sandbox'),'Standard packaging must not require a sandbox preset');
  if(ctx.config.targets.includes('windows-x64')) {
    const pin=JSON.parse(await readFile('.release/windows-browser.json','utf8'));
    const response=await fetch(pin.url,{method:'HEAD',signal:AbortSignal.timeout(30000)});
    if(!response.ok)blockers.push(`Repository-approved Windows vendor is unavailable: HTTP ${response.status}`);
  }
  return {blockers,notes:['Enterprise internal test build; no credentials or sandbox preset are injected.','Keeps the repository default for new bots: this computer.','Production human acceptance remains separate; no passing receipts are fabricated.','macOS is ad-hoc signed, not notarized; Windows is unsigned.']};
}
export async function prepareFiles(ctx) {
  return [{path:'build/enterprise-release.json',content:JSON.stringify({schemaVersion:1,version:ctx.version,sourceSha:ctx.sourceSha,repository,workflowRun:process.env.GITHUB_RUN_ID,distribution:'enterprise-internal-test',sandboxPreset:'absent',humanAcceptance:'not-run',defaultComputer:'local',signing:{windows:'unsigned',macos:'ad-hoc signed, not notarized'},macLayout:'Universal Electron/helpers and shared native binaries; separate pinned browser and Feishu architecture trees'},null,2)+'\n'}];
}
export async function install(){pnpm(['install','--frozen-lockfile']);}
export async function build(ctx) {
  const env={};
  if(ctx.target==='windows-x64'){node(['.release/fetch-windows-browser.mjs']);env.OMB_BROWSER_VENDOR_DIR=path.join(ctx.root,'dist-native/browser-vendor');}
  node(['--test','electron/enterprise-package.node-test.mjs','electron/desktop-runtime-layout.node-test.mjs','electron/ruijie-sandbox-bootstrap.node-test.mjs']);
  pnpm(['exec','vitest','run','server/browser-bundle-universal.test.ts','server/store.test.ts']);
  pnpm(['package:prepare'],env);
  if(ctx.target==='windows-x64') {
    pnpm(['build:cua:windows']);pnpm(['build:feishu:windows']);node(['scripts/desktop-build-receipt.mjs','--write']);
    pnpm(['exec','electron-builder','--config','electron-builder.enterprise.mjs','--win','--x64','--publish','never']);
  } else if(ctx.target==='linux-x64') {
    pnpm(['build:cua:linux']);node(['scripts/desktop-build-receipt.mjs','--write']);pnpm(['smoke:cua-x11-input']);
    pnpm(['exec','electron-builder','--config','electron-builder.enterprise.mjs','--linux','--x64','--publish','never']);
    node(['scripts/verify-linux-package.mjs']);
  } else {
    assert.equal(process.platform,'darwin');assert.equal(process.arch,'arm64');
    pnpm(['build:speech']);pnpm(['build:cua']);pnpm(['build:feishu:mac']);node(['scripts/desktop-build-receipt.mjs','--write']);
    pnpm(['exec','electron-builder','--config','electron-builder.enterprise.mjs','--mac','dir','--arm64','--x64','--publish','never']);
    node(['scripts/package-enterprise-macos.mjs']);
  }
}
export async function assets(ctx) {
  const files=await readdir('release');
  const suffixes=ctx.target==='macos-universal'?['-mac-universal.dmg']:ctx.target==='windows-x64'?['-setup.exe']:['.AppImage','.deb'];
  return suffixes.map(suffix=>{
    const matches=files.filter(name=>name.includes(ctx.version)&&name.endsWith(suffix));
    assert.equal(matches.length,1,`Expected one versioned ${suffix} asset`);
    return {path:`release/${matches[0]}`};
  });
}
async function smoke(resources,arch) {
  node(['scripts/check-enterprise-package.mjs',resources]);
  if(process.platform!=='linux')node(['scripts/smoke-feishu-package.mjs',resources]);
  node(['scripts/smoke-browser-bundle.mjs','--resources',resources]);
  const browser=path.join(resources,'browser-engine',...(process.platform==='darwin'?[`darwin-${arch}`]:[]));
  node(['scripts/smoke-packaged-server.mjs','--browser-default-enabled','--browser-bundle',browser],{OMB_SMOKE_DIST:path.join(resources,'server')});
  if(process.platform==='darwin')run(path.resolve(resources,'../MacOS/OpenMausBot'),['-e',`if(process.arch!==${JSON.stringify(arch)})process.exit(1);console.log(process.arch)`],{ELECTRON_RUN_AS_NODE:'1'});
}
export async function verify(ctx) {
  await mkdir(path.join(ctx.out,'evidence'),{recursive:true});
  if(ctx.target==='linux-x64')run('bash',['.release/verify-linux.sh']);
  else {
    await smoke(path.join(ctx.root,ctx.target==='windows-x64'?'release/win-unpacked/resources':'release/mac-universal/OpenMausBot.app/Contents/Resources'),'arm64');
    if(ctx.target==='windows-x64')run('pwsh',['-NoProfile','-File','.release/verify-windows.ps1','-Version',ctx.version]);
  }
  for(const file of await readdir('release'))if(/^macos.*audit/.test(file))await cp(path.join('release',file),path.join(ctx.out,'evidence',file));
}
export async function verifyIntel(ctx) {
  assert.equal(process.platform,'darwin');assert.equal(process.arch,'x64');
  await mkdir(path.join(ctx.out,'evidence'),{recursive:true});
  const input=path.join(ctx.out,'intel-input');
  const manifest=JSON.parse(await readFile(path.join(input,'macos-universal.json'),'utf8'));
  for(const key of ['sourceSha','version','toolkitSha'])assert.equal(manifest[key],ctx[key]);
  assert.equal(manifest.automatedVerification,'passed');
  const name=`RuijieBot-${ctx.version}-mac-universal.dmg`;
  const asset=manifest.assets.find(a=>a.name===name);assert(asset,'Missing Universal DMG');
  const hash=createHash('sha256');for await(const chunk of createReadStream(path.join(input,name)))hash.update(chunk);
  assert.equal(hash.digest('hex'),asset.sha256,'Intel must test the identical DMG');
  const temp=await mkdtemp(path.join(tmpdir(),'ruijiebot-intel-'));const mount=path.join(temp,'mount');await mkdir(mount);
  run('hdiutil',['attach',path.join(input,name),'-mountpoint',mount,'-nobrowse','-readonly']);
  try {const app=path.join(mount,'OpenMausBot.app');node(['scripts/enterprise-macos-sign.mjs',app,path.join(ctx.out,'evidence','mac-intel-signatures.json')]);await smoke(path.join(app,'Contents/Resources'),'x64');}
  finally {run('hdiutil',['detach',mount]);}
}
