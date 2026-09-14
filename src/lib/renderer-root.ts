export interface RendererRoot {
  unmount(): void;
}

type RendererRootContainer = HTMLElement & {
  __openMausBotRendererRoot?: RendererRoot;
};

/**
 * Own the single React root allowed in the renderer container.
 *
 * Vite normally disposes the previous entry module before evaluating its
 * replacement, but a failed/invalidated update can skip that callback. Store
 * ownership on the DOM node (which survives module replacement) so the next
 * generation can still evict a leaked App before mounting itself.
 */
export function claimRendererRoot<T extends RendererRoot>(
  rawContainer: HTMLElement,
  create: (container: HTMLElement) => T,
): { root: T; dispose(): void } {
  const container = rawContainer as RendererRootContainer;
  container.__openMausBotRendererRoot?.unmount();

  const root = create(container);
  container.__openMausBotRendererRoot = root;

  return {
    root,
    dispose() {
      if (container.__openMausBotRendererRoot !== root) return;
      delete container.__openMausBotRendererRoot;
      root.unmount();
    },
  };
}
