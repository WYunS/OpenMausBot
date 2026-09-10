export const MUTATING_COMPUTER_TOOLS = new Set([
  "click", "double_click", "right_click", "drag", "invoke", "press_key", "hotkey", "scroll", "set_value", "type_text",
  "launch_app", "close_window", "maximize_window", "minimize_window", "restore_window", "bring_to_front", "open_url",
]);

export function computerToolLeafName(name: string | undefined): string | undefined {
  if (!name) return undefined;
  return name.toLowerCase().split("__").at(-1);
}

export function mutatingComputerTool(name: string | undefined): boolean {
  const leaf = computerToolLeafName(name);
  return leaf !== undefined && MUTATING_COMPUTER_TOOLS.has(leaf);
}
