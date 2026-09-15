import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {mkdirSync,readFileSync,writeFileSync} from 'node:fs';
import path from 'node:path';
assert.equal(process.platform,'win32');
const pin=JSON.parse(readFileSync(new URL('./windows-browser.json',import.meta.url),'utf8'));
let bytes;
for(let attempt=1;attempt<=3;attempt++) {
  try {
    const response=await fetch(pin.url,{signal:AbortSignal.timeout(120000)});
    if(!response.ok)throw Error(`Browser vendor HTTP ${response.status}`);
    bytes=Buffer.from(await response.arrayBuffer());
    break;
  } catch(error) {if(attempt===3)throw error;await new Promise(resolve=>setTimeout(resolve,attempt*2000));}
}
assert.equal(bytes.length,pin.bytes,'Pinned browser ZIP size differs');
assert.equal(createHash('sha256').update(bytes).digest('hex'),pin.sha256,'Pinned browser ZIP digest differs');
const directory=path.resolve('dist-native/browser-vendor');
mkdirSync(directory,{recursive:true});
const archive=path.resolve('dist-native/browser-vendor.zip');
writeFileSync(archive,bytes);
execFileSync('tar.exe',['-xf',archive,'-C',directory],{stdio:'inherit',windowsHide:true});
console.log('Downloaded the repository-approved Windows browser vendor and verified its pinned size and SHA-256.');
