import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { deepestCodeFirst, vendorSlice, expectedMacCpu } from './enterprise-macos-sign.mjs';

test('framework Helpers and Libraries are sealed before their enclosing executable',()=>{
  const root=path.resolve('fixture/OpenMausBot.app/Contents/Frameworks/Electron Framework.framework/Versions/A');
  const executable=path.join(root,'Electron Framework');
  const helper=path.join(root,'Helpers/chrome_crashpad_handler');
  const library=path.join(root,'Libraries/libEGL.dylib');
  const sorted=deepestCodeFirst([executable,helper,library]);
  assert(sorted.indexOf(helper)<sorted.indexOf(executable));
  assert(sorted.indexOf(library)<sorted.indexOf(executable));
});
test('both thin and legacy vendor layouts preserve pinned signatures and bytes',()=>{
  const app=path.resolve('fixture/OpenMausBot.app');
  for(const name of ['ruijie-harness','tuantuan-feishu-runtime']) {
    assert.equal(vendorSlice(name,app,path.join(app,'Contents/Resources',name,'runtime/tool')),'flat');
    assert.equal(vendorSlice(name,app,path.join(app,'Contents/Resources',name,'darwin-arm64/runtime/tool')),'arm64');
    assert.equal(vendorSlice(name,app,path.join(app,'Contents/Resources',name+'-other','tool')),undefined);
  }
  assert.equal(expectedMacCpu('x64'),'x86_64');
  assert.equal(expectedMacCpu('arm64'),'arm64');
  assert.throws(()=>expectedMacCpu('universal'));
});
