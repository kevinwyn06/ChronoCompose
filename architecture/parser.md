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

## URLs are claimed first (owner ask 2026-09-09)

A URL is masked and filed as a **task link** before any other pass looks at the text, and the second
reason is the load-bearing one. A pasted link belongs with the task rather than in its name; and a URL is
full of digits, colons and slashes, so chrono read `/2019/03/07/` as a date and a port as a clock. A link
in a title used to invent a schedule. `normalizeLink` applies the scheme denylist here too, so a
`javascript:` URL never becomes a stored link, let alone an `href`.

## The repeat window in text (owner ruling 2026-09-09)

`shapeRecurWindow` is the last thing `shapeParsedTask` does, and it re-reads a parsed rule under the
series-window model (`architecture/scheduling.md`): a clock range is the OCCURRENCE, a day range is the
WINDOW, an `until` clause is the window's end. `recur.durMs` is written unconditionally so a freshly
parsed window can never reach `normalizeTask`'s legacy conversion and be re-read as one long occurrence.

Two supporting changes in `parseDateText` itself:

- the **day-range test runs ahead of the duration branch**, so "every wednesday from 1 Sep to 30 Sep for
  45m" states a window AND an occurrence length instead of letting the duration claim the end;
- a bare clock stranded beside a rule and a day range is the **occurrence's time of day**
  (`occClock`) — chrono binds one span at a time and usually swallows the clock into the range's own
  span, where only its END carries the certain hour. Without this the When line's own sentence for that
  shape failed to read back as itself and silently dropped the time.

## `/` is the section identifier (owner rulings 2026-08-21 / 2026-08-22)

`sectionId` is a **one-per-task, exclusive, ordered container** in `pp-sections` — deliberately not a
`@tag` (see `tasksBySection`). So `/` is exclusive assignment: a second `/` in one title is not a second
section, it is a loser left in the text.

**Tokenising.** `/` opens a section token only when it is preceded by whitespace or start-of-string
**and** followed by a letter. That one rule kills `3/4`, `docs/README`, `and/or` and every URL at once,
with no allow-list to maintain and nothing to keep in step with the date grammar.

**Matching is greedy, LONGEST-first** (owner ruling 2026-08-24, reversing 2026-08-22). The token means
what the words say. The pass runs **before** chrono.

The earlier ruling chose shortest-first to stop the token reaching a word further and competing with the
date parser. That fear does not survive the mechanics: matching is prefix-anchored at the `/` **and**
requires a word boundary after the name, so a longer name can only win where it was typed IN FULL. With
`Deep work` and `Deep work planning` both defined, `/deep work friday` still files under *Deep work* —
`Deep work planning` is not a prefix of it — and `friday` was never in the token's reach. **The shorter
name is never starved.** The two orders disagree on exactly one input, the longer name typed in full,
and shortest-first answered it wrong: it filed under the shorter section and stranded the surplus words
in the title.

`sectionCompletions` / `completeSectionToken` are part of the feature and not a nicety, and under
longest-first they reach in **both** directions. The list unions two families: every name that already
fits the text at this token (including the shorter ones longest-first outranked — the direction an
extensions-only list could not express, since the escape hatch is now shorter than what matched), and
every name that extends what is applied (the only family that exists when nothing matched and all there
is is an offer). Candidates come from `sectionNameFits`, the matcher's own boundary test, so Tab can
never offer a completion that would not actually file. The applied name is forced to index 0, so **Tab**
(and **↓**) always step away from what is in effect, wrapping at the end.

How much of the span a completion rewrites depends on the direction, and getting it wrong would delete
words the user typed. Completing to a name that already fits replaces only that name's own length, so
the surplus stays in the line as title text — `/Deep work planning friday` shortened to *Deep work*
reads back as `/Deep work planning friday`, with `planning` now part of the title, exactly as it did
under the old ruling. Completing to a name that does not fit yet is an extension, and there the whole
token is replaced. Tab also **pins** the chosen id (`matchSectionToken`'s `preferId`, reaching the
parser as `opts.sectionPick`): in the shortening direction the line still spells out the longer name, so
only the pin can carry the choice.

**An unmatched name is never auto-created.** Section *order* drives timeline block hue (`sectionHue`),
so a typo would repaint real work. The parser returns `sectionOffer` instead and quick-add renders a
create affordance; creating is one deliberate click, after which the same unchanged text files the task.

**Stripping** follows the same principle both ways: a match is consumed, an offer is not. And the section
token is the **one** token a *title edit* consumes (`stripSectionToken`, reading the parser's own span) —
the Task 16 argument for keeping recognised words rests on the highlight being the proof the word was
taken, and that proof does not survive the commit here, because the section chip is not on the row.

**On a subtask it is a no-op**, consumed quietly: only roots carry `sectionId` and a subtree inherits its
root's, so stamping the field would persist something nothing ever reads.

## Naming today's date means today (2026-08-24)

chrono's `forwardDate` rolls anything **not strictly after `now`** to its next occurrence. `now` is an
INSTANT; a written calendar date is a DAY. So `Aug 24` typed on the afternoon of Aug 24 implied midnight,
compared as already past, and rolled a **whole year**.

After chrono picks its result, the same span is re-read with `forwardDate:false`; if that lands on today,
today is what the user said. Matching on the span text means this can only ever correct the result chrono
already chose, and a genuinely past date still rolls forward exactly as before.

This was a live data-loss path, not a cosmetic misread, because it combined with the When line's no-op
guard — see below.

## The When line, and the title strip (owner rulings 2026-08-21)

Two rulings that had to land together. The owner rejected the recurrence panel — *"not a form"* — and
asked for a plain-text display of the date state that can be edited and re-parsed. Framed correctly it is
not a recurrence editor at all: it is the **same parser the title bar runs, round-tripped through
readable text instead of consumed once**.

`whenSentence(t)` is pure — task in, `{text, chip, sub, moved, empty, placeholder}` out — and it
**replaces Start, Due and Duration** in the detail panel, so one line has to state all three
unambiguously. The chip carries the one thing plain English states poorly, whether the task **reserves
time**; the sub-line carries what has no sentence form at all. Ruling 8: `Planned` is not repeated
outside the block, so it rides the sub-line and is edited by writing a duration into the sentence.

| Shape | Reads as | Chip |
|---|---|---|
| no date | *someday — add a date…* | — |
| bare day | `Fri 22 Aug` | `all day` |
| clocked start, no end, no budget | `Tue 26 Aug, 3:00pm` | `marker` |
| clocked start, no end, with a budget | `Tue 26 Aug, 3:00pm` | the budget (`45m`) |
| appointment | `Tue 26 Aug, 3:00–4:00pm` | its length (`1h`) |
| deadline | `by Fri 22 Aug` | `due` |
| repeat | `every weekday, from Mon 15 Jun to Wed 30 Sep, 9:00am` | `repeats` |

The fourth row is not in the mockup's six-shape table and was found by building it: a written start clock
with a budget is neither a Point nor a bare day, and rendering it as a bare day would make re-committing
the line discard the hour.

**The failure state is the case that justifies the approach.** A form cannot produce an unparseable
value; a text editor can. `applyWhenText` therefore never destroys what is stored: nothing is committed,
the input keeps the bad text, and the reason comes back as `error`. Two refusals are explicit rather than
best-effort — an unreadable string, and **`"N times"`**, because `recurToRRule` emits `UNTIL` and never
`COUNT`; converting a count to a date would silently rewrite what the user typed and go wrong the moment
the interval was edited. The refusal names what *can* be written.

`recur.overrides` has no text form, so moved occurrences are **counted, not sentenced** — writing them
into the string would make it lie about the rule, hiding them would make it lie about the series.

Two mechanics worth not re-deriving. The input is **uncontrolled**, which is what lets Escape's ladder
rung 0 work here with no second cancel path: rung 0 restores the focus-time value and blurs, the blur
re-applies the *original* sentence, and `applyWhenText` recognises that as a no-op. It has to be a real
no-op — `commit()` snapshots unconditionally, so committing an unchanged task would leave an undo entry
that undoes nothing. And a base-edge edit that crosses a calendar day clears `recur.overrides` /
`shifts`, the same rule `setDate` applies and for the same reason.

### The strip

The title bar now **consumes the words it parses**, reversing Task 16. That is not a change of mind about
Task 16's argument — it is the argument's premise expiring. *"The highlight is what says the date was
taken"* held only while the title was the one place a parsed date was visible. The When line makes it
visible **and editable** one line below, so the word **moves** rather than disappears. Ship the strip
before the line and there is a state where a date is applied, deleted from the title, and shown nowhere
editable — strictly worse than either ruling's status quo. Hence one branch.

And the strip fires **only when the parse changes the stored date**. It edits work that already exists,
so re-wording *"Move the friday deploy to staging"* must not pull `friday` out and reschedule the task; a
re-parse yielding the date the task already holds is not new information. The section token is the one
exception, consumed unconditionally — its chip is not on the row, so leaving it would read as un-acted-on.

The highlight mirror is unchanged and still matters: it is the live feedback *during* the edit. What
changed is only what survives the commit.

### The no-op guard is TEXT IDENTITY, not a comparison of parses (2026-08-24)

`applyWhenText` short-circuits when the submitted text is identical to the sentence the task currently
renders. It previously compared the **parse** of the submitted sentence against the task, which silently
assumed the When line round-trips — that reading back what the line prints reproduces the task it was
printed from.

It does not, and the seventh shape (a written start clock with no end plus a budget) was the warning. The
moment the parser disagreed with the printer, an unedited sentence looked like a real edit and was
committed. Escape's rung 0 is what made that destructive: it restores the field's focus-time value and
blurs, and the blur commits — so the **cancel** path re-submitted the line's own sentence. With the
`forwardDate` bug above, pressing Escape moved the task twelve months into the future and nulled its
`end`.

Both halves are fixed. The guard should never have depended on a perfect round-trip whatever the parser
does, and text identity needs no round-trip to hold: it covers every shape the sentence can take,
including the ones the parser cannot read back at all.

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

## The parser reads the TASK, not only the text (owner ask 2026-08-25)

`shapeParsedTask` is context-free — text in, task fields out — and every surface fed it text alone. That
made the title bar and the When line disagree about the same edit:

| surface | task before | typed | result |
|---|---|---|---|
| title bar | start 8:30pm | `deep work 45m` | planned 45, **end null** |
| When line | start 8:30pm | `Mon Jun 15, 8:30pm for 45m` | **end 9:15pm** |

Same parser, same shaping, opposite outcome — because the When line RESTATES the start in the text, so
the parse saw both sides. The shaping rule was never wrong; it was being applied to the text instead of
to the task.

`reconcileWhen(base, shaped, parsed)` is the one resolver that owns endpoint arithmetic. It is pure,
mutates neither argument, and `base` is how context reaches it. `shapeParsedTask` calls it with `null`,
so quick-add, the preview and the When line keep byte-identical behaviour; `rename` calls it with the
task.

**Absence is not deletion.** A side the text never mentions is retained from the task — which is what
makes `by 9:00pm` on a task starting 8:30pm mean the obvious thing. Retention is dropped whenever it
would INVERT the span (`by 8:00pm` on an 8:30pm start): `rename` has no error channel to refuse through,
so there the text wins and the task becomes the plain deadline that was typed. A recurrence rule is
retained on the same principle — a title naming no repeat is not an instruction to stop repeating, and
before this it silently cleared `recur`.

**A duration derives the missing endpoint, but only from a REAL INSTANT.** Both edges known, or neither,
and it stays the movable budget it always was. The test is the CLOCK FLAG, not merely a non-null edge: a
bare day is a container, so `gym friday for 45m` must never collapse into a 00:00–00:45 appointment. With
both edges already clocked a typed duration RESIZES from the start (owner's pick over storing a 90m
budget on a 60m block).

The clock flags are a **three-state** field — `true`, an explicit `false` the ambiguity chooser writes
for an unclocked EOD deadline, and `null` for "never asked". `reconcileWhen` passes them through
verbatim and only its own derivation tests read them as booleans; coercing falsy to null erased the
middle state on every parse, and two quick-add regressions caught it.

**Only the title bar merges.** The When line PRINTS the whole date state — which is what makes clearing
it mean "no dates" — so what it omits is a statement, not a silence. It is handed no base.

### A deadline cue plus a duration runs BACK from the clock

`hasSpan` (a clock plus a resolved end) is tested before the cue branch, so `write by 9pm for 2h` fell
into R3/R9 and emitted **9pm → 11pm**: a task starting at its own deadline and overrunning it by two
hours. When a `for <dur>` phrase supplied that end and the cue is a deadline, the clock is the END and
the start is derived backwards. An explicit clock RANGE is untouched — it states both edges itself, so
there is no missing endpoint to derive and nothing to reverse.
