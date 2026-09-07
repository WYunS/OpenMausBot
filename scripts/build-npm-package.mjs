// Assemble the `openmausbot` npm package: the self-contained server bundle,
// the built UI, the bundled skills and the CLI, with a package.json of its
// own. `npx openmausbot serve` then needs Node 24+ and nothing else.
//
//   pnpm build:server && pnpm exec vite build && node scripts/build-npm-package.mjs
//   cd release/npm && npm pack        # or npm publish --access public
import { cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const out = join(root, "release", "npm");
const app = JSON.parse(readFileSync(join(root, "package.json"), "utf8"));

for (const required of ["dist-server/index.js", "dist-server/openmausbot.js", "dist/index.html"]) {
  if (!existsSync(join(root, required))) {
    console.error(`missing ${required}: run \`pnpm build:server && pnpm exec vite build\` first`);
    process.exit(1);
  }
}

rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });
cpSync(join(root, "dist-server"), join(out, "dist-server"), { recursive: true });
cpSync(join(root, "dist"), join(out, "dist"), { recursive: true });
if (existsSync(join(root, "skills"))) cpSync(join(root, "skills"), join(out, "skills"), { recursive: true });
cpSync(join(root, "LICENSE"), join(out, "LICENSE"));

// The bin lives next to the bundle so serverEntry() finds index.js by path.
writeFileSync(join(out, "cli.js"), `#!/usr/bin/env node\nimport "./dist-server/openmausbot.js";\n`);

writeFileSync(
  join(out, "package.json"),
  JSON.stringify(
    {
      name: "openmausbot",
      version: app.version,
      description: "Run the OpenMausBot server anywhere and pair your devices to it",
      license: "Apache-2.0",
      type: "module",
      bin: { openmausbot: "cli.js" },
      files: ["cli.js", "dist-server", "dist", "skills", "LICENSE", "README.md"],
      engines: { node: ">=24" },
      repository: { type: "git", url: "https://github.com/milind-soni/OpenMausBot.git" },
      homepage: "https://github.com/milind-soni/OpenMausBot#readme",
      keywords: ["openmausbot", "agents", "self-hosted", "server"],
    },
    null,
    2,
  ) + "\n",
);

writeFileSync(
  join(out, "README.md"),
  `# openmausbot

Run the OpenMausBot server on any machine with Node 24+, then pair your
devices to it.

\`\`\`sh
npx openmausbot start                # choose AI access once, then start with saved settings
npx openmausbot setup                # run or change setup without starting
npx openmausbot serve                 # starts the server, prints a pairing link + QR
npx openmausbot serve --tailscale     # HTTPS over your tailnet, no domain needed
npx openmausbot pair --label "Phone"  # another device later
npx openmausbot sessions              # who is paired; "sessions revoke <id>" signs one out
\`\`\`

First start: choose ChatGPT/Codex, Claude Code, or an API service; sign in
or paste a hidden API key; choose a model and save. Setup can install a
missing Codex or Claude CLI. Later starts reuse your saved settings.

API services include OpenAI, OpenRouter, Groq, and compatible endpoints.
API connections currently support chat only; API billing is separate from
ChatGPT/Claude subscriptions. New API keys are saved as plaintext in the
private config.json (0600 on Unix). Keep this file private.

Use \`serve\` for starts without prompts. \`login\` signs into an OpenMausBot
account for remote access with \`--tunnel\`; AI-provider sign-in is in setup.

Setup guide: https://github.com/milind-soni/OpenMausBot/blob/main/docs/cli-onboarding.md
Hosting guide: https://github.com/milind-soni/OpenMausBot/blob/main/docs/self-hosting.md
`,
);
console.log(`npm package assembled at ${out} (openmausbot@${app.version})`);
