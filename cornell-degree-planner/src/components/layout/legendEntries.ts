/** One entry per state in the spec-006/007 model, mirroring the course card's
 *  rail/tint tokens (spec 014 D2: the status legend lives in the top bar). */
export const LEGEND_ENTRIES: { label: string; color: string }[] = [
  { label: "Completed", color: "bg-complete" },
  { label: "In progress", color: "bg-drop" },
  { label: "Waived", color: "bg-waived" },
  { label: "Available", color: "bg-ink-4" },
  { label: "Blocked — needs prereqs", color: "bg-destructive" },
  { label: "Warning — term or credits", color: "bg-available" },
  { label: "Advisory — may be satisfied by credit", color: "bg-ink-3" },
  { label: "Overlap — credit for only one", color: "border-[1.5px] border-available bg-transparent" },
];
