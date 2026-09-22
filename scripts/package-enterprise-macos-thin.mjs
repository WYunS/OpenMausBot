// Bot-only thin delivery. Harness's standalone Universal release is untouched.
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { stringify } from 'yaml';
import enterpriseConfig from '../electron-builder.enterprise.mjs';
import { expectedMacCpu, run, signAdHoc, verifyAdHocThin } from './enterprise-macos-sign.mjs';

const {values:{arch}} = parseArgs({options:{arch:{type:'string'}},strict:true});
expectedMacCpu(arch);
assert.equal(process.platform,'darwin','A native Mac build is required');
assert.equal(process.arch,arch,'Build and verify on the target CPU');
const release = resolve('release');
const app = join(release,arch === 'arm64'?'mac-arm64':'mac','OpenMausBot.app');
assert(existsSync(app),'Missing electron-builder thin app');
const version = JSON.parse(readFileSync('package.json','utf8')).version;
const resources = join(app,'Contents/Resources');
writeFileSync(join(resources,'app-update.yml'),stringify({...enterpriseConfig.publish[0],updaterCacheDirName:'openmausbot-updater'}));
execFileSync(process.execPath,['scripts/check-enterprise-package.mjs',resources],{stdio:'inherit'});
signAdHoc(app);
await verifyAdHocThin(app,join(release,`macos-${arch}-signature-audit.json`),arch);

const dmgRoot = join(release,`dmg-root-${arch}`);
assert(!existsSync(dmgRoot),'DMG staging already exists; use a fresh release checkout');
mkdirSync(dmgRoot);
execFileSync('/usr/bin/ditto',[app,join(dmgRoot,'OpenMausBot.app')],{stdio:'inherit'});
symlinkSync('/Applications',join(dmgRoot,'Applications'));
const dmg = join(release,`RuijieBot-${version}-mac-${arch}.dmg`);
execFileSync('/usr/bin/hdiutil',['create','-volname',`锐捷Bot ${version}`,'-srcfolder',dmgRoot,'-format','UDZO',dmg],{stdio:'inherit',timeout:600_000});
const mount = join(release,`dmg-verify-${arch}`);mkdirSync(mount);
run('/usr/bin/hdiutil',['attach','-readonly','-nobrowse','-mountpoint',mount,dmg]);
try {await verifyAdHocThin(join(mount,'OpenMausBot.app'),join(release,`macos-${arch}-dmg-signature-audit.json`),arch);}
finally {run('/usr/bin/hdiutil',['detach',mount]);}
console.log(`Thin ${arch} DMG verified; ad-hoc signed, not notarized; internal testing only.`);
