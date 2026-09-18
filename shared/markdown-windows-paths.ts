import { fromMarkdown } from "mdast-util-from-markdown";

interface PathNode {
  type: string;
  url?: string;
  children?: PathNode[];
  position?: { start: { offset?: number }; end: { offset?: number } };
}

/** Windows filesystem separators are not Markdown punctuation escapes.
 * CommonMark consumes `\\.` in `User\\.openmausbot`, while the HTML bridge
 * percent-encodes the remaining backslashes and hides the drive from the URL
 * allow-list. Recover only destinations on already-parsed links/images and
 * definitions. Reparse their exact source span with portable separators, then
 * adopt only the destination; labels, titles and source offsets stay intact.
 * Both rendering and message-scoped file authorization must use this rule.
 */
export function restoreWindowsMarkdownPaths(tree: PathNode, text: string): void {
  const pending = [tree];
  while (pending.length) {
    const node = pending.pop()!;
    pending.push(...node.children ?? []);
    if (!node.url || !/^[a-z]:/i.test(node.url) || !["link", "image", "definition"].includes(node.type)) continue;
    const start = node.position?.start.offset;
    const end = node.position?.end.offset;
    if (start === undefined || end === undefined) continue;
    const source = text.slice(start, end);
    if (!source.includes("\\")) continue;
    const parsed: PathNode[] = [fromMarkdown(source.replace(/\\/g, "/"))];
    while (parsed.length) {
      const candidate = parsed.pop()!;
      if (candidate.type === node.type && candidate.position?.start.offset === 0 &&
          candidate.position.end.offset === source.length && /^[a-z]:\//i.test(candidate.url ?? "")) {
        node.url = candidate.url;
        break;
      }
      parsed.push(...candidate.children ?? []);
    }
  }
}

export function remarkWindowsPaths() {
  return (tree: PathNode, file: { value: unknown }) => restoreWindowsMarkdownPaths(tree, String(file.value));
}
