import { z } from "zod";

export const MAX_NOTE_LENGTH = 2000;

/**
 * The one rule for a Note body: plain text, trimmed, and at most
 * MAX_NOTE_LENGTH characters. An over-long Note is refused, never truncated.
 * An empty body is allowed: saving the note box empty removes the Note.
 */
export const noteBodySchema = z
  .string()
  .trim()
  .max(
    MAX_NOTE_LENGTH,
    `Your note is over ${MAX_NOTE_LENGTH.toLocaleString("en")} characters, so it was not saved.`
  );
