// Resolve boot exports and load the telemetry dependency that failed after NSIS
// silently dropped its nested machine-id module on long Windows install paths.
// from an empty home/cwd. No account, model request, or developer NODE_PATH.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, mkdir, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { verifyRuijieHarnessBundle } from './prepare-ruijie-harness.mjs';

export const BOOT_EXPORTS = [
  'dsh-plugin-desktop/profile', 'dsh-plugin-desktop/client', 'dsh-plugin-desktop/terminal',
  'dsh-plugin-desktop/pnpm', 'dsh-plugin-desktop/profile-service', 'dsh-plugin-desktop/profiles',
  'dsh-plugin-desktop/diagnostics', 'dsh-plugin-desktop/updates', 'dsh-plugin-desktop/search-recovery',
  '@deepseek-ai/dsh/package.json', '@deepseek-ai/dsh-base/package.json',
  '@deepseek-ai/dsh-time-context/package.json', '@deepseek-ai/dsh-web-app/package.json',
  '@xmanrui/dsh-im/package.json', 'https-proxy-agent/package.json',
  '@huanlin/dsh-plugin-better-sidebar-plugin-office/package.json',
  'dsh-ui-appearance/package.json', 'dsh-better-sidebar/package.json', '@liustack/modsearch/package.json',
];

export function bootResolutionProbe(unpacked, arch, specifiers = BOOT_EXPORTS) {
  return `const assert=require('node:assert/strict');
    const path=require('node:path');
    assert.equal(process.arch,${JSON.stringify(arch)},'Wrong bundled Electron CPU');
    const {realpathSync}=require('node:fs');
    const root=realpathSync(${JSON.stringify(unpacked)});
    const {createRequire}=require('node:module');const req=createRequire(path.join(root,'package.json'));
    for(const name of ${JSON.stringify(specifiers)}) {
      const resolved=realpathSync(req.resolve(name));const rel=path.relative(root,resolved);
      assert(rel&&!rel.startsWith('..'+path.sep)&&rel!=='..'&&!path.isAbsolute(rel),'Dependency escaped bundle: '+name);
    }
    console.log('Harness boot exports resolved entirely inside bundle ('+process.arch+')');`;
}

export function bootDependencyLoadProbe(unpacked, files = [
  'node_modules/@deepseek-ai/dsh-session-telemetry-otel/node_modules/@opentelemetry/resources/build/src/detectors/platform/node/HostDetector.js',
]) {
  return `const path=require('node:path');const assert=require('node:assert/strict');
    const root=require('node:fs').realpathSync(${JSON.stringify(unpacked)});
    for(const file of ${JSON.stringify(files)}) require(path.join(root,file));
    for(const file of Object.keys(require.cache)) {
      const relative=path.relative(root,require('node:fs').realpathSync(file));
      assert(relative&&!relative.startsWith('..'+path.sep)&&relative!=='..'&&!path.isAbsolute(relative),'Loaded dependency escaped bundle: '+file);
    }
    console.log('Harness telemetry dependency loaded with its transitive modules');`;
}

export async function smokeHarnessBundle(bundle) {
  const target = `${process.platform}-${process.arch}`;
  const manifest = await verifyRuijieHarnessBundle(bundle,target);
  const executable = path.join(bundle,manifest.executable);
  const unpacked = process.platform === 'darwin'
    ? path.resolve(executable,'../../Resources/app.asar.unpacked')
    : path.join(bundle,'runtime/resources/app.asar.unpacked');
  const fixture = await mkdtemp(path.join(tmpdir(),'bot-harness-smoke-'));
  try {
    const config=path.join(fixture,'config');await mkdir(config);
    const env={};
    for (const key of ['SYSTEMROOT','WINDIR','COMSPEC','PATHEXT','PATH','TEMP','TMP']) if(process.env[key])env[key]=process.env[key];
    Object.assign(env,{HOME:fixture,USERPROFILE:fixture,APPDATA:config,LOCALAPPDATA:config,XDG_CONFIG_HOME:config,
      ELECTRON_RUN_AS_NODE:'1',NODE_PATH:'',DSH_TELEMETRY_DISABLED:'1',RUIJIE_HARNESS_HOME:path.join(fixture,'dsh')});
    const output=execFileSync(executable,['-e',bootResolutionProbe(unpacked,process.arch)],{env,cwd:fixture,encoding:'utf8',windowsHide:true,timeout:60_000});
    assert(output.includes('Harness boot exports resolved entirely inside bundle'));
    console.log(output.trim());
    const loaded=execFileSync(executable,['-e',bootDependencyLoadProbe(unpacked)],{env,cwd:fixture,encoding:'utf8',windowsHide:true,timeout:60_000});
    assert(loaded.includes('Harness telemetry dependency loaded'));
    console.log(loaded.trim());
  } finally {await rm(fixture,{recursive:true,force:true});}
}

if(process.argv[1]&&import.meta.url===pathToFileURL(path.resolve(process.argv[1])).href) {
  assert(process.argv[2],'Use smoke-harness-bundle.mjs BUNDLE_ROOT');
  await smokeHarnessBundle(path.resolve(process.argv[2]));
}
