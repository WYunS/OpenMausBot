import assert from 'node:assert/strict';
import {test} from 'node:test';
import {copyFile, mkdir, mkdtemp, readFile, readdir, rm, writeFile, access} from 'node:fs/promises';
import path from 'node:path';
import {tmpdir} from 'node:os';
import {spawn, spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {fileURLToPath} from 'node:url';
import {prepareWindowsInstaller} from './prepare-windows-installer.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const require=createRequire(import.meta.resolve('electron-builder'));

test('real NSIS preserves long paths, rejects corrupt payloads and removes only its own installation',
  {skip:process.platform!=='win32',timeout:180000},async t=>{
  const fullFixture=await mkdtemp(path.join(tmpdir(),'ruijie-nsis-'));
  // GitHub's TEMP uses RUNNER~1. Exercise the same 8.3/long process-path
  // mismatch locally where the volume supports short names.
  const alias=spawnSync('powershell.exe',['-NoProfile','-NonInteractive','-Command',
    '[Console]::OutputEncoding=[Text.UTF8Encoding]::new($false); (New-Object -ComObject Scripting.FileSystemObject).GetFolder($env:RUIJIE_NSIS_FIXTURE).ShortPath'],
    {env:{...process.env,RUIJIE_NSIS_FIXTURE:fullFixture},encoding:'utf8',windowsHide:true,timeout:30000});
  assert.equal(alias.status,0,alias.stderr);
  const fixture=alias.stdout.trim();
  assert(path.isAbsolute(fixture));
  t.diagnostic(`Fixture uses short path alias: ${fixture.toLowerCase()!==fullFixture.toLowerCase()}`);
  let completed=false;
  t.after(async()=>{if(!completed)try{t.diagnostic(await readFile(path.join(fixture,'installer.log'),'utf8'));}catch{}});
  const owned=[];
  t.after(async()=>{for(const child of owned)if(child.exitCode===null&&!child.killed)child.kill();await rm(fixture,{recursive:true,force:true,maxRetries:5,retryDelay:200});});
  const tools=await prepareWindowsInstaller();
  const {getMakeNsisPath,getNsisPluginsPath}=require('app-builder-lib/out/toolsets/windows.js');
  const nsis=await getMakeNsisPath();
  const pluginRoot=await getNsisPluginsPath();
  const builderRoot=path.dirname(require.resolve('app-builder-lib/package.json'));
  const templates=path.join(builderRoot,'templates/nsis/include');
  const seven=path.join(tools,'7za.exe');
  const source=path.join(fixture,'source');
  const install=path.join(fixture,'installed-with-a-deliberately-long-application-directory');
  const external=path.join(fixture,'independent-harness');
  const relative='resources/ruijie-harness/runtime/resources/app.asar.unpacked/node_modules/@deepseek-ai/dsh-session-telemetry-otel/node_modules/@opentelemetry/resources/build/src/detectors/platform/node/machine-id/getMachineId.js';
  assert(path.join(install,relative).length>260);
  await mkdir(path.dirname(path.join(source,relative)),{recursive:true});
  await writeFile(path.join(source,relative),'module.exports = 42;\n');
  await writeFile(path.join(source,'short.txt'),'short\n');
  await writeFile(path.join(source,'resources/enterprise-release.json'),JSON.stringify({repository:'AI-Applications-Team/OpenMausBot'}));
  const archive=path.join(fixture,'payload.7z');
  const run=(file,args,cwd=fixture)=>{const r=spawnSync(file,args,{cwd,env:{...process.env,...nsis.env},encoding:'utf8',windowsHide:true,timeout:30000});if(r.error)throw r.error;return r;};
  let r=run(seven,['a',archive,'.','-mx=1','-bso0','-bsp0'],source);assert.equal(r.status,0,r.stderr);
  const build=async(name,section,include=true)=>{
    const exe=path.join(fixture,name+'.exe');
    const script=path.join(fixture,name+'.nsi');
    await writeFile(script,`Unicode true
RequestExecutionLevel user
SilentInstall silent
OutFile "${exe}"
!addincludedir "${templates}"
!addplugindir "${path.join(pluginRoot,'x86-unicode')}"
!include "LogicLib.nsh"
!define BUILD_RESOURCES_DIR "${path.join(root,'build')}"
!define RUIJIE_INSTALL_LOG "${path.join(fixture,'installer.log')}"
${include?`!include "${path.join(root,'build/ruijie-installer.nsh')}"\n`:''}
!include "extractAppPackage.nsh"
Section
InitPluginsDir
StrCpy $INSTDIR "${install}"
SetOutPath $INSTDIR
${section}
SectionEnd
`);
    const result=run(nsis.path,['/V2',script]);assert.equal(result.status,0,result.stdout+result.stderr);return exe;
  };
  const legacy=await build('legacy',`Nsis7z::Extract "${archive}"`,false);
  r=run(legacy,[]);assert.equal(r.status,0);await assert.rejects(access(path.join(install,relative)),/ENOENT/);
  // Remove only this test's already-validated destination before the fixed run.
  assert(install.startsWith(fixture+path.sep));await rm(install,{recursive:true,force:true});
  const fixed=await build('fixed',`!insertmacro extractUsing7za "${archive}"`);
  r=run(fixed,[]);assert.equal(r.status,0,r.stdout+r.stderr);assert.equal(await readFile(path.join(install,relative),'utf8'),'module.exports = 42;\n');
  const bad=path.join(fixture,'bad.7z');await writeFile(bad,'not an archive');
  r=run(await build('corrupt',`!insertmacro extractUsing7za "${bad}"`),[]);assert.equal(r.status,2,'Extraction errors must fail installation');
  await mkdir(external);await writeFile(path.join(external,'user-data.txt'),'keep');
  for(const [dir,name] of [[install,'bundled.exe'],[external,'independent.exe']]){
    const executable=path.join(dir,name);await copyFile(path.join(process.env.SYSTEMROOT,'System32/cmd.exe'),executable);
    const child=spawn(executable,['/d','/q'],{cwd:dir,windowsHide:true,stdio:['pipe','ignore','ignore']});owned.push(child);
    await new Promise((resolve,reject)=>{child.once('spawn',resolve);child.once('error',reject)});
  }
  const uninstaller=await build('remove','!insertmacro customUnInstall\n!insertmacro customRemoveFiles');
  await writeFile(path.join(install,'resources/enterprise-release.json'),JSON.stringify({repository:'unrelated/project'}));
  r=run(uninstaller,[]);assert.equal(r.status,2,'Unrecognized installations must not be terminated or deleted');
  process.kill(owned[0].pid,0);
  assert.equal(await readFile(path.join(install,relative),'utf8'),'module.exports = 42;\n');
  await writeFile(path.join(install,'resources/enterprise-release.json'),JSON.stringify({repository:'AI-Applications-Team/OpenMausBot'}));
  r=run(uninstaller,[]);
  if(r.status!==0){
    t.diagnostic(JSON.stringify({remaining:await readdir(install,{recursive:true}).catch(e=>e.code),ownedPids:owned.map(child=>child.pid)}));
    t.diagnostic(run('powershell.exe',['-NoProfile','-Command',`Get-CimInstance Win32_Process -Filter 'ProcessId = ${owned[0].pid}' | Select-Object ProcessId,ExecutablePath | ConvertTo-Json -Compress`]).stdout);
  }
  assert.equal(r.status,0,r.stdout+r.stderr);await assert.rejects(access(install),/ENOENT/);
  process.kill(owned[1].pid,0);
  assert.equal(owned[1].exitCode,null,'Independent installation must keep running');
  assert.equal(await readFile(path.join(external,'user-data.txt'),'utf8'),'keep');
  completed=true;
});
