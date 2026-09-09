// Official release pins, checked 2026-09-07. Hashes are not signature verification.
const MAX_BYTES = 100 * 1024 * 1024;
export const ARTIFACTS = Object.freeze({
  cli: Object.freeze({
    directory: 'lark-cli-1.0.93-windows-amd64', name: 'lark-cli.exe', version: '1.0.93',
    url: 'https://github.com/larksuite/cli/releases/download/v1.0.93/lark-cli-1.0.93-windows-amd64.zip',
    sha256: '18e9320e378a0eefdb3b7004e0c6d42f48da85ae196d2bf5e89e4299ae7674d7',
    member: 'lark-cli.exe',
    executableSha256: '39ba320129d7c700f907d0ea0d4a79467262a72ca0f971879f5f45cf5f782645',
    maxBytes: MAX_BYTES,
    license: Object.freeze({
      url: 'https://raw.githubusercontent.com/larksuite/cli/v1.0.93/LICENSE',
      sha256: 'c969fc7e3af68e6bf40b0d8dd9c3dcc377eb685a2139535b203b39fdcad739ee',
      maxBytes: 1024 * 1024,
    }),
  }),
  node: Object.freeze({
    directory: 'node-24.15.0-win-x64', name: 'node.exe', version: '24.15.0',
    url: 'https://nodejs.org/dist/v24.15.0/win-x64/node.exe',
    sha256: '3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5',
    executableSha256: '3331e1ffe19874215472217c5e94f5a0c6d8e18c4ac7111d3937aa0ad5e9b4a5',
    maxBytes: MAX_BYTES,
    // The tagged distribution LICENSE includes Node's bundled third-party notices.
    license: Object.freeze({
      url: 'https://raw.githubusercontent.com/nodejs/node/v24.15.0/LICENSE',
      sha256: '4573185d56580da2b890ba34a85a409257640f1c5632eade4300137266194d18',
      maxBytes: 1024 * 1024,
    }),
  }),
});

export const NOTICE = `TuanTuan private runtime installation
CLI: larksuite/cli v1.0.93; upstream root license: MIT.
Node.js: v24.15.0; LICENSE preserves the upstream multi-party license text.
Full applicable third-party notices and source availability are in licenses/.
Automatic provisioning requires the packaged manifest's exact-artifact approval
and verifies bundled and installed notice sizes and SHA-256 hashes.
Artifact URLs and SHA-256 pins are recorded in the installation ownership marker.
SHA-256 verification is not Authenticode or signed-checksum verification.
The review is an engineering record, not legal certification or a reproducible
build attestation. Root licensing is not a blanket dependency clearance, and
limited artifact exceptions do not authorize other copyleft components.
Provisioning does not install npm packages or change global PATH, registry
settings or native configuration. Version probes disable remote metadata and
update/skills notifiers; provisioning never initializes CLI configuration.
`;
