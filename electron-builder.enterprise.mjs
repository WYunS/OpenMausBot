import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import ruijie from './electron-builder.ruijie.mjs';
import {verifyDesktopBuildReceipt} from './scripts/desktop-build-receipt.mjs';
import {releaseRepository} from './.release/repository.mjs';
import {prepareWindowsInstaller} from './scripts/prepare-windows-installer.mjs';
const {repository,owner,repo}=releaseRepository();

// Explicit internal test builds use automated build/resource verification.
// The production configuration and its human acceptance receipts stay intact.
const {beforePack: productionAcceptance, ...base} = ruijie;
export default {
  ...base,
  async beforePack(context) {
    assert.equal(process.env.OMB_ENTERPRISE_TEST_BUILD, '1', 'Select the explicit enterprise internal-test workflow');
    verifyDesktopBuildReceipt();
    const metadata = JSON.parse(readFileSync('build/enterprise-release.json', 'utf8'));
    assert.equal(metadata.version, JSON.parse(readFileSync('package.json', 'utf8')).version);
    assert.equal(metadata.repository, repository);
    assert.equal(metadata.sandboxPreset, 'absent');
    if (context.electronPlatformName === 'win32') await prepareWindowsInstaller();
  },
  artifactName: 'RuijieBot-${version}-${arch}.${ext}',
  extraResources: [...base.extraResources, {from:'build/enterprise-release.json',to:'enterprise-release.json'}],
  publish: [{provider:'github',owner,repo}],
  // Final ad-hoc sealing and mounted-DMG verification are performed serially
  // by package-enterprise-macos-thin, preserving pinned vendor bytes.
  mac: {...base.mac,identity:null,notarize:false,signIgnore:['tuantuan-feishu-runtime/','ruijie-harness/']},
  dmg: {...base.dmg,sign:false},
  win: {...base.win,target:[{target:'nsis',arch:['x64']}],extraResources:[...base.win.extraResources,
    {from:'dist-native/windows-installer/LICENSE.txt',to:'licenses/7zip-LICENSE.txt'},
    {from:'dist-native/windows-installer/COPYING',to:'licenses/7zip-COPYING.txt'},
  ]},
  // Assisted NSIS pages keep install/uninstall progress and completion visible.
  nsis: {...base.nsis,oneClick:false,include:'build/ruijie-installer.nsh'},
};
