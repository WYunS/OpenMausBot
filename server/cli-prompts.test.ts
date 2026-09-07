import { PassThrough } from "node:stream";
import { describe, expect, it, vi } from "vitest";
import { defaultSetupIo, SetupCancelled } from "./cli-prompts.ts";

function terminal(raw = false) {
  const input = Object.assign(new PassThrough(), {
    isTTY: true,
    isRaw: raw,
    setRawMode: vi.fn((enabled: boolean) => { input.isRaw = enabled; }),
  });
  input.pause();
  const output = new PassThrough();
  let text = "";
  output.on("data", (chunk) => { text += String(chunk); });
  return { input, io: defaultSetupIo(input, output), text: () => text };
}

describe("terminal setup prompts", () => {
  it("numbers choices, retries invalid input, and returns the selected index", async () => {
    const { input, io, text } = terminal();
    const selected = io.choose("Provider", ["Claude", "Codex"], 0);
    expect(text()).toContain("1. Claude (default)");
    expect(text()).toContain("2. Codex");
    input.write("9\r");
    await vi.waitFor(() => expect(text()).toContain("Enter a number from 1 to 2."));
    input.write("2\r");
    expect(await selected).toBe(1);
    expect(input.isRaw).toBe(false);
    expect(input.isPaused()).toBe(true);
  });

  it("accepts an empty answer for the default choice and confirmation", async () => {
    const { input, io } = terminal();
    const selected = io.choose("Model", ["First", "Second"], 1);
    input.write("\r");
    expect(await selected).toBe(1);
    const confirmed = io.confirm("Save?", true);
    input.write("\r");
    expect(await confirmed).toBe(true);
    const declined = io.confirm("Replace?");
    input.write("\r");
    expect(await declined).toBe(false);
  });

  it("does not execute terminal escapes from provider labels or prompt text", async () => {
    const { input, io, text } = terminal();
    io.log("Provider \u001b[31mred\u001b[0m\u0007");
    expect(text()).toBe("Provider red \n");
    const selected = io.choose("Model\u001b[2J", ["Untrusted\u001b[2J\nlabel"], 0);
    expect(text()).toContain("1. Untrusted label");
    input.write("\r");
    expect(await selected).toBe(0);
    const secret = io.secret("Key \u001b[2J\u0007: ");
    input.write("secret\r");
    await secret;
    // Readline emits its own cursor sequences, so inspect the labels and
    // secret prompt specifically rather than forbidding all terminal output.
    expect(text()).not.toContain("\u001b[2J");
    expect(text()).not.toContain("\u0007");
    expect(text()).not.toContain("secret");
  });

  it("never echoes a pasted key, including bracketed-paste markers split across chunks", async () => {
    const { input, io, text } = terminal();
    const secret = io.secret("API key: ");
    expect(input.isRaw).toBe(true);
    input.write("\u001b[20");
    input.write("0~sk-private-pasted-key\u001b[201~\r");
    expect(await secret).toBe("sk-private-pasted-key");
    expect(text()).toBe("API key: \n");
    expect(input.isRaw).toBe(false);
    expect(input.isPaused()).toBe(true);
    expect(input.listenerCount("data")).toBe(0);
  });

  it("supports corrections without echo and restores a terminal that was already raw", async () => {
    const { input, io, text } = terminal(true);
    const secret = io.secret("Key: ");
    input.write("mistake\u0015sk-secrex\u007ft\r");
    expect(await secret).toBe("sk-secret");
    expect(text()).toBe("Key: \n");
    expect(input.isRaw).toBe(true);
  });

  it.each(["\u0003", "\u0004"])("cancels hidden input on control character %j and restores the terminal", async (key) => {
    const { input, io, text } = terminal();
    const rejected = expect(io.secret("Key: ")).rejects.toBeInstanceOf(SetupCancelled);
    input.write(`sk-do-not-display${key}`);
    await rejected;
    expect(text()).toBe("Key: \n");
    expect(input.isRaw).toBe(false);
    expect(input.isPaused()).toBe(true);
    expect(input.listenerCount("data")).toBe(0);
  });

  it.each(["\u0003", "\u0004"])("cancels ordinary questions on control character %j", async (key) => {
    const { input, io } = terminal();
    const rejected = expect(io.ask("Account: ")).rejects.toBeInstanceOf(SetupCancelled);
    input.write(`partial${key}`);
    await rejected;
    expect(input.isRaw).toBe(false);
    expect(input.isPaused()).toBe(true);
  });

  it("restores raw mode and signal handlers when a secret read fails", async () => {
    const { input, io, text } = terminal();
    const sigint = process.listenerCount("SIGINT");
    const sigterm = process.listenerCount("SIGTERM");
    const rejected = expect(io.secret("Key: ")).rejects.toThrow("input disconnected");
    input.write("sk-private");
    input.emit("error", new Error("input disconnected"));
    await rejected;
    expect(input.isRaw).toBe(false);
    expect(process.listenerCount("SIGINT")).toBe(sigint);
    expect(process.listenerCount("SIGTERM")).toBe(sigterm);
    expect(text()).not.toContain("sk-private");
  });

  it("cancels a secret at end of input without accepting a partial key", async () => {
    const { input, io } = terminal();
    const rejected = expect(io.secret("Key: ")).rejects.toBeInstanceOf(SetupCancelled);
    input.end("partial");
    await rejected;
    expect(input.isRaw).toBe(false);
  });

  it("refuses secret entry without a terminal", () => {
    const { input, io, text } = terminal();
    input.isTTY = false;
    expect(() => io.secret("Key: ")).toThrow("interactive terminal");
    expect(text()).toBe("");
    expect(input.setRawMode).not.toHaveBeenCalled();
  });
});
