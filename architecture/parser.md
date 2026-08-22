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

## `/` is the section identifier (owner rulings 2026-08-21 / 2026-08-22)

`sectionId` is a **one-per-task, exclusive, ordered container** in `pp-sections` — deliberately not a
`@tag` (see `tasksBySection`). So `/` is exclusive assignment: a second `/` in one title is not a second
section, it is a loser left in the text.

**Tokenising.** `/` opens a section token only when it is preceded by whitespace or start-of-string
**and** followed by a letter. That one rule kills `3/4`, `docs/README`, `and/or` and every URL at once,
with no allow-list to maintain and nothing to keep in step with the date grammar.

**Matching is greedy but SHORTEST-first.** With `Deep work` and `Deep work planning` both defined,
longest-first lets the token reach a word further and start competing with the date parser;
shortest-first stops at the first complete section name, so `/deep work friday` files under *Deep work*
and still hands `friday` to chrono. The pass runs **before** chrono for exactly this reason.

The accepted cost is that typing the longer name in full *still* resolves to the shorter one, with the
extra words left in the title. `sectionCompletions` / `completeSectionToken` are therefore part of the
feature and not a nicety: **Tab** (and **↓**) cycle the token through every name that extends it,
shortest first, wrapping at the end. Tab rewrites only the token span, and it also **pins** the chosen
id (`matchSectionToken`'s `preferId`, reaching the parser as `opts.sectionPick`) — rewriting the text
alone would change nothing, since shortest-first would re-resolve it to the shorter name.

**An unmatched name is never auto-created.** Section *order* drives timeline block hue (`sectionHue`),
so a typo would repaint real work. The parser returns `sectionOffer` instead and quick-add renders a
create affordance; creating is one deliberate click, after which the same unchanged text files the task.

**Stripping** follows the same principle both ways: a match is consumed, an offer is not. And the section
token is the **one** token a *title edit* consumes (`stripSectionToken`, reading the parser's own span) —
the Task 16 argument for keeping recognised words rests on the highlight being the proof the word was
taken, and that proof does not survive the commit here, because the section chip is not on the row.

**On a subtask it is a no-op**, consumed quietly: only roots carry `sectionId` and a subtree inherits its
root's, so stamping the field would persist something nothing ever reads.

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
