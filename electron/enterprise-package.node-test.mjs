import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {readFile} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import test from 'node:test';
import {releaseRepository} from '../.release/repository.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.resolve('electron-builder'));
const {getConfig,validateConfiguration}=require('app-builder-lib/out/util/config/config.js');
test('enterprise test config preserves identity/resources, excludes credentials, and keeps production separate',async()=>{
  const config=await getConfig(root,'electron-builder.enterprise.mjs',null);
  await validateConfiguration(config);
  assert.equal(config.appId,'com.openmausbot.app');
  assert.equal(config.productName,'OpenMausBot');
  assert.equal(config.afterPack,'./scripts/after-pack.mjs');
  const {owner,repo}=releaseRepository();
  assert.deepEqual(config.publish,[{provider:'github',owner,repo}]);
  assert.equal(config.mac.identity,'-');assert.equal(config.mac.notarize,false);assert.equal(config.dmg.sign,false);
  assert.deepEqual(config.win.target,[{target:'nsis',arch:['x64']}]);
  assert(config.extraResources.some(x=>x.to==='server'));
  assert(config.extraResources.some(x=>x.to==='enterprise-release.json'));
  for(const resources of [config.extraResources,config.mac.extraResources,config.win.extraResources,config.linux.extraResources])assert(!resources.some(x=>/sandbox|release-inputs|credentials/i.test(x.from+' '+x.to)));
  assert.equal(config.extraMetadata?.ruijieSandboxBootstrapSha256,undefined);
  const previous=process.env.OMB_ENTERPRISE_TEST_BUILD;
  delete process.env.OMB_ENTERPRISE_TEST_BUILD;
  try {await assert.rejects(async()=>config.beforePack({}),/explicit enterprise internal-test/);}
  finally {if(previous!==undefined)process.env.OMB_ENTERPRISE_TEST_BUILD=previous;}
  // getConfig normalizes shared imported arrays in place; do not normalize
  // the same base twice in this process just to inspect its acceptance hook.
  const {default:production}=await import('../electron-builder.ruijie.mjs');
  assert.equal(production.beforePack.name,'beforeRuijiePack');
  const pkg=JSON.parse(await readFile(new URL('../package.json',import.meta.url),'utf8'));
  assert(!pkg.scripts['package:mac'].includes('build:sandbox'));
});
