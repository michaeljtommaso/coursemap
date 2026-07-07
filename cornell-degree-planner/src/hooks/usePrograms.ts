import { useProgramContext } from "@/contexts/ProgramProvider";
import type { Program } from "@/types/db";

/**
 * Thin hook over ProgramProvider. SAME signature as the Supabase-era hook —
 * { programs, loading, error, refetch } — so Phase 1's error-with-retry UI in
 * TopBar consumes it unchanged (docs/specs/002 §5). All Firestore access lives
 * in services/programs.ts; this just reads the provider's fetch-once list.
 */
export function usePrograms(): {
  programs: Program[];
  loading: boolean;
  error: Error | null;
  refetch: () => void;
} {
  const { programs, programsLoading, programsError, refetchPrograms } =
    useProgramContext();
  return {
    programs,
    loading: programsLoading,
    error: programsError,
    refetch: refetchPrograms,
  };
}
