type PointerDownEvent = { stopPropagation(): void };
type ClickEvent = PointerDownEvent & { preventDefault(): void };

/** Keep the dialog alive for the complete physical click. Electron can route
 * mouse-up to the surface underneath when a mouse-down handler unmounts a
 * modal, which makes an otherwise visible close button feel intermittent. */
export function botSettingsCloseHandlers(close: () => void) {
  let closedByPointer = false;
  return {
    onPointerDown(event: PointerDownEvent): void {
      event.stopPropagation();
    },
    onPointerUp(event: ClickEvent): void {
      event.preventDefault();
      event.stopPropagation();
      closedByPointer = true;
      close();
    },
    onClick(event: ClickEvent): void {
      event.preventDefault();
      event.stopPropagation();
      if (closedByPointer) return;
      close();
    },
  };
}
