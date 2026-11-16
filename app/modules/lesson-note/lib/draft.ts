export type NoteDraftState = {
  /** Length of what would be saved: the server trims the body first. */
  length: number;
  tooLong: boolean;
  empty: boolean;
  /** Saving the draft would change the stored note. */
  dirty: boolean;
  canSave: boolean;
};

export function describeDraft(
  draft: string,
  savedBody: string,
  maxLength: number
): NoteDraftState {
  const trimmed = draft.trim();
  const length = trimmed.length;
  const tooLong = length > maxLength;
  const empty = length === 0;
  const dirty = trimmed !== savedBody;
  return {
    length,
    tooLong,
    empty,
    dirty,
    canSave: dirty && !empty && !tooLong,
  };
}
