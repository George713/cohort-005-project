import { describe, it, expect } from "vitest";
import { describeNoteDraft, MAX_NOTE_LENGTH } from "../index";

describe("describeNoteDraft", () => {
  it("cannot save an empty first note", () => {
    expect(describeNoteDraft("", null)).toEqual({
      length: 0,
      tooLong: false,
      empty: true,
      dirty: false,
      canSave: false,
    });
  });

  it("treats a whitespace-only draft as empty", () => {
    const state = describeNoteDraft("   \n ", null);
    expect(state.empty).toBe(true);
    expect(state.canSave).toBe(false);
  });

  it("ignores surrounding whitespace, which the server trims on save", () => {
    const state = describeNoteDraft("  Result types \n", "Result types");
    expect(state.length).toBe(12);
    expect(state.dirty).toBe(false);
    expect(state.canSave).toBe(false);
  });

  it("does not count surrounding whitespace against the limit", () => {
    const state = describeNoteDraft(` ${"a".repeat(MAX_NOTE_LENGTH)} `, null);
    expect(state.tooLong).toBe(false);
    expect(state.canSave).toBe(true);
  });

  it("can save a new draft", () => {
    expect(describeNoteDraft("Result types", undefined)).toEqual({
      length: 12,
      tooLong: false,
      empty: false,
      dirty: true,
      canSave: true,
    });
  });

  it("has nothing to save when the draft matches the saved note", () => {
    const state = describeNoteDraft("Result types", "Result types");
    expect(state.dirty).toBe(false);
    expect(state.canSave).toBe(false);
  });

  it("can save an edit to a saved note", () => {
    const state = describeNoteDraft("Result types!", "Result types");
    expect(state.dirty).toBe(true);
    expect(state.canSave).toBe(true);
  });

  it("allows a draft exactly at the limit", () => {
    const state = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH), null);
    expect(state.tooLong).toBe(false);
    expect(state.canSave).toBe(true);
  });

  it("refuses a draft over the limit", () => {
    const state = describeNoteDraft("a".repeat(MAX_NOTE_LENGTH + 1), null);
    expect(state.length).toBe(MAX_NOTE_LENGTH + 1);
    expect(state.tooLong).toBe(true);
    expect(state.canSave).toBe(false);
  });
});
