// Actual app-id installation is permitted only on a disposable GitHub-hosted VM.
// Local regression tests use independent miniature NSIS fixtures instead.
import assert from 'node:assert/strict';
import {spawn, execFileSync} from 'node:child_process';
import {createReadStream, existsSync} from 'node:fs';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import path from 'node:path';

const registryScript = `
  $ErrorActionPreference = 'Stop'
  [Console]::OutputEncoding = [Text.UTF8Encoding]::new($false)
  $entries = @(Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue |
    Where-Object { $_.DisplayName -match '锐捷Bot|OpenMausBot' } |
    Select-Object PSPath, DisplayName, UninstallString)
  ConvertTo-Json -InputObject $entries -Compress
`;
function registrations() {
  return JSON.parse(execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', registryScript],
    {encoding:'utf8', windowsHide:true}));
}
async function hash(file) {
  const digest=createHash('sha256');
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest('hex');
}
async function payloadFiles(root, relative='') {
  const files=[];
  for (const entry of await readdir(path.join(root,relative),{withFileTypes:true})) {
    const name=path.join(relative,entry.name);
    assert(!entry.isSymbolicLink(),`Unexpected Windows payload symlink: ${name}`);
    if(entry.isDirectory())files.push(...await payloadFiles(root,name));
    else {assert(entry.isFile());files.push(name);}
  }
  return files;
}
async function execute(file,args,cwd) {
  const started=Date.now();
  await new Promise((resolve,reject)=>{
    const child=spawn(file,args,{cwd,windowsHide:true,stdio:'inherit'});
    const timer=setTimeout(()=>{child.kill();reject(new Error(`Installer exceeded 20 minutes: ${path.basename(file)}`));},20*60*1000);
    child.once('error',error=>{clearTimeout(timer);reject(error);});
    child.once('exit',(code,signal)=>{clearTimeout(timer);code===0?resolve():reject(new Error(`${path.basename(file)} exited ${code ?? signal}`));});
  });
  return (Date.now()-started)/1000;
}

export async function verifyWindowsInstall(ctx,smoke) {
  assert.equal(process.platform,'win32');
  assert(process.env.GITHUB_ACTIONS==='true' && process.env.RUNNER_ENVIRONMENT==='github-hosted',
    'Actual installer acceptance requires a disposable GitHub-hosted runner; never run against a developer installation');
  assert.equal(registrations().length,0,'Runner already has a Bot installation');
  const fixture=await mkdtemp(path.join(process.env.RUNNER_TEMP,'ruijie-install-acceptance-'));
  const destination=path.join(fixture,'deliberately-long-profile-path','Programs','openmausbot');
  const expected=path.join(ctx.root,'release/win-unpacked');
  const installer=path.join(ctx.root,'release',`RuijieBot-${ctx.version}-setup.exe`);
  assert.equal(JSON.parse(await readFile(path.join(expected,'resources/enterprise-release.json'),'utf8')).sourceSha,ctx.sourceSha,
    'Expected payload was built from a different source');
  const receipt={version:ctx.version,sourceSha:ctx.sourceSha,installerSha256:await hash(installer),status:'pending',stages:[]};
  const sentinels=[path.join(process.env.APPDATA,'锐捷Bot Installed'),path.join(process.env.USERPROFILE,'.ruijiebot')]
    .map(dir=>path.join(dir,`installer-acceptance-${path.basename(fixture)}.txt`));
  const sentinel='fixture account/chat/workspace data; preserve during reinstall and uninstall';
  let uninstallerCopy;
  async function uninstall() {
    const records=registrations();
    assert.equal(records.length,1,'Expected one registered uninstaller');
    const executable=/^"([^"]+)"/.exec(records[0].UninstallString)?.[1];
    assert(executable && path.dirname(executable).toLowerCase()===destination.toLowerCase(),'Uninstall registration escaped fixture');
    // Running a copy with _?= prevents NSIS detaching to a second temp process:
    // the awaited exit code now belongs to the actual removal, not its launcher.
    uninstallerCopy=path.join(fixture,'acceptance-uninstall.exe');
    await copyFile(executable,uninstallerCopy);
    const seconds=await execute(uninstallerCopy,['/S','/currentuser',`_?=${destination}`],fixture);
    assert(!existsSync(destination),'Uninstaller left program files (including long paths)');
    assert.equal(registrations().length,0,'Uninstaller left its registration');
    for(const file of sentinels)assert.equal(await readFile(file,'utf8'),sentinel);
    receipt.stages.push({name:'uninstall',seconds,programFilesRemoved:true,userDataPreserved:true});
  }
  try {
    for(const file of sentinels){await mkdir(path.dirname(file),{recursive:true});await writeFile(file,sentinel);}
    const files=await payloadFiles(expected);
    assert(files.some(file=>path.join(destination,file).length>260),'Acceptance must exercise long installed paths');
    const digests=new Map();
    for(const file of files)digests.set(file,await hash(path.join(expected,file)));
    for(const stage of ['install','reinstall']) {
      console.log(`Windows ${stage}: testing actual EXE, ${files.length} payload files`);
      const seconds=await execute(installer,['/S','/currentuser',`/D=${destination}`],fixture);
      for(const [file,digest] of digests)assert.equal(await hash(path.join(destination,file)),digest,`Installed payload differs: ${file}`);
      for(const file of sentinels)assert.equal(await readFile(file,'utf8'),sentinel);
      receipt.stages.push({name:stage,seconds,payloadFiles:files.length,allPayloadHashesMatch:true});
      console.log(`Windows ${stage}: ${seconds.toFixed(1)}s; all installed payload hashes match`);
      if(stage==='install')await smoke(path.join(destination,'resources'),'x64');
    }
    await uninstall();
    receipt.status='passed';
  } catch(error) {
    receipt.status='failed';receipt.error=error.message;
    // Preserve failed files and registry only on this disposable VM for diagnostics.
    // No success receipt or Release is produced after a failed lifecycle.
    throw error;
  } finally {
    await mkdir(path.join(ctx.out,'evidence'),{recursive:true});
    await writeFile(path.join(ctx.out,'evidence/windows-installer-lifecycle.json'),JSON.stringify(receipt,null,2)+'\n');
    for(const file of sentinels)await rm(file,{force:true});
    if(receipt.status==='passed') {
      assert(path.dirname(fixture)===path.resolve(process.env.RUNNER_TEMP));
      await rm(fixture,{recursive:true,force:true});
    }
  }
}
