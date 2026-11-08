import { useEffect, useRef, useState, type RefObject } from "react";
import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface ShareLinkPanelProps {
  url: string;
  /** Retry the clipboard write; resolves true when it succeeded. */
  onCopy: () => Promise<boolean>;
  onClose: () => void;
  /** Element whose clicks should not count as "outside" (the Share control).
   *  Omit when an enclosing menu already handles outside clicks. */
  anchorRef?: RefObject<HTMLElement | null>;
  className?: string;
}

/**
 * ShareLinkPanel — shown when a share link was created but the browser would
 * not let the page write to the clipboard. Displays the link in a read-only,
 * pre-selected field so it can be copied by hand, with a Copy retry button.
 * Esc and a click outside close it.
 */
export function ShareLinkPanel({ url, onCopy, onClose, anchorRef, className }: ShareLinkPanelProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const [copied, setCopied] = useState<"idle" | "yes" | "no">("idle");

  useEffect(() => {
    inputRef.current?.focus();
    inputRef.current?.select();
  }, [url]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return;
      onClose();
      anchorRef?.current?.querySelector<HTMLElement>("button")?.focus();
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (panelRef.current?.contains(t) || anchorRef?.current?.contains(t)) return;
      if (anchorRef) onClose();
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [onClose, anchorRef]);

  const copy = async () => {
    const ok = await onCopy();
    setCopied(ok ? "yes" : "no");
    if (!ok) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  };

  return (
    <div
      ref={panelRef}
      role="dialog"
      aria-label="Share link"
      className={cn("rounded-lg border border-line bg-surface p-3 shadow-xl", className)}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <p className="t-label">Your link is ready</p>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          className="rounded-md p-1 text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <p className="mb-2 t-meta text-ink-3">
        Your browser blocked automatic copying. Copy the link below.
      </p>
      <div className="flex items-center gap-1.5">
        <input
          ref={inputRef}
          readOnly
          value={url}
          aria-label="Share link"
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-2 px-2 py-1.5 t-meta text-ink"
        />
        <Button type="button" size="sm" variant="outline" onClick={() => void copy()}>
          Copy
        </Button>
      </div>
      <p role="status" aria-live="polite" className="mt-1.5 min-h-[1rem] t-meta text-ink-3">
        {copied === "yes" ? "Link copied" : copied === "no" ? "Still blocked. Select the link and copy it." : ""}
      </p>
    </div>
  );
}
