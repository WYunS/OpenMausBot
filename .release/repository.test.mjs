import assert from 'node:assert/strict';
import {spawnSync} from 'node:child_process';
import {mkdtemp, mkdir, readFile, realpath, rm, writeFile} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import test from 'node:test';

const root=fileURLToPath(new URL('../',import.meta.url));
const adapter=new URL('./adapter.mjs',import.meta.url).href;
const config=new URL('../electron-builder.enterprise.mjs',import.meta.url).href;
function node(args,repository) {
  return spawnSync(process.execPath,args,{cwd:root,encoding:'utf8',windowsHide:true,
    env:{...process.env,GITHUB_REPOSITORY:repository}});
}

for(const repository of ['AI-Applications-Team/OpenMausBot','WYunS/OpenMausBot']) {
  test(`${repository}: release metadata and builder target the same repository`,()=>{
    const result=node(['--input-type=module','--eval',`
      const {prepareFiles}=await import(${JSON.stringify(adapter)});
      const {default:config}=await import(${JSON.stringify(config)});
      const files=await prepareFiles({version:'0.1.84',sourceSha:'a'.repeat(40)});
      console.log(JSON.stringify({metadata:JSON.parse(files[0].content),publish:config.publish}));
    `],repository);
    assert.equal(result.status,0,result.stderr);
    const {metadata,publish}=JSON.parse(result.stdout);
    assert.equal(metadata.repository,repository);
    assert.equal(metadata.sourceSha,'a'.repeat(40));
    assert.equal(metadata.humanAcceptance,'not-run');
    assert.deepEqual(publish,[{provider:'github',owner:repository.split('/')[0],repo:'OpenMausBot'}]);
  });

  test(`${repository}: packaged verifier rejects resources from the other repository`,async t=>{
    const resources=await realpath(await mkdtemp(path.join(tmpdir(),'release-repository-fixture-')));
    t.after(async()=>{
      assert.equal(await realpath(resources),resources);
      assert(path.basename(resources).startsWith('release-repository-fixture-'));
      await rm(resources,{recursive:true,force:true});
    });
    for(const file of ['app.asar','ui/index.html','server/index.js','server/ruijie-computer-proxy.js',
      'companion/index.js','licenses/OpenMausBot-LICENSE.txt','licenses/OpenMausBot-NOTICE.txt']) {
      await mkdir(path.dirname(path.join(resources,file)),{recursive:true});
      await writeFile(path.join(resources,file),'isolated verifier fixture');
    }
    const {version}=JSON.parse(await readFile(path.join(root,'package.json'),'utf8'));
    const metadata={version,repository,sandboxPreset:'absent',humanAcceptance:'not-run'};
    const update=owner=>`provider: github\nowner: ${owner}\nrepo: OpenMausBot\n`;
    await writeFile(path.join(resources,'enterprise-release.json'),JSON.stringify(metadata));
    await writeFile(path.join(resources,'app-update.yml'),update(repository.split('/')[0]));
    const args=['scripts/check-enterprise-package.mjs',resources];
    const accepted=node(args,repository);
    assert.equal(accepted.status,0,accepted.stderr);
    const otherOwner=repository.startsWith('WYunS/')?'AI-Applications-Team':'WYunS';
    await writeFile(path.join(resources,'app-update.yml'),update(otherOwner));
    assert.notEqual(node(args,repository).status,0,'Wrong download owner must fail');
    await writeFile(path.join(resources,'app-update.yml'),update(repository.split('/')[0]));
    await writeFile(path.join(resources,'enterprise-release.json'),JSON.stringify({...metadata,repository:`${otherOwner}/OpenMausBot`}));
    assert.notEqual(node(args,repository).status,0,'Mixed repository metadata must fail');
  });
}

test('unapproved repositories cannot load the release builder',()=>{
  const result=node(['--input-type=module','--eval',`await import(${JSON.stringify(config)});`],'unapproved/OpenMausBot');
  assert.notEqual(result.status,0);
  assert.match(result.stderr,/approved RuijieBot release repository/);
});
