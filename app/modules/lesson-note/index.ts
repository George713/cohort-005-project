import { MAX_NOTE_LENGTH } from "~/lib/notes";
import { describeDraft, type NoteDraftState } from "./lib/draft";

export type { NoteDraftState };

/**
 * What the note editor shows about a draft: its length against the limit,
 * whether it has unsaved changes, and whether Save should be enabled.
 */
export function describeNoteDraft(
  draft: string,
  savedBody: string | null | undefined
): NoteDraftState {
  return describeDraft(draft, savedBody ?? "", MAX_NOTE_LENGTH);
}

export { MAX_NOTE_LENGTH };
