# Parser

`parseDateText` is the natural-language extraction and shaping entry point. The bundled
`chrono.min.js` is generated/minified and must not be opened unless its generation is the task. Parser
output is consumed by quick-add and can set `start`, `end`, clock intent, milestone/point shape, duration,
and recurrence.

V1.6 adds `matches:[{kind,start,end}]` to every `parseDateText` result. These are ordered, non-overlapping,
end-exclusive UTF-16 offsets over the original input. The same consuming passes that shape dates, times,
ranges, durations, recurrence, and repeat-until clauses claim the spans; priority, labels, milestone
markers, and ordinary title text never do. Parser preprocessing masks consumed source at the same length,
and `normalizeQuickMatches` validates and merges claims without a second natural-language pass.

`quickHighlightSegments` converts matches into lossless plain/highlighted text segments.
`renderQuickAddPopup` paints those segments in an `aria-hidden`, pointer-inert mirror behind the unchanged
native input. Mirror glyphs are transparent and React receives user text as text children, so the native
caret, selection, keyboard handlers, and task creation remain authoritative. Untimed parser anchors use
date-only hint formatting, while explicitly clocked values retain their time. The quick-add card has a
fixed viewport anchor so hints and ambiguity controls grow below the input without moving its edit row.

Track A introduced chrono-node extraction plus deterministic shaping. Track B added point correctness,
ambiguity selection, scheduling render shapes, and opt-in/opt-out behavior. Parser-owned task shapes must
stay consistent with Gantt and timeline rendering.

Known gap: R7 two-day windows (for example `start Mon due Fri`) remain an expected todo because the
current extraction path returns one date per line. Keep regression fixtures in `tests/quickadd.test.js`;
do not broaden cue matching without adversarial cases for title-word collisions and deadline/start
inversion.

A single bare number plus duration unit (`30m`, `1.5h`) is a movable budget only when it is the sole
temporal token. The parser masks that candidate before chrono extraction, then claims it only if no
date, clock, recurrence, or repeat-until token won; otherwise it restores the candidate as title text.
Unitless numbers and non-duration units remain ordinary text. The snooze parser accepts the same bare
form, but any snooze resolving to today is floored forward to tomorrow so a sub-day duration has an
observable effect.

## The title bar (owner 2026-08-20, Task 16)

Editing a task's title runs the same parser, through the same `shapeParsedTask` binding quick-add uses,
and writes the parsed fields and the new name in **one `commit()`** — one Ctrl+Z restores both. That much
shipped on 2026-08-17.

What Task 16 changed is what the title is left holding. **The recognised words stay.** Eating them is
right in quick-add, where you are turning a phrase into a task; a title edit is not that, and silently
deleting the word the user just typed reads as the app losing their text. The report is the
**highlight**: `titleHighlightSegments(text)` parses and segments in one call (the quick-add mirror is
handed an already-parsed `matches`; a title editor has only text), and the detail panel paints those
segments in an `aria-hidden`, pointer-inert mirror behind the contenteditable — the same technique and
the same treatment as the quick-add input.

Two things make a mirror work over a **contenteditable** rather than an input, and both are load-bearing:
the two layers carry identical metrics and `white-space: pre-wrap`, so a wrapped line breaks in the same
place; and `state.titleDraft` holds the live text while editing, because a contenteditable is uncontrolled
and React must never rewrite its children mid-edit (they stay `t.name` throughout, so the caret is safe).

The ambiguity chooser is the same one: a bare day with no cue is genuinely two readings, so the title
offers `[ On Fri | By Fri ]` and flipping re-applies the whole title through `rename`, keeping it one
commit. It shapes **dates only** — `shapeParsedTask` refuses to let a candidate tuple's `planned`
overwrite a duration the text itself gave, so "gym friday for 45m" keeps its 45 minutes under either
branch.
