import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {copyFile, mkdir, readFile} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath, pathToFileURL} from 'node:url';

// electron-builder 26.15.3's checksum-pinned 7zip@1.0.0 Windows x64 toolset.
// This standalone extractor runs only during install; no system 7-Zip needed.
export const WINDOWS_INSTALLER_7ZA_SHA256 = '223b873c50380fe9a39f1a22b6abf8d46db506e1c08d08312902f6f3cd1f7ac3';
const root = fileURLToPath(new URL('../', import.meta.url));

export async function prepareWindowsInstaller(directory = root) {
  assert.equal(process.platform, 'win32', 'Prepare the Windows installer on Windows');
  assert.equal(process.arch, 'x64', 'The installer uses the reviewed x64 extractor');
  const require = createRequire(import.meta.resolve('electron-builder'));
  const {getPath7za} = require('app-builder-lib/out/toolsets/7zip.js');
  const executable = await getPath7za();
  assert.equal(createHash('sha256').update(await readFile(executable)).digest('hex'), WINDOWS_INSTALLER_7ZA_SHA256,
    'Installer extractor differs from the reviewed toolset; do not silently replace it');
  const output = path.join(directory, 'dist-native/windows-installer');
  await mkdir(output, {recursive:true});
  await copyFile(executable, path.join(output, '7za.exe'));
  const toolset = path.resolve(executable, '../..');
  for (const name of ['LICENSE.txt', 'COPYING']) await copyFile(path.join(toolset, name), path.join(output, name));
  console.log('Prepared checksum-verified, long-path Windows installer extractor');
  return output;
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) await prepareWindowsInstaller();
