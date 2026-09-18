import { useEffect, useRef, useState, type AnchorHTMLAttributes, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { Download, FileText, LoaderCircle, X } from "lucide-react";
import { openExternalLink } from "@/lib/app-links";
import { attachmentBasename } from "@/lib/composer-attachments";
import { useLocalFileSave, type MessageAttachmentContext } from "./AttachmentPreview";

/** Normal anchors still support copy/middle-click; desktop clicks use the
 * explicit shell bridge, whose failures are visible instead of disappearing. */
export function ExternalArtifactLink({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) {
  const [error, setError] = useState(false);
  return <>
    <a {...props} target="_blank" rel="noreferrer" onClick={(event) => {
      if (!props.href || !window.ogb?.openExternal || event.ctrlKey || event.metaKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      setError(false);
      const href = props.href.startsWith("//") ? `https:${props.href}` : props.href;
      void openExternalLink(href).catch(() => setError(true));
    }}>{children}</a>
    {error && <span role="alert" className="ms-1 text-xs text-danger">Could not open link. Click to retry or copy the link.</span>}
  </>;
}

export function artifactPreviewKind(path: string): "image" | "pdf" | "html" | "text" | null {
  const extension = path.split(/[?#]/, 1)[0]?.split(".").at(-1)?.toLowerCase();
  if (/^(png|jpe?g|gif|webp|avif|bmp|svg)$/.test(extension ?? "")) return "image";
  if (extension === "pdf") return "pdf";
  if (extension === "html" || extension === "htm") return "html";
  if (/^(txt|md|csv|tsv|json|log|xml|ya?ml|py|js|ts|css)$/.test(extension ?? "")) return "text";
  return null;
}

function ArtifactDialog({ filePath, message, onClose }: {
  filePath: string; message: MessageAttachmentContext; onClose: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const [result, setResult] = useState<{ url: string; text?: string }>();
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);
  const save = useLocalFileSave(filePath, undefined, message);
  const name = attachmentBasename(filePath);
  const kind = artifactPreviewKind(filePath);
  useEffect(() => { dialog.current?.showModal(); }, []);
  useEffect(() => {
    const controller = new AbortController();
    let objectUrl: string | undefined;
    setResult(undefined);
    setError("");
    void (async () => {
      const response = await fetch(`/api/threads/${encodeURIComponent(message.threadId)}/messages/${encodeURIComponent(message.messageId)}/file`, {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: filePath }), signal: controller.signal,
      });
      if (!response.ok) {
        const body = await response.json().catch(() => null) as { error?: string } | null;
        throw new Error(body?.error ?? "Could not open file");
      }
      const blob = await response.blob();
      const text = kind === "html" || kind === "text" ? await blob.text() : undefined;
      if (controller.signal.aborted) return;
      objectUrl = URL.createObjectURL(blob);
      setResult({ url: objectUrl, text });
    })().catch((error: unknown) => {
      if (!controller.signal.aborted) setError(error instanceof Error ? error.message : "Could not open file");
    });
    return () => { controller.abort(); if (objectUrl) URL.revokeObjectURL(objectUrl); };
  }, [filePath, message.threadId, message.messageId, kind, attempt]);

  return createPortal(<dialog ref={dialog} aria-label={`Preview ${name}`} onCancel={onClose}
    onClick={(event) => { if (event.target === event.currentTarget) onClose(); }}
    className="m-auto h-[85vh] w-[min(1100px,92vw)] max-w-none rounded-2xl border border-hairline bg-panel p-0 text-ink shadow-2xl backdrop:bg-black/65">
    <div className="flex h-full flex-col">
      <header className="flex items-center gap-3 border-b border-hairline px-4 py-3">
        <FileText size={18} /><span className="min-w-0 flex-1 truncate text-sm font-medium">{name}</span>
        <button type="button" title="Save a copy" disabled={save.state === "saving"} onClick={() => void save.save()} className="rounded-lg p-2 hover:bg-inset" aria-label={`Download ${name}`}><Download size={18} /></button>
        <button type="button" onClick={onClose} className="rounded-lg p-2 hover:bg-inset" aria-label="Close file preview"><X size={18} /></button>
      </header>
      {save.state === "failed" && <p role="alert" className="px-4 text-sm text-danger">{save.reason}</p>}
      {error ? <div role="alert" className="m-auto p-6 text-center"><p>{error}</p><button type="button" className="mt-3 text-accent underline" onClick={() => setAttempt((value) => value + 1)}>Retry</button></div>
        : !result ? <div role="status" className="m-auto flex items-center gap-2"><LoaderCircle className="animate-spin" size={18} />Loading file…</div>
          : kind === "image" ? <img src={result.url} alt={name} className="min-h-0 flex-1 object-contain p-4" onError={() => setError("This image could not be loaded.")} />
            : kind === "html" ? <iframe title={name} sandbox="" referrerPolicy="no-referrer" className="min-h-0 flex-1 border-0 bg-white" srcDoc={`<meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src data: blob: https: http:; style-src 'unsafe-inline'; font-src data:; form-action 'none'; base-uri 'none'">${result.text ?? ""}`} />
              : kind === "pdf" ? <iframe title={name} src={result.url} className="min-h-0 flex-1 border-0 bg-white" />
                : <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 text-sm">{result.text}</pre>}
    </div>
  </dialog>, document.body);
}

/** Files stay message-scoped: opening and saving share the same server
 * authorization and containment checks. No raw host path becomes a URL. */
export function LocalArtifactLink({ filePath, message, children }: {
  filePath: string; message?: MessageAttachmentContext; children?: ReactNode;
}) {
  const [open, setOpen] = useState(false);
  const save = useLocalFileSave(filePath, undefined, message);
  const previewable = artifactPreviewKind(filePath) !== null;
  if (!message) return <span title="Unavailable legacy file reference" className="break-words text-ink-secondary">{children}</span>;
  return <span dir="ltr" className="inline-flex flex-wrap items-center gap-x-1.5 [unicode-bidi:isolate]">
    <button type="button" title={previewable ? "Open file preview" : "Save a copy"}
      disabled={!previewable && save.state === "saving"}
      onClick={() => { if (previewable) setOpen(true); else void save.save(); }}
      className="inline-flex items-center gap-1 break-words text-start text-accent underline decoration-accent/40 hover:decoration-accent">
      {children}{previewable ? <FileText size={12} /> : <Download size={12} />}
    </button>
    {previewable && <button type="button" title="Save a copy" aria-label={`Download ${attachmentBasename(filePath)}`} disabled={save.state === "saving"} onClick={() => void save.save()} className="p-1 text-ink-secondary hover:text-accent"><Download size={13} /></button>}
    {save.state !== "idle" && <span role={save.state === "failed" ? "alert" : "status"} className="text-xs">{save.state === "failed" ? save.reason : save.state === "saving" ? "Saving…" : "Saved"}</span>}
    {open && <ArtifactDialog filePath={filePath} message={message} onClose={() => setOpen(false)} />}
  </span>;
}
