import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { LogOut } from "lucide-react";
import { useAuth } from "@/contexts/AuthProvider";

/**
 * AccountMenu (spec 006 §C3, moved to the top bar) — the signed-in account
 * control: the Google avatar + first name, opening a small portal menu (the
 * CardOverflowMenu idiom — portal, fixed anchor, closes on Esc / outside-click
 * / scroll / resize) whose header shows displayName + email and whose one
 * action is Sign out behind a two-step inline confirm (the app idiom).
 * Anonymous users never see this — the top bar shows "Sign in" instead.
 */
export function AccountMenu() {
  const { user, firstName, signOut } = useAuth();

  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; right: number } | null>(null);
  const [confirmingSignOut, setConfirmingSignOut] = useState(false);
  const btnRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);

  useLayoutEffect(() => {
    if (!open || !btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    // Open DOWNWARD and right-aligned under the trigger (it lives in the top bar).
    setPos({ top: r.bottom + 6, right: window.innerWidth - r.right });
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const close = () => setOpen(false);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        btnRef.current?.focus();
      }
    };
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || btnRef.current?.contains(t)) return;
      setOpen(false);
    };
    window.addEventListener("scroll", close, true);
    window.addEventListener("resize", close);
    window.addEventListener("keydown", onKey);
    window.addEventListener("pointerdown", onDown, true);
    return () => {
      window.removeEventListener("scroll", close, true);
      window.removeEventListener("resize", close);
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("pointerdown", onDown, true);
    };
  }, [open]);

  const name = user?.displayName ?? firstName ?? "Your account";
  const email = user?.email ?? null;
  const photo = user?.photoURL ?? null;
  const initial = (firstName ?? name ?? "?").charAt(0).toUpperCase();

  return (
    <>
      <button
        ref={btnRef}
        onClick={() => {
          // Every open starts without the two-step sign-out confirm armed.
          if (!open) setConfirmingSignOut(false);
          setOpen(!open);
        }}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account: ${name}`}
        title="Signed in — your plan follows you"
        className="flex h-9 items-center gap-2 rounded-md border border-line bg-surface pl-1 pr-2.5 transition-colors hover:bg-surface-2"
      >
        <Avatar photo={photo} initial={initial} />
        <span className="max-w-[8rem] truncate t-label">{firstName ?? name}</span>
      </button>

      {open &&
        pos &&
        createPortal(
          <div
            ref={menuRef}
            role="menu"
            style={{ position: "fixed", top: pos.top, right: pos.right }}
            className="z-[var(--z-modal)] min-w-[208px] rounded-lg border border-line bg-surface p-1.5 shadow-xl"
          >
            <div className="flex items-center gap-2 px-1.5 py-1.5">
              <Avatar photo={photo} initial={initial} />
              <div className="flex min-w-0 flex-col">
                <span className="truncate t-body font-semibold">{name}</span>
                {email && <span className="truncate t-meta text-ink-4">{email}</span>}
              </div>
            </div>
            <div className="my-1 border-t border-line/60" />
            {confirmingSignOut ? (
              <div className="flex items-center gap-1.5 px-1 py-0.5">
                <button
                  role="menuitem"
                  onClick={async () => {
                    setOpen(false);
                    await signOut();
                  }}
                  className="flex-1 rounded-md bg-destructive-tint px-2 py-1.5 t-label text-destructive-text transition-colors hover:bg-destructive-text hover:text-destructive-tint"
                >
                  Sign out?
                </button>
                <button
                  onClick={() => setConfirmingSignOut(false)}
                  className="rounded-md px-2 py-1.5 t-label text-ink-3 transition-colors hover:bg-surface-2 hover:text-ink"
                >
                  Stay
                </button>
              </div>
            ) : (
              <button
                role="menuitem"
                onClick={() => setConfirmingSignOut(true)}
                className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left t-label text-ink-2 transition-colors hover:bg-surface-2 hover:text-ink"
              >
                <LogOut className="h-3.5 w-3.5" />
                Sign out
              </button>
            )}
          </div>,
          document.body
        )}
    </>
  );
}

/** Google avatar with a graceful initial fallback (no photo, or a load error). */
function Avatar({ photo, initial }: { photo: string | null; initial: string }) {
  const [broken, setBroken] = useState(false);
  if (photo && !broken) {
    return (
      <img
        src={photo}
        alt=""
        referrerPolicy="no-referrer"
        onError={() => setBroken(true)}
        className="h-7 w-7 shrink-0 rounded-full object-cover"
      />
    );
  }
  return (
    <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-drop-tint t-label text-drop-text">
      {initial}
    </span>
  );
}
