import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp, mkdir, writeFile, cp, rm, chmod, symlink} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {payloadInventory,verifyMacInstall} from './verify-macos-install.mjs';

test('installed payload verification detects missing transitive modules and corrupt bytes',async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mac-inventory-test-'));
  try {
    const source=path.join(root,'source'), installed=path.join(root,'installed');
    await mkdir(path.join(source,'nested/node_modules/machine-id'),{recursive:true});
    const rel='nested/node_modules/machine-id/getMachineId.js';
    await writeFile(path.join(source,rel),'module.exports = 1;');
    await cp(source,installed,{recursive:true});
    const expected=await payloadInventory(source);
    assert.deepEqual(await payloadInventory(installed),expected);
    await writeFile(path.join(installed,rel),'module.exports = 2;');
    assert.notDeepEqual(await payloadInventory(installed),expected);
    await rm(path.join(installed,rel));
    assert.notDeepEqual(await payloadInventory(installed),expected);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('Mac inventory detects broken framework links and lost executable permissions',{skip:process.platform==='win32'},async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'mac-links-test-'));
  try {
    await writeFile(path.join(root,'binary'),'binary');await chmod(path.join(root,'binary'),0o755);
    await symlink('binary',path.join(root,'Current'));
    const expected=await payloadInventory(root);
    await chmod(path.join(root,'binary'),0o644);assert.notDeepEqual(await payloadInventory(root),expected);
    await chmod(path.join(root,'binary'),0o755);await rm(path.join(root,'Current'));
    await symlink('missing',path.join(root,'Current'));assert.notDeepEqual(await payloadInventory(root),expected);
  } finally {await rm(root,{recursive:true,force:true});}
});
test('actual Mac lifecycle refuses a developer machine',async()=>{
  if(process.env.RUNNER_ENVIRONMENT==='github-hosted'&&process.platform==='darwin')return;
  await assert.rejects(verifyMacInstall({target:`macos-${process.arch}`},'',()=>{}));
});
