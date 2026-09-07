import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import { StringDecoder } from "node:string_decoder";

export interface SetupIo {
  log(line: string): void;
  ask(question: string): Promise<string>;
  secret(question: string): Promise<string>;
  choose(question: string, options: readonly string[], defaultIndex?: number): Promise<number>;
  confirm(question: string, defaultYes?: boolean): Promise<boolean>;
}

export class SetupCancelled extends Error {
  constructor() {
    super("Setup cancelled.");
    this.name = "SetupCancelled";
  }
}

type TerminalInput = Readable & {
  isTTY?: boolean;
  isRaw?: boolean;
  setRawMode?: (mode: boolean) => unknown;
};

function displayText(text: string, multiline = false): string {
  // These expressions deliberately remove terminal control characters.
  // eslint-disable-next-line no-control-regex
  const plain = text.replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, "");
  // eslint-disable-next-line no-control-regex
  return plain.replace(/[\u0000-\u001f\u007f-\u009f]/g, (character) => character === "\n" && multiline ? "\n" : " ");
}

/** Streams are injectable so prompt tests never read the user's terminal. */
export function defaultSetupIo(input: TerminalInput = process.stdin, output: Writable = process.stdout): SetupIo {
  const log = (line: string) => { output.write(`${displayText(line, true)}\n`); };
  const requireTerminal = () => {
    if (!input.isTTY || !input.setRawMode) throw new Error("Setup needs an interactive terminal.");
  };
  const restoreInput = (raw: boolean, flowing: boolean) => {
    input.setRawMode?.(raw);
    if (flowing) input.resume();
    else input.pause();
  };

  const ask = (question: string): Promise<string> => {
    requireTerminal();
    const raw = input.isRaw === true;
    const flowing = input.readableFlowing === true;
    return new Promise((resolve, reject) => {
      const rl = createInterface({ input, output, terminal: true });
      let finished = false;
      const restore = () => restoreInput(raw, flowing);
      const finish = (answer?: string, error?: Error) => {
        if (finished) return;
        finished = true;
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
        process.removeListener("exit", restore);
        input.removeListener("error", fail);
        input.removeListener("keypress", onKeypress);
        rl.close();
        restore();
        if (error) reject(error);
        else resolve(answer ?? "");
      };
      const cancel = () => finish(undefined, new SetupCancelled());
      const fail = (error: Error) => finish(undefined, error);
      const onKeypress = (_text: string, key: { sequence?: string }) => {
        if (key.sequence === "\u0004") cancel();
      };
      rl.once("SIGINT", cancel);
      rl.once("close", cancel);
      input.once("error", fail);
      input.on("keypress", onKeypress);
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      process.once("exit", restore);
      rl.question(displayText(question), (answer) => finish(answer));
    });
  };

  const secret = (question: string): Promise<string> => {
    requireTerminal();
    const raw = input.isRaw === true;
    const flowing = input.readableFlowing === true;
    return new Promise((resolve, reject) => {
      let value = "";
      let escape = "";
      let finished = false;
      const decoder = new StringDecoder("utf8");
      const restore = () => restoreInput(raw, flowing);
      const finish = (error?: Error) => {
        if (finished) return;
        finished = true;
        input.removeListener("data", onData);
        input.removeListener("end", cancel);
        input.removeListener("close", cancel);
        input.removeListener("error", fail);
        process.removeListener("SIGINT", cancel);
        process.removeListener("SIGTERM", cancel);
        process.removeListener("exit", restore);
        restore();
        output.write("\n");
        if (error) reject(error);
        else resolve(value);
        value = "";
      };
      const cancel = () => finish(new SetupCancelled());
      const fail = (error: Error) => finish(error);
      const onData = (chunk: Buffer | string) => {
        const text = typeof chunk === "string" ? chunk : decoder.write(chunk);
        for (const character of text) {
          if (character === "\u0003" || character === "\u0004") return cancel();
          // Ignore cursor keys and bracketed-paste markers, including markers
          // split across chunks. No input bytes are ever written to output.
          if (escape === "\u001b") {
            escape = character === "[" || character === "O" ? escape + character : "";
            continue;
          }
          if (escape) {
            if (/[@-~]/.test(character)) escape = "";
            continue;
          }
          if (character === "\u001b") escape = character;
          else if (character === "\r" || character === "\n") return finish();
          else if (character === "\u007f" || character === "\b") value = Array.from(value).slice(0, -1).join("");
          else if (character === "\u0015") value = "";
          else if (character >= " " && character !== "\u007f") value += character;
        }
      };
      input.on("data", onData);
      input.once("end", cancel);
      input.once("close", cancel);
      input.once("error", fail);
      process.once("SIGINT", cancel);
      process.once("SIGTERM", cancel);
      process.once("exit", restore);
      try {
        input.setRawMode!(true);
        output.write(displayText(question));
        input.resume();
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)));
      }
    });
  };

  const choose: SetupIo["choose"] = async (question, options, defaultIndex) => {
    if (!options.length) throw new Error("There are no choices available.");
    if (defaultIndex !== undefined && (!Number.isInteger(defaultIndex) || defaultIndex < 0 || defaultIndex >= options.length)) {
      throw new Error("The default choice is not available.");
    }
    log(displayText(question));
    options.forEach((option, index) => log(`  ${index + 1}. ${displayText(option)}${index === defaultIndex ? " (default)" : ""}`));
    while (true) {
      const answer = (await ask(`Choose 1–${options.length}${defaultIndex === undefined ? "" : ` [${defaultIndex + 1}]`}: `)).trim();
      if (!answer && defaultIndex !== undefined) return defaultIndex;
      const selected = /^\d+$/.test(answer) ? Number(answer) - 1 : -1;
      if (selected >= 0 && selected < options.length) return selected;
      log(`Enter a number from 1 to ${options.length}.`);
    }
  };

  const confirm: SetupIo["confirm"] = async (question, defaultYes = false) => {
    while (true) {
      const answer = (await ask(`${question} ${defaultYes ? "[Y/n]" : "[y/N]"}: `)).trim().toLowerCase();
      if (!answer) return defaultYes;
      if (answer === "y" || answer === "yes") return true;
      if (answer === "n" || answer === "no") return false;
      log("Enter yes or no.");
    }
  };

  return { log, ask, secret, choose, confirm };
}
