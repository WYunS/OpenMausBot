import { existsSync, mkdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { DATA_DIR, instanceConfigs, loadConfig, PROVIDER_CREDENTIAL_ENV, WORKSPACE_CREDENTIAL_ENV, type AppConfig } from "./config.ts";
import { acquireDataDirLease } from "./data-dir-lease.ts";
import { SetupCancelled, type SetupIo } from "./cli-prompts.ts";
import { isSetupComplete, runSetup } from "./cli-setup.ts";
import { OpenAICompatDriver } from "./drivers/openai-compat.ts";

const options = { dataDir: DATA_DIR, port: 8799 };
const configPath = join(DATA_DIR, "config.json");
const models = {
  default: "fixture-default",
  options: [
    { id: "fixture-default", label: "Fixture default" },
    { id: "fixture-selected", label: "Fixture selected" },
  ],
};
type Dependencies = NonNullable<Parameters<typeof runSetup>[2]>;

function dependencies() {
  return {
    inspect: vi.fn<Dependencies["inspect"]>().mockResolvedValue({
      snapshot: { state: "available", authenticated: true }, models,
    }),
    runCli: vi.fn<Dependencies["runCli"]>().mockResolvedValue(undefined),
    models: vi.fn<Dependencies["models"]>().mockResolvedValue(models.options),
    verify: vi.fn<Dependencies["verify"]>().mockResolvedValue(undefined),
  };
}

function prompts(script: { choices?: number[]; confirms?: boolean[]; secrets?: Array<string | Error>; answers?: string[] } = {}) {
  const choices = [...(script.choices ?? [])];
  const confirms = [...(script.confirms ?? [])];
  const secrets = [...(script.secrets ?? [])];
  const answers = [...(script.answers ?? [])];
  const lines: string[] = [];
  const take = <T>(values: T[], question: string): T => {
    if (!values.length) throw new Error(`Unexpected fixture prompt: ${question}`);
    return values.shift()!;
  };
  const io = {
    log: vi.fn((line: string) => { lines.push(line); }),
    choose: vi.fn<SetupIo["choose"]>(async (question, available) => {
      lines.push(question, ...available);
      const selected = take(choices, question);
      if (selected < 0 || selected >= available.length) throw new Error("Fixture selected an unavailable option");
      return selected;
    }),
    confirm: vi.fn<SetupIo["confirm"]>(async (question) => { lines.push(question); return take(confirms, question); }),
    secret: vi.fn<SetupIo["secret"]>(async (question) => {
      lines.push(question);
      const value = take(secrets, question);
      if (value instanceof Error) throw value;
      return value;
    }),
    ask: vi.fn<SetupIo["ask"]>(async (question) => { lines.push(question); return take(answers, question); }),
  };
  return { io, lines, assertConsumed: () => expect([choices, confirms, secrets, answers]).toEqual([[], [], [], []]) };
}

function persist(config: AppConfig & Record<string, unknown>): string {
  const raw = JSON.stringify(config, null, 2);
  writeFileSync(configPath, raw, { mode: 0o600 });
  return raw;
}

function expectLeaseReleased() {
  const lease = acquireDataDirLease(DATA_DIR);
  expect(lease.release()).toBe(true);
}

beforeEach(() => {
  // testing/setup.ts assigns a throwaway HOME before this module loads.
  rmSync(DATA_DIR, { recursive: true, force: true });
  mkdirSync(DATA_DIR, { recursive: true });
  for (const name of [...WORKSPACE_CREDENTIAL_ENV, ...PROVIDER_CREDENTIAL_ENV, "OPENAI_COMPAT_MODEL", "OPENAI_COMPAT_PROVIDER"])
    vi.stubEnv(name, undefined);
  vi.stubGlobal("fetch", vi.fn(() => { throw new Error("Wizard fixtures must never make network requests"); }));
});
afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
});

describe("native provider onboarding", () => {
  it.each([{ choice: 0, id: "codex", driver: "codex" }, { choice: 1, id: "claude", driver: "claudeAgent" }])(
    "uses an existing $id login and saves the selected model without starting an auth process",
    async ({ choice, id, driver }) => {
      const deps = dependencies();
      const ui = prompts({ choices: [choice, 1], confirms: [true] });
      expect(await runSetup(options, ui.io, deps)).toBe(true);
      expect(deps.inspect).toHaveBeenCalledWith(id, { driver, enabled: true });
      expect(deps.runCli).not.toHaveBeenCalled();
      expect(deps.models).not.toHaveBeenCalled();
      expect(deps.verify).not.toHaveBeenCalled();
      expect(loadConfig().defaultModelSelection).toEqual({ instanceId: id, model: "fixture-selected" });
      expect(loadConfig().instances?.[id]).toEqual({ driver, enabled: true });
      expect(loadConfig().instances?.openaiCompat.driver).toBe("openai-compat");
      expect(ui.lines.join("\n")).toContain("Existing sign-in found");
      expect(await isSetupComplete(DATA_DIR)).toBe(true);
      ui.assertConsumed();
      expectLeaseReleased();
    },
  );

  it("installs Codex only after confirmation and supports remote device sign-in", async () => {
    const deps = dependencies();
    deps.inspect
      .mockResolvedValueOnce({ snapshot: { state: "unavailable", reason: "missing fixture CLI" }, models })
      .mockResolvedValueOnce({ snapshot: { state: "available", authenticated: false }, models });
    const ui = prompts({ choices: [0, 1, 0], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.runCli.mock.calls).toEqual([
      ["npm", ["install", "-g", "@openai/codex"]],
      ["codex", ["login", "--device-auth"], undefined],
    ]);
    expect(ui.io.confirm.mock.invocationCallOrder[0]).toBeLessThan(deps.runCli.mock.invocationCallOrder[0]!);
    expect(deps.inspect).toHaveBeenCalledTimes(3);
    ui.assertConsumed();
  });

  it("runs Claude's account login and retains a custom CLI path and environment", async () => {
    const original = { driver: "claudeAgent", config: { cli: "/fixture/bin/claude" }, environment: { CLAUDE_CONFIG_DIR: "/fixture/account" } };
    persist({ instances: { workClaude: original } });
    const deps = dependencies();
    deps.inspect.mockResolvedValueOnce({ snapshot: { state: "available", authenticated: false }, models });
    const ui = prompts({ choices: [3, 0], confirms: [true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.runCli).toHaveBeenCalledWith("/fixture/bin/claude", ["auth", "login"], original.environment);
    expect(loadConfig().instances?.workClaude).toEqual({ ...original, enabled: true });
    expect(loadConfig().defaultModelSelection?.instanceId).toBe("workClaude");
    ui.assertConsumed();
  });

  it("does not save after a CLI exits successfully without confirming sign-in", async () => {
    const original = persist({ profile: { name: "Existing user" } });
    const deps = dependencies();
    deps.inspect.mockResolvedValue({ snapshot: { state: "available", authenticated: false }, models });
    const ui = prompts({ choices: [0, 0] });
    await expect(runSetup(options, ui.io, deps)).rejects.toThrow("Sign-in was not confirmed");
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expectLeaseReleased();
  });

  it("keeps settings after sign-in cancellation", async () => {
    const original = persist({ profile: { name: "Existing user" } });
    const deps = dependencies();
    deps.inspect.mockResolvedValueOnce({ snapshot: { state: "available", authenticated: false }, models });
    deps.runCli.mockRejectedValue(new SetupCancelled());
    const ui = prompts({ choices: [0, 0] });
    expect(await runSetup(options, ui.io, deps)).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expectLeaseReleased();
  });

  it("cancels a declined install before running any command", async () => {
    const deps = dependencies();
    deps.inspect.mockResolvedValue({ snapshot: { state: "unavailable" }, models });
    const ui = prompts({ choices: [0], confirms: [false] });
    expect(await runSetup(options, ui.io, deps)).toBe(false);
    expect(deps.runCli).not.toHaveBeenCalled();
    expect(existsSync(configPath)).toBe(false);
    expectLeaseReleased();
  });

  it("keeps the saved native model selected when setup is run again", async () => {
    persist({ instances: { codex: { driver: "codex" } }, defaultModelSelection: { instanceId: "codex", model: "fixture-selected" } });
    const ui = prompts({ choices: [3, 1], confirms: [true] });
    expect(await runSetup(options, ui.io, dependencies())).toBe(true);
    expect(ui.io.choose.mock.calls[0]?.[2]).toBe(3);
    expect(ui.io.choose.mock.calls[1]?.[2]).toBe(1);
    expect(loadConfig().defaultModelSelection).toEqual({ instanceId: "codex", model: "fixture-selected" });
  });

  it("does not change a saved setup when the final native save is declined", async () => {
    const original = persist({ profile: { name: "Keep" }, defaultModelSelection: { instanceId: "claude", model: "previous" } });
    const ui = prompts({ choices: [0, 1], confirms: [false] });
    expect(await runSetup(options, ui.io, dependencies())).toBe(false);
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expectLeaseReleased();
  });

  it("does not install over an unavailable custom CLI path", async () => {
    const original = persist({ instances: { codex: { driver: "codex", config: { cli: "/fixture/custom-codex" } } } });
    const deps = dependencies();
    deps.inspect.mockResolvedValue({ snapshot: { state: "unavailable" }, models });
    const ui = prompts({ choices: [0] });
    await expect(runSetup(options, ui.io, deps)).rejects.toThrow("custom CLI path is unavailable");
    expect(deps.runCli).not.toHaveBeenCalled();
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expectLeaseReleased();
  });

  it("does not overwrite an instance that repurposed a native provider ID", async () => {
    const existing = { driver: "customAcp", displayName: "Keep this connection", config: { cli: "/fixture/other" } };
    persist({ instances: { codex: existing } });
    const ui = prompts({ choices: [0, 0], confirms: [true] });
    expect(await runSetup(options, ui.io, dependencies())).toBe(true);
    const saved = loadConfig();
    expect(saved.instances?.codex).toEqual(existing);
    expect(saved.defaultModelSelection?.instanceId).toMatch(/^codex-[\da-f]{8}$/);
    expect(saved.instances?.[saved.defaultModelSelection!.instanceId]?.driver).toBe("codex");
  });
});

describe("API onboarding", () => {
  it.each<{
    label: string;
    configKey?: string;
    environment?: Record<string, string>;
    processEnvironment: Record<string, string>;
    expected: string;
  }>([
    {
      label: "explicit config key", configKey: "config-key",
      environment: { OMB_SETUP_TEST_CUSTOM_KEY: "instance-custom-key", OPENAI_COMPAT_API_KEY: "instance-default-key" },
      processEnvironment: { OMB_SETUP_TEST_CUSTOM_KEY: "process-custom-key", OPENAI_COMPAT_API_KEY: "process-default-key" },
      expected: "config-key",
    },
    {
      label: "custom instance environment key",
      environment: { OMB_SETUP_TEST_CUSTOM_KEY: "instance-custom-key", OPENAI_COMPAT_API_KEY: "instance-default-key" },
      processEnvironment: { OMB_SETUP_TEST_CUSTOM_KEY: "process-custom-key", OPENAI_COMPAT_API_KEY: "process-default-key" },
      expected: "instance-custom-key",
    },
    {
      label: "standard instance environment fallback",
      environment: { OPENAI_COMPAT_API_KEY: "instance-default-key" },
      processEnvironment: { OMB_SETUP_TEST_CUSTOM_KEY: "process-custom-key" },
      expected: "instance-default-key",
    },
    {
      label: "custom process environment fallback",
      processEnvironment: { OMB_SETUP_TEST_CUSTOM_KEY: "process-custom-key" }, expected: "process-custom-key",
    },
    {
      label: "standard process environment fallback",
      processEnvironment: { OPENAI_COMPAT_API_KEY: "process-default-key" }, expected: "process-default-key",
    },
  ])("uses the driver's $label precedence for existing API setup", async ({ configKey, environment, processEnvironment, expected }) => {
    for (const [name, value] of Object.entries(processEnvironment)) vi.stubEnv(name, value);
    const original = {
      driver: "openai-compat", ...(environment ? { environment } : {}),
      config: { url: "https://api.example.test/v1", apiKeyEnv: "OMB_SETUP_TEST_CUSTOM_KEY", ...(configKey ? { key: configKey } : {}) },
    };
    persist({ instances: { existing: original } });
    const deps = dependencies();
    const ui = prompts({ choices: [3, 0], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.models).toHaveBeenCalledWith("https://api.example.test/v1", expected);
    expect(deps.verify).toHaveBeenCalledWith("https://api.example.test/v1", expected, "fixture-default");
    expect(ui.io.secret).not.toHaveBeenCalled();
    expect(loadConfig().instances?.existing).toEqual({ ...original, config: { ...original.config, model: "fixture-default" } });
    ui.assertConsumed();
  });

  it("verifies an existing connection using its effective workspace routing provider", async () => {
    persist({
      openaiCompat: { provider: "fireworks" },
      instances: { routed: { driver: "openai-compat", config: { url: "https://openrouter.ai/api/v1", key: "fixture-key" } } },
    });
    const deps = dependencies();
    const ui = prompts({ choices: [3, 0], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.verify).toHaveBeenCalledWith("https://openrouter.ai/api/v1", "fixture-key", "fixture-default", "fireworks");
    expect(loadConfig().instances?.routed.config).toEqual({ url: "https://openrouter.ai/api/v1", key: "fixture-key", model: "fixture-default" });
    ui.assertConsumed();
  });

  it("does not inherit an old workspace or environment routing pin for a new standalone API connection", async () => {
    persist({ openaiCompat: { provider: "workspace-provider" } });
    vi.stubEnv("OPENAI_COMPAT_PROVIDER", "environment-provider");
    const deps = dependencies();
    const ui = prompts({ choices: [2, 1, 0], secrets: ["fixture-new-key"], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.verify).toHaveBeenCalledWith("https://openrouter.ai/api/v1", "fixture-new-key", "fixture-default");
    const saved = loadConfig();
    const id = saved.defaultModelSelection!.instanceId;
    const liveEntry = instanceConfigs(saved)[id]!;
    expect(liveEntry.config).toMatchObject({ provider: "" });
    expect(OpenAICompatDriver.decodeConfig(liveEntry.config).provider).toBeUndefined();
    ui.assertConsumed();
  });

  it("keeps verified routing when a missing-key connection is saved as a new additive instance", async () => {
    const original = {
      driver: "openai-compat", displayName: "Pinned OpenRouter",
      config: { url: "https://openrouter.ai/api/v1", provider: "fireworks", model: "old-model" },
    };
    persist({ instances: { pinned: original } });
    const deps = dependencies();
    const ui = prompts({ choices: [3, 0], secrets: ["fixture-new-key"], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(ui.io.secret).toHaveBeenCalledTimes(1);
    expect(deps.verify).toHaveBeenCalledWith("https://openrouter.ai/api/v1", "fixture-new-key", "fixture-default", "fireworks");
    const saved = loadConfig();
    const id = saved.defaultModelSelection!.instanceId;
    expect(id).toMatch(/^api-[\da-f]{8}$/);
    expect(saved.instances?.pinned).toEqual(original);
    expect(saved.instances?.[id]?.config).toEqual({
      url: "https://openrouter.ai/api/v1", key: "fixture-new-key", model: "fixture-default", provider: "fireworks",
    });
    expect(OpenAICompatDriver.decodeConfig(instanceConfigs(saved)[id]!.config).provider).toBe("fireworks");
    ui.assertConsumed();
  });

  it("adds a verified connection without changing existing credentials, bots or conversations", async () => {
    const existing = {
      defaultModelSelection: { instanceId: "oldApi", model: "old-model" },
      instances: { oldApi: { driver: "openai-compat", config: { url: "https://old.example.test/v1", key: "old-secret", model: "old-model" } } },
      openaiCompat: { key: "workspace-secret", url: "https://workspace.example.test/v1" },
      xai: { key: "xai-secret" }, profile: { name: "Ada" }, futureSetting: { keep: true },
    };
    persist(existing);
    const sentinel = '[{"id":"existing-bot","modelSelection":{"instanceId":"oldApi","model":"old-model"}}]';
    const transcript = '[{"role":"user","text":"Existing conversation"}]';
    writeFileSync(join(DATA_DIR, "bots.json"), sentinel);
    writeFileSync(join(DATA_DIR, "messages-existing-thread.json"), transcript);
    const deps = dependencies();
    const ui = prompts({ choices: [2, 0, 1], secrets: ["  new-fixture-secret  "], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);

    expect(deps.models).toHaveBeenCalledWith("https://api.openai.com/v1", "new-fixture-secret");
    expect(deps.verify).toHaveBeenCalledWith("https://api.openai.com/v1", "new-fixture-secret", "fixture-selected");
    expect(ui.io.confirm.mock.calls[0]?.[0]).toMatch(/may charge/);
    expect(ui.io.confirm.mock.invocationCallOrder[0]).toBeLessThan(deps.verify.mock.invocationCallOrder[0]!);
    expect(deps.verify.mock.invocationCallOrder[0]).toBeLessThan(ui.io.confirm.mock.invocationCallOrder[1]!);
    const saved = JSON.parse(readFileSync(configPath, "utf8"));
    const id = saved.defaultModelSelection.instanceId;
    expect(id).toMatch(/^api-[\da-f]{8}$/);
    expect(saved.defaultModelSelection).toEqual({ instanceId: id, model: "fixture-selected" });
    expect(saved.instances.oldApi).toEqual(existing.instances.oldApi);
    expect(saved.instances[id]).toMatchObject({ driver: "openai-compat", config: { url: "https://api.openai.com/v1", key: "new-fixture-secret", model: "fixture-selected" } });
    expect(saved).toMatchObject({ openaiCompat: existing.openaiCompat, xai: existing.xai, profile: existing.profile, futureSetting: existing.futureSetting });
    expect(readFileSync(join(DATA_DIR, "bots.json"), "utf8")).toBe(sentinel);
    expect(readFileSync(join(DATA_DIR, "messages-existing-thread.json"), "utf8")).toBe(transcript);
    expect(ui.lines.join("\n")).toMatch(/billed separately/);
    expect(ui.lines.join("\n")).toMatch(/plaintext/);
    expect(ui.lines.join("\n")).not.toContain("new-fixture-secret");
    if (process.platform !== "win32") expect(statSync(configPath).mode & 0o777).toBe(0o600);
    ui.assertConsumed();
  });

  it.each([{ confirms: [false], verified: false }, { confirms: [true, false], verified: true }])(
    "does not save when API confirmation is declined: $confirms",
    async ({ confirms, verified }) => {
      const original = persist({ profile: { name: "Keep" } });
      const deps = dependencies();
      const ui = prompts({ choices: [2, 1, 0], secrets: ["fixture-key"], confirms });
      expect(await runSetup(options, ui.io, deps)).toBe(false);
      expect(deps.verify).toHaveBeenCalledTimes(verified ? 1 : 0);
      expect(readFileSync(configPath, "utf8")).toBe(original);
      expectLeaseReleased();
    },
  );

  it("keeps existing settings after a failed completion check", async () => {
    const original = persist({ profile: { name: "Keep" }, defaultModelSelection: { instanceId: "codex", model: "original" } });
    const deps = dependencies();
    deps.verify.mockRejectedValue(new Error("API returned HTTP 401. Check the API key."));
    const ui = prompts({ choices: [2, 2, 0], secrets: ["fixture-key"], confirms: [true] });
    await expect(runSetup(options, ui.io, deps)).rejects.toThrow("HTTP 401");
    expect(readFileSync(configPath, "utf8")).toBe(original);
    expectLeaseReleased();
  });

  it("cancels hidden key entry without saving or contacting the provider", async () => {
    const deps = dependencies();
    const ui = prompts({ choices: [2, 0], secrets: [new SetupCancelled()] });
    expect(await runSetup(options, ui.io, deps)).toBe(false);
    expect(deps.models).not.toHaveBeenCalled();
    expect(deps.verify).not.toHaveBeenCalled();
    expect(existsSync(configPath)).toBe(false);
    expectLeaseReleased();
  });

  it("allows an exact model ID after a catalog failure and verifies it before saving", async () => {
    const deps = dependencies();
    deps.models.mockRejectedValue(new Error("The catalog is unavailable"));
    const ui = prompts({ choices: [2, 0, 0], secrets: ["fixture-key"], answers: [" manual-chat-model "], confirms: [true, true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.verify).toHaveBeenCalledWith("https://api.openai.com/v1", "fixture-key", "manual-chat-model");
    expect(loadConfig().defaultModelSelection?.model).toBe("manual-chat-model");
    ui.assertConsumed();
  });

  it("reuses an API connection without changing its endpoint or key and preselects the saved model", async () => {
    const deps = dependencies();
    const first = prompts({ choices: [2, 0, 1], secrets: ["fixture-first-key"], confirms: [true, true] });
    expect(await runSetup(options, first.io, deps)).toBe(true);
    const before = loadConfig();
    const priorId = before.defaultModelSelection!.instanceId;
    const prior = before.instances![priorId]!;
    // The explicit saved fleet has Codex, Claude, OpenAI-compatible, then
    // this newly added API connection in the existing-connections list.
    const existingIds = Object.entries(before.instances!).filter(([, entry]) =>
      ["codex", "claudeAgent", "openai-compat"].includes(entry.driver) && entry.enabled !== false).map(([id]) => id);
    const chosen = existingIds.indexOf(priorId) + 3;
    const second = prompts({ choices: [chosen, 0], confirms: [true, true] });
    expect(await runSetup(options, second.io, deps)).toBe(true);
    expect(second.io.choose.mock.calls[0]?.[2]).toBe(chosen);
    expect(second.io.choose.mock.calls[1]?.[2]).toBe(1);
    expect(second.io.secret).not.toHaveBeenCalled();
    expect(loadConfig().instances?.[priorId]).toEqual({
      ...prior, config: { ...(prior.config as Record<string, unknown>), model: "fixture-default" },
    });
    expect(Object.keys(loadConfig().instances!)).toEqual(Object.keys(before.instances!));
    expect(loadConfig().defaultModelSelection?.instanceId).toBe(priorId);
    expect(loadConfig().defaultModelSelection?.model).toBe("fixture-default");
    expect(deps.verify).toHaveBeenLastCalledWith("https://api.openai.com/v1", "fixture-first-key", "fixture-default");
    second.assertConsumed();
  });

  it("searches beyond the first model page and saves an exact selected ID", async () => {
    const deps = dependencies();
    const catalog = Array.from({ length: 25 }, (_, index) => ({ id: `fixture-model-${index}`, label: `Model ${index}` }));
    deps.models.mockResolvedValue(catalog);
    const ui = prompts({ choices: [2, 0, 20, 0], secrets: ["fixture-key"], answers: ["fixture-model-24"], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(deps.verify).toHaveBeenCalledWith("https://api.openai.com/v1", "fixture-key", "fixture-model-24");
    expect(loadConfig().defaultModelSelection?.model).toBe("fixture-model-24");
    ui.assertConsumed();
  });

  it("keeps a saved model beyond the first page selected when accepting the default", async () => {
    persist({
      instances: { api: { driver: "openai-compat", config: { url: "https://api.example.test/v1", key: "fixture-key", model: "fixture-model-24" } } },
      defaultModelSelection: { instanceId: "api", model: "fixture-model-24" },
    });
    const deps = dependencies();
    deps.models.mockResolvedValue(Array.from({ length: 25 }, (_, index) => ({ id: `fixture-model-${index}`, label: `Model ${index}` })));
    const ui = prompts({ confirms: [true, true] });
    ui.io.choose.mockImplementation(async (question, available, defaultIndex) => {
      if (question.startsWith("1/3")) return 3;
      expect(defaultIndex).toBeDefined();
      expect(available[defaultIndex!]).toContain("fixture-model-24");
      return defaultIndex!;
    });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(loadConfig().defaultModelSelection).toEqual({ instanceId: "api", model: "fixture-model-24" });
    expect(deps.verify).toHaveBeenCalledWith("https://api.example.test/v1", "fixture-key", "fixture-model-24");
    ui.assertConsumed();
  });

  it("does not borrow another API connection's selected default model", async () => {
    persist({
      instances: {
        primary: { driver: "openai-compat", config: { url: "https://primary.example.test/v1", key: "primary-key", model: "fixture-selected" } },
        secondary: { driver: "openai-compat", config: { url: "https://secondary.example.test/v1", key: "secondary-key", model: "fixture-default" } },
      },
      defaultModelSelection: { instanceId: "primary", model: "fixture-selected" },
    });
    const deps = dependencies();
    const ui = prompts({ choices: [4, 0], confirms: [true, true] });
    expect(await runSetup(options, ui.io, deps)).toBe(true);
    expect(ui.io.choose.mock.calls[1]?.[2]).toBe(0);
    expect(deps.verify).toHaveBeenCalledWith("https://secondary.example.test/v1", "secondary-key", "fixture-default");
    expect(loadConfig().defaultModelSelection).toEqual({ instanceId: "secondary", model: "fixture-default" });
    ui.assertConsumed();
  });
});

describe("setup state and write boundaries", () => {
  it("requires a saved selection belonging to an enabled configured or built-in instance", async () => {
    expect(await isSetupComplete(DATA_DIR)).toBe(false);
    persist({ defaultModelSelection: { instanceId: "codex", model: "fixture" } });
    expect(await isSetupComplete(DATA_DIR)).toBe(true);
    persist({ defaultModelSelection: { instanceId: "missing", model: "fixture" } });
    expect(await isSetupComplete(DATA_DIR)).toBe(false);
    persist({ instances: { codex: { driver: "codex", enabled: false } }, defaultModelSelection: { instanceId: "codex", model: "fixture" } });
    expect(await isSetupComplete(DATA_DIR)).toBe(false);
    persist({ instances: { custom: { driver: "openai-compat" } }, defaultModelSelection: { instanceId: "custom", model: "fixture" } });
    expect(await isSetupComplete(DATA_DIR)).toBe(true);
  });

  it.each(["toString", "constructor", "__proto__"])("does not count inherited object property %s as a saved instance", async (instanceId) => {
    persist({ defaultModelSelection: { instanceId, model: "fixture" } });
    expect(await isSetupComplete(DATA_DIR)).toBe(false);
  });

  it.each(["{broken JSON", '{"instances":{"codex":{"driver":42}}}'])("refuses an unreadable existing configuration: %s", async (raw) => {
    writeFileSync(configPath, raw);
    const ui = prompts();
    const deps = dependencies();
    await expect(runSetup(options, ui.io, deps)).rejects.toThrow("Existing config.json");
    await expect(isSetupComplete(DATA_DIR)).rejects.toThrow("Existing config.json");
    expect(readFileSync(configPath, "utf8")).toBe(raw);
    expect(ui.io.choose).not.toHaveBeenCalled();
    expect(deps.inspect).not.toHaveBeenCalled();
    expectLeaseReleased();
  });

  it("refuses setup while another owner holds the data directory", async () => {
    const original = persist({ profile: { name: "Active app" } });
    const held = acquireDataDirLease(DATA_DIR);
    try {
      const ui = prompts();
      const deps = dependencies();
      await expect(runSetup(options, ui.io, deps)).rejects.toThrow(/already using this data directory/);
      expect(ui.io.choose).not.toHaveBeenCalled();
      expect(deps.inspect).not.toHaveBeenCalled();
      expect(readFileSync(configPath, "utf8")).toBe(original);
    } finally { held.release(); }
    expectLeaseReleased();
  });
});
