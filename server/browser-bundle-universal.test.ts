import {describe,it,expect} from 'vitest';
import {mkdtempSync,mkdirSync,writeFileSync,rmSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {browserBundlePaths} from './browser-bundle-release.ts';

describe('Universal browser resource selection',()=>{
  it('selects the process architecture, never substitutes another CPU, and preserves flat packages',()=>{
    const root=mkdtempSync(join(tmpdir(),'omb-universal-paths-'));
    try {
      expect(browserBundlePaths(root,'darwin-arm64').directory).toBe(root);
      mkdirSync(join(root,'darwin-arm64'));
      writeFileSync(join(root,'universal.json'),'{}');
      for(const arch of ['arm64','x64']) {
        const paths=browserBundlePaths(root,`darwin-${arch}`);
        expect(paths.directory).toBe(join(root,`darwin-${arch}`));
        expect(existsSync(paths.directory)).toBe(arch==='arm64');
        expect(paths.engine).toBe(join(root,`darwin-${arch}`,'agent-browser'));
      }
      expect(browserBundlePaths(root,'win32-x64').directory).toBe(root);
      expect(browserBundlePaths(root,'linux-x64').directory).toBe(root);
    } finally {rmSync(root,{recursive:true,force:true});}
  });
});
