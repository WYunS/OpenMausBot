import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ruijie from './electron-builder.ruijie.mjs';
import {verifyDesktopBuildReceipt} from './scripts/desktop-build-receipt.mjs';

// Explicit internal test builds use automated build/resource verification.
// The production configuration and its human acceptance receipts stay intact.
const {beforePack: productionAcceptance, ...base} = ruijie;
export default {
  ...base,
  beforePack() {
    assert.equal(process.env.OMB_ENTERPRISE_TEST_BUILD, '1', 'Select the explicit enterprise internal-test workflow');
    verifyDesktopBuildReceipt();
    const metadata = JSON.parse(readFileSync('build/enterprise-release.json', 'utf8'));
    assert.equal(metadata.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
    assert.equal(metadata.repository, 'AI-Applications-Team/OpenMausBot');
    assert.equal(metadata.sandboxPreset, 'absent');
  },
  artifactName: 'RuijieBot-${version}-${arch}.${ext}',
  extraResources: [...base.extraResources, {from:'build/enterprise-release.json',to:'enterprise-release.json'}],
  publish: [{provider:'github',owner:'AI-Applications-Team',repo:'OpenMausBot'}],
  mac: {...base.mac,identity:'-',notarize:false,signIgnore:['tuantuan-feishu-runtime/','ruijie-harness/']},
  dmg: {...base.dmg,sign:false},
  win: {...base.win,target:[{target:'nsis',arch:['x64']}]},
};
