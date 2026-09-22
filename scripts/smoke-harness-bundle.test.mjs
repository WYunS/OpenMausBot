import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { bootResolutionProbe, bootDependencyLoadProbe } from './smoke-harness-bundle.mjs';

test('load probe catches a missing transitive module even when the entrypoint resolves',async t=>{
  const root=await mkdtemp(path.join(tmpdir(),'harness-load-test-'));
  t.after(()=>rm(root,{recursive:true,force:true}));
  await writeFile(path.join(root,'HostDetector.js'),"module.exports = require('./machine-id/getMachineId');");
  const execute=()=>spawnSync(process.execPath,['-e',bootDependencyLoadProbe(root,['HostDetector.js'])],{cwd:root,encoding:'utf8',windowsHide:true});
  assert.match(execute().stderr,/Cannot find module/);
  await mkdir(path.join(root,'machine-id'));
  await writeFile(path.join(root,'machine-id/getMachineId.js'),'module.exports = 42;');
  const fixed=execute();assert.equal(fixed.status,0,fixed.stderr);
});

test('packaged probe fails on missing modules and cannot borrow parent node_modules',async t=>{
  const fixture=await mkdtemp(path.join(tmpdir(),'harness-probe-test-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  const root=path.join(fixture,'runtime');await mkdir(root);
  await writeFile(path.join(root,'package.json'),'{}');
  const execute=()=>spawnSync(process.execPath,['-e',bootResolutionProbe(root,process.arch,['fixture-module'])],{cwd:fixture,encoding:'utf8',windowsHide:true});
  assert.notEqual(execute().status,0);
  const parent=path.join(fixture,'node_modules/fixture-module');await mkdir(parent,{recursive:true});
  await writeFile(path.join(parent,'index.js'),'module.exports=1;');
  const borrowed=execute();assert.notEqual(borrowed.status,0);assert.match(borrowed.stderr,/Dependency escaped bundle/);
  const local=path.join(root,'node_modules/fixture-module');await mkdir(local,{recursive:true});
  await writeFile(path.join(local,'index.js'),'module.exports=1;');
  assert.equal(execute().status,0);
});

test('packaged probe accepts an aliased bundle root but rejects a module linked outside it',async t=>{
  const fixture=await mkdtemp(path.join(tmpdir(),'harness-probe-alias-'));
  t.after(()=>rm(fixture,{recursive:true,force:true}));
  const root=path.join(fixture,'runtime');
  const local=path.join(root,'node_modules/fixture-module');
  await mkdir(local,{recursive:true});
  await writeFile(path.join(root,'package.json'),'{}');
  await writeFile(path.join(local,'index.js'),'module.exports=1;');
  const alias=path.join(fixture,'mounted-alias');
  await symlink(root,alias,process.platform==='win32'?'junction':'dir');
  const execute=()=>spawnSync(process.execPath,['-e',bootResolutionProbe(alias,process.arch,['fixture-module'])],{cwd:fixture,encoding:'utf8',windowsHide:true});
  const valid=execute();assert.equal(valid.status,0,valid.stderr);
  await rm(local,{recursive:true});
  const external=path.join(fixture,'external-module');await mkdir(external);
  await writeFile(path.join(external,'index.js'),'module.exports=1;');
  await symlink(external,local,process.platform==='win32'?'junction':'dir');
  const escaped=execute();assert.notEqual(escaped.status,0);assert.match(escaped.stderr,/Dependency escaped bundle/);
});
