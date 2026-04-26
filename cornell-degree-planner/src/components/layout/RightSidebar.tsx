import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { CourseCatalog } from "@/components/catalog/CourseCatalog";

export function RightSidebar() {
  const [open, setOpen] = useState(false);

  return (
    <>
      {/* Backdrop — clicking it closes the panel */}
      <AnimatePresence>
        {open && (
          <motion.div
            key="backdrop"
            className="fixed inset-0 z-30"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => setOpen(false)}
          />
        )}
      </AnimatePresence>

      {/* Slide-in panel */}
      <motion.div
        className="fixed right-0 top-0 z-40 flex h-full"
        initial={false}
        animate={{ x: open ? 0 : 360 }}
        transition={{ type: "spring", stiffness: 300, damping: 30 }}
      >
        {/* Toggle tab */}
        <button
          onClick={() => setOpen((v) => !v)}
          className="relative -left-7 top-1/2 z-50 flex h-14 w-7 -translate-y-1/2 items-center justify-center rounded-l-xl border border-r-0 border-border bg-card text-muted-foreground shadow-md transition-colors hover:text-foreground"
          aria-label={open ? "Close panel" : "Open panel"}
        >
          {open ? <ChevronRight className="h-4 w-4" /> : <ChevronLeft className="h-4 w-4" />}
        </button>

        {/* Panel content */}
        <div className="flex h-full w-[360px] flex-col gap-4 overflow-y-auto border-l border-border bg-card p-4 shadow-xl">
          <CourseCatalog />
        </div>
      </motion.div>
    </>
  );
}
