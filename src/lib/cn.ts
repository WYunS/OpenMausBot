import { clsx, type ClassValue } from "clsx";
import { extendTailwindMerge } from "tailwind-merge";

// Custom sizes are otherwise interpreted as colours and removed beside text-ink.
const twMerge = extendTailwindMerge({ extend: { theme: {
  text: ["ui-caption", "ui-small", "ui-base", "ui-body"],
} } });

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
