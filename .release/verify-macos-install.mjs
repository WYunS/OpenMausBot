// Exercise the final DMG's copy/replace/remove lifecycle on native disposable CI.
// This is filesystem installation acceptance, not a Finder/TCC interaction test.
import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {createReadStream, existsSync} from 'node:fs';
import {mkdir, mkdtemp, readdir, readFile, readlink, lstat, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

export async function payloadInventory(root, relative='') {
  const inventory=[];
  for(const name of (await readdir(path.join(root,relative))).sort()) {
    const entry=path.join(relative,name), file=path.join(root,entry), info=await lstat(file);
    if(info.isSymbolicLink())inventory.push({path:entry,type:'symlink',target:await readlink(file)});
    else if(info.isDirectory()) {
      inventory.push({path:entry,type:'directory',mode:info.mode&0o777});
      inventory.push(...await payloadInventory(root,entry));
    } else {
      assert(info.isFile(),`Unexpected payload entry: ${entry}`);
      const hash=createHash('sha256');for await(const bytes of createReadStream(file))hash.update(bytes);
      inventory.push({path:entry,type:'file',mode:info.mode&0o777,size:info.size,sha256:hash.digest('hex')});
    }
  }
  return inventory;
}

export async function verifyMacInstall(ctx, mountedApp, smoke) {
  assert.equal(process.platform,'darwin');
  const arch=ctx.target.slice('macos-'.length);
  assert(['arm64','x64'].includes(arch));assert.equal(process.arch,arch);
  assert(process.env.GITHUB_ACTIONS==='true'&&process.env.RUNNER_ENVIRONMENT==='github-hosted',
    'Mac installation acceptance is restricted to disposable hosted runners');
  const fixture=await mkdtemp(path.join(process.env.RUNNER_TEMP,'ruijie-mac-install-'));
  const applications=path.join(fixture,'Applications 中文 with spaces');
  await mkdir(applications);
  const installed=path.join(applications,'OpenMausBot.app');
  const data=path.join(fixture,'home/Library/Application Support/锐捷Bot Installed');
  await mkdir(data,{recursive:true});
  const sentinel=path.join(data,'preserve-account-and-chat.txt');
  await writeFile(sentinel,'preserve fixture data');
  const independent=path.join(applications,'Independent Harness.app');
  await mkdir(independent);await writeFile(path.join(independent,'sentinel'),'independent app');
  const receipt={version:ctx.version,sourceSha:ctx.sourceSha,target:ctx.target,status:'pending',stages:[],
    scope:'Final DMG copy, replace, runtime smoke and removal in an isolated Applications directory; Finder, Gatekeeper and TCC require human acceptance'};
  const run=(file,args)=>execFileSync(file,args,{stdio:'inherit',timeout:600_000});
  const removeInstalled=async()=>{
    assert.equal(path.dirname(installed),applications);
    assert.equal(path.dirname(applications),fixture);
    assert(!(await lstat(installed)).isSymbolicLink());
    await rm(installed,{recursive:true});
  };
  try {
    const marker=JSON.parse(await readFile(path.join(mountedApp,'Contents/Resources/enterprise-release.json'),'utf8'));
    assert.equal(marker.version,ctx.version);assert.equal(marker.sourceSha,ctx.sourceSha);
    const expected=await payloadInventory(mountedApp);
    for(const stage of ['install','replace']) {
      const started=Date.now();
      // Finder's Replace discards the previous app, so obsolete vendor files
      // must not leak through a directory-merge implementation.
      if(stage==='replace')await removeInstalled();
      run('/usr/bin/ditto',[mountedApp,installed]);
      const seconds=(Date.now()-started)/1000;
      assert.deepEqual(await payloadInventory(installed),expected,'Installed DMG payload lost files, links, permissions or bytes');
      run('/usr/bin/codesign',['--verify','--deep','--strict',installed]);
      await smoke(path.join(installed,'Contents/Resources'),arch);
      assert.equal(await readFile(sentinel,'utf8'),'preserve fixture data');
      receipt.stages.push({name:stage,seconds,entries:expected.length,allPayloadHashesAndLinksMatch:true,installedRuntimeSmoke:'passed'});
      console.log(`Mac ${arch} ${stage}: ${seconds.toFixed(1)}s; ${expected.length} entries verified`);
      if(stage==='install')await writeFile(path.join(installed,'obsolete-upgrade-sentinel'),'must disappear');
    }
    const started=Date.now();await removeInstalled();
    assert(!existsSync(installed));assert.equal(await readFile(sentinel,'utf8'),'preserve fixture data');
    assert.equal(await readFile(path.join(independent,'sentinel'),'utf8'),'independent app');
    receipt.stages.push({name:'remove',seconds:(Date.now()-started)/1000,userDataPreserved:true,independentAppPreserved:true});
    receipt.status='passed';
  } catch(error) {receipt.status='failed';receipt.error=error.message;throw error;}
  finally {
    await mkdir(path.join(ctx.out,'evidence'),{recursive:true});
    await writeFile(path.join(ctx.out,`evidence/macos-${arch}-install-lifecycle.json`),JSON.stringify(receipt,null,2)+'\n');
    assert.equal(path.dirname(fixture),path.resolve(process.env.RUNNER_TEMP));
    await rm(fixture,{recursive:true,force:true});
  }
}
