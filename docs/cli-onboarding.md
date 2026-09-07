# Terminal setup

With Node 24 or newer installed, run:

```sh
npx openmausbot start
```

The first start guides you through three choices:

1. Choose ChatGPT/Codex, Claude Code, or an API service. Existing supported connections are also listed.
2. Connect your account, or paste an API key into the hidden prompt. Setup offers to install a missing Codex or Claude CLI. Codex also supports device-code sign-in for a remote terminal. API services include OpenAI, OpenRouter, Groq, and other OpenAI-compatible endpoints.
3. Choose a model, then save. API connections ask before sending a short test message, which your provider may charge for. The selected provider and model become the default for new bots.

The server starts and prints its local address and a pairing link. Open the local address to chat, or use the pairing link to connect another device. Later, run the same `npx openmausbot start` command; your saved setup is reused. Stop the server with Ctrl-C.

Codex and Claude Code support agent tools. API-key connections currently support chat only. A ChatGPT or Claude subscription does not include separately billed API usage. Native account sign-in is confirmed during setup; access to the selected model is checked when you send a message.

## Commands

| Command | Use |
| --- | --- |
| `npx openmausbot setup` | Run or change setup, then exit without starting the server. |
| `npx openmausbot start` | Run setup if needed, then start the server with saved settings. |
| `npx openmausbot serve` | Start without interactive prompts; useful for existing configurations and unattended services. |
| `npx openmausbot login` | Sign in to an OpenMausBot account to reserve a public address for `--tunnel`. This is separate from AI-provider sign-in. |

`start` accepts the same server options as `serve`, including `--port`, `--data-dir`, `--no-pair`, `--tailscale`, and `--tunnel`. If you set a custom data directory during setup, pass that same `--data-dir` when starting. For example:

```sh
npx openmausbot setup --data-dir /path/to/omb-data
npx openmausbot start --data-dir /path/to/omb-data --port 8799
```

Setup requires an interactive terminal. `start` can run without a terminal once setup is complete. Existing bots and conversations retain their settings; the saved default applies to new bots. Stop a running server before changing its setup.

## Credentials and cancellation

API keys are hidden while typed or pasted. New API connections save the key in the selected data directory's `config.json` as plaintext, with owner-only permissions (`0600`) on Unix. Keep that file private; it is not encrypted. Account sign-in credentials are managed by the provider's own CLI.

Ctrl-C cancels a prompt without saving OMB settings. Installations or provider sign-ins already completed remain available for the next attempt.

For remote access and deployment options, see [self-hosting](self-hosting.md) and [the VPS guide](deploy-vps.md).
