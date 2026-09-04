import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const repoRoot = process.cwd();
const buildDir = path.join(repoRoot, "build");
const iconsetDir = path.join(buildDir, "icon.iconset");
const windowsIconsetDir = path.join(buildDir, "icon.winset");

function png(directory, size) {
  const filename = size === 1024 ? "icon_512x512@2x.png" : `icon_${size}x${size}.png`;
  return readFileSync(path.join(directory, filename));
}

function writeIco(destination, directory, sizes) {
  const images = sizes.map((size) => ({ size, data: png(directory, size) }));
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(images.length, 4);
  let offset = header.length + images.length * 16;
  const entries = images.map(({ size, data }) => {
    const entry = Buffer.alloc(16);
    entry.writeUInt8(size === 256 ? 0 : size, 0);
    entry.writeUInt8(size === 256 ? 0 : size, 1);
    entry.writeUInt8(0, 2);
    entry.writeUInt8(0, 3);
    entry.writeUInt16LE(1, 4);
    entry.writeUInt16LE(32, 6);
    entry.writeUInt32LE(data.length, 8);
    entry.writeUInt32LE(offset, 12);
    offset += data.length;
    return entry;
  });
  writeFileSync(destination, Buffer.concat([header, ...entries, ...images.map(({ data }) => data)]));
}

function writeIcns(destination, directory, sizes) {
  const types = new Map([[16, "icp4"], [32, "icp5"], [64, "icp6"], [128, "ic07"], [256, "ic08"], [512, "ic09"], [1024, "ic10"]]);
  const chunks = sizes.map((size) => {
    const data = png(directory, size);
    const chunk = Buffer.alloc(8 + data.length);
    chunk.write(types.get(size), 0, 4, "ascii");
    chunk.writeUInt32BE(chunk.length, 4);
    data.copy(chunk, 8);
    return chunk;
  });
  const header = Buffer.alloc(8);
  header.write("icns", 0, 4, "ascii");
  header.writeUInt32BE(8 + chunks.reduce((sum, chunk) => sum + chunk.length, 0), 4);
  writeFileSync(destination, Buffer.concat([header, ...chunks]));
}

writeIco(path.join(buildDir, "icon.ico"), windowsIconsetDir, [16, 32, 64, 128, 256]);
// A versioned basename prevents Explorer from reusing the previously installed
// shortcut artwork after an icon redesign.
writeIco(path.join(buildDir, "icon-ruijie-orb-depth.ico"), windowsIconsetDir, [16, 32, 64, 128, 256]);
writeIcns(path.join(buildDir, "icon.icns"), iconsetDir, [16, 32, 64, 128, 256, 512, 1024]);
