import { useState } from "react";
import { useFetcher } from "react-router";
import { Lock, NotebookPen } from "lucide-react";
import { Button } from "~/components/ui/button";
import { Card, CardContent } from "~/components/ui/card";
import { Textarea } from "~/components/ui/textarea";
import { describeNoteDraft, MAX_NOTE_LENGTH } from "~/modules/lesson-note";
import { cn, formatRelativeTime } from "~/lib/utils";

export type SavedNote = { body: string; updatedAt: string } | null;

/** Drawn in the same card language as the Questions & Discussion thread. */
export function LessonNote({ note }: { note: SavedNote }) {
  const fetcher = useFetcher<{ ok: boolean; error?: string }>();
  const [draft, setDraft] = useState(note?.body ?? "");
  const isSaving = fetcher.state !== "idle";
  const error = fetcher.data?.error;
  const state = describeNoteDraft(draft, note?.body);

  return (
    <Card className="mb-8 py-0">
      <CardContent className="p-6">
        <LessonNoteHeader />

        <fetcher.Form method="post" className="space-y-2">
          <input type="hidden" name="intent" value="save-note" />
          <Textarea
            name="body"
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            placeholder="Key ideas, questions to come back to, code to try..."
            aria-label="Your notes"
            className="min-h-32 resize-y"
          />
          <div className="flex items-center gap-3">
            <Button
              type="submit"
              size="sm"
              disabled={isSaving || !state.canSave}
            >
              {isSaving ? "Saving..." : "Save note"}
            </Button>
            <NoteStatus
              error={error}
              dirty={state.dirty}
              updatedAt={note?.updatedAt}
            />
            <span
              className={cn(
                "ml-auto text-xs",
                state.tooLong ? "text-destructive" : "text-muted-foreground"
              )}
            >
              {state.length.toLocaleString("en")} /{" "}
              {MAX_NOTE_LENGTH.toLocaleString("en")}
            </span>
          </div>
        </fetcher.Form>
      </CardContent>
    </Card>
  );
}

function LessonNoteHeader() {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <div className="flex items-center gap-2">
          <NotebookPen className="size-5 text-primary" />
          <h2 className="text-xl font-semibold">Your notes</h2>
        </div>
        <p className="mt-1 text-sm text-muted-foreground">
          Jot down what you want to remember while you watch.
        </p>
      </div>
      <span className="flex shrink-0 items-center gap-1 rounded-full border px-2.5 py-0.5 text-xs text-muted-foreground">
        <Lock className="size-3" />
        Only you
      </span>
    </div>
  );
}

function NoteStatus({
  error,
  dirty,
  updatedAt,
}: {
  error: string | undefined;
  dirty: boolean;
  updatedAt: string | undefined;
}) {
  if (error) return <span className="text-sm text-destructive">{error}</span>;
  if (dirty) {
    return (
      <span className="text-xs text-muted-foreground">Unsaved changes</span>
    );
  }
  if (!updatedAt) return null;
  return (
    <span suppressHydrationWarning className="text-xs text-muted-foreground">
      Saved {formatRelativeTime(updatedAt)}
    </span>
  );
}
