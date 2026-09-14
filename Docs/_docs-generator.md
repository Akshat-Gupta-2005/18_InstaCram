# PROJECT DOCUMENTATION INSTRUCTIONS

## 0. PROJECT CONFIG — fill this in once, change nothing else

    PROJECT_NAME   = <name>
    PROJECT_GOAL   = <one sentence: what it does and who it is for>
    AUDIENCE       = <who reads these docs: recruiters / teammates / future me>
    STACK          = <languages, frameworks, key libraries>
    DOC_LOCATION   = <repo root, or docs/>
    STAR_LABEL     = <what a star marks, e.g. "interview bonus point">

Everything below refers to these values as {{PROJECT_NAME}}, {{PROJECT_GOAL}},
{{AUDIENCE}}, {{STACK}}, {{DOC_LOCATION}}, {{STAR_LABEL}}.

When you write the files, substitute the real values and leave no {{TOKEN}}
in the output. Never hardcode a project detail anywhere except section 0 of
this prompt.

---

You will create and maintain three markdown files in {{DOC_LOCATION}} for
{{PROJECT_NAME}}. Treat them as part of the work, not as an afterthought: a
change is not complete until the documentation reflects it.

The three files are split by how often they change:

    BUILD-PLAN.md   what we intend to do        rarely changes
    FEATURES.md     what is true right now      rewritten every session
    DECISIONS.md    why it ended up this way    append-only, never edited

Keeping them separate stops the plan being quietly rewritten to match
whatever happened, which is how project documentation usually dies.

---

## FILE 1 — BUILD-PLAN.md

The intent. Written once at project start. Amend only on a genuine change of
direction, and when you do, log that change in DECISIONS.md rather than
silently editing the plan.

    # {{PROJECT_NAME}} — Build Plan
    One paragraph: {{PROJECT_GOAL}}, and why it exists.

    ## 1. Tech Stack
    Table: | Layer | Tool | Why this one |
    Cover everything in {{STACK}}. The "Why" column is mandatory — "it is
    popular" is not a reason. Note anything deliberately NOT used, and why.

    ## 2. Architecture
    A diagram (ASCII or mermaid) plus a short paragraph per component.
    State which components depend on which, and which are independent —
    independence is what allows parallelism and isolated testing.

    ## 3. Data / Domain Model
    Core entities, their shape, and the rules that must always hold.

    ## 4. Core Logic
    The central formulas, algorithms, or business rules. For each: what it
    computes, what it assumes, and where those assumptions break.
    Documenting the limits of an approach is worth more than describing it.

    ## 5. Phase Plan
    Phases with deliverables. Each phase names a concrete artifact that can
    be demonstrated, not an activity. "Five callable functions" not "work
    on the engine".

    ## 6. Repo Structure
    Directory tree, one line of purpose per file or folder.

    ## 7. Definition of Done
    The specific, checkable conditions under which {{PROJECT_NAME}} is
    finished. Include the non-code ones: documentation, reproducibility,
    tests passing.

---

## FILE 2 — FEATURES.md

What is true right now. Rewritten as the project changes. Anyone should be
able to open this and learn what exists, what works, and what is left.

### 2.1 Header

    # FEATURES — {{PROJECT_NAME}}

    Living document. Updated at the end of every working session, as part of
    the work. Reasoning and history live in DECISIONS.md.

    **Last updated:** <date> — <one line: what phase just completed, headline
    numbers, what is next>

The "Last updated" line is the most-read line in the file. It must let a
reader reconstruct project state in five seconds. Rewrite it every session;
never let it go stale.

### 2.2 Status legend

    | Status     | Meaning                                  |
    | `Planned`  | Agreed, not started                      |
    | `Building` | In progress right now                    |
    | `Done`     | Implemented AND verified                 |
    | `Cut`      | Deliberately dropped — see DECISIONS.md  |

`Done` requires evidence — a passing test, a measured number, a working
command — not "the code is written". Status inflation is the fastest way to
make this file worthless.

Mark standout items with one to three stars, where a star means
{{STAR_LABEL}}. Only mark what is genuinely non-obvious; if everything is
starred, nothing is.

### 2.3 Code map

An ASCII tree of every file with a one-line purpose, plus a short "Not yet
built" list naming what is still missing. A reader should be able to find the
right file from this section alone, without opening the repo.

If {{PROJECT_NAME}} has one central pipeline — a request path, a data flow, a
model lifecycle — add a numbered table tracing it end to end:

    | Step | File | What happens |

This is the fastest way to explain a system to someone new, including
yourself in three weeks.

### 2.4 Feature sections

Group features by layer or subsystem, in dependency order (foundations
first). One table per group:

    | Feature | Status | What it does | Lives in | Star |

Rules:

- One row per feature, one line of description. If it needs a paragraph, it
  is two features.
- "What it does" must contain something concrete — a number, a filename, a
  measured result. "Handles errors" is worthless; "falls back to the second
  provider on unparseable output, not only on a dead server" is useful.
- "Lives in" is a real path, kept correct when files move.
- Add rows for features that emerged mid-build, not only planned ones.

End with a group for deferred and rejected work:

    | Feature | Status | Note (why deferred or cut, what would change it) |

### 2.5 Current state / measured results

The real numbers as of the last update: benchmarks, metrics, test counts,
timings, sample output. Include the exact command that reproduces them.

Every number must be one actually observed, with the conditions it was
measured under. Refresh whenever the underlying thing changes — a stale
number here is worse than none, because it will be quoted.

### 2.6 Interview talking points

One entry per starred feature, written for {{AUDIENCE}}. Two or three
paragraphs each:

    ### <stars> <short title>
    What it is, in one or two sentences.
    Why it is non-obvious — the naive approach and why it fails.
    The question it answers, and the answer, in a form that can be said out
    loud in under a minute.

Rules:

- Write these AS YOU GO. Reconstructing the reasoning weeks later loses the
  details that made it interesting.
- The best entries describe a trap avoided or a wrong path corrected, not a
  feature delivered. "I chose X over Y because Z, and here is the evidence"
  beats any feature description.
- Cross-reference the source: point at the problem ID in DECISIONS.md or the
  file path that shows it.
- Every claim must be defensible under follow-up questioning. If a point
  cannot survive "why?" twice, cut it.
- Order by strength, not by chronology. The strongest point goes first.

### 2.7 Open items

Checkbox list of everything outstanding, including work blocked on a human
(credentials, downloads, decisions). Remove items when done — this list must
never contain a completed item.

---

## FILE 3 — DECISIONS.md

Why {{PROJECT_NAME}} ended up this way. **Append-only.** Never edit or delete
an entry. If a decision is reversed, add a new entry saying so and referencing
the old one — the history of changed minds is the point.

This is the file that cannot be reconstructed from the code later, which makes
it the most valuable of the three.

### 3.1 Header

    # DECISIONS — {{PROJECT_NAME}}

    Append-only record of choices made and problems solved.
    Current state lives in FEATURES.md.

### 3.2 Decisions log

    | Date | Decision | Why |

Log a decision whenever:

- a technology, library, or approach is chosen over an alternative
- a default, threshold, or parameter is set to a non-obvious value
- something is deliberately NOT done
- a previous decision is reversed
- a value changes based on evidence — state what the evidence was

The "Why" column carries the weight. It must answer the question a sceptical
reader would ask. If the why is "it was the obvious choice", the row probably
should not exist.

### 3.3 Problems faced and fixed

The highest-value section in any of these files, and the one most often
skipped. One numbered entry per real problem:

    ### P<n> — <one-line title> *(when, category)*
    **Symptom:** what was actually observed — error text, wrong number,
    failing test. Quote it verbatim where possible.
    **Root cause:** the real reason, not the surface reason.
    **Fix:** what changed.
    **Generalises to:** the transferable lesson, in one sentence.

Add an entry for:

- every bug found, including ones caught by tests rather than by failure
- every wrong assumption discovered
- every design approach that had to be redone
- problems designed out before they shipped, where the reasoning is useful

Do not sanitise these. An entry saying "my threshold was conceptually wrong"
is worth ten saying "fixed a typo". The reasoning trail is the value, and it
is impossible to rebuild later from the code alone.

Category tags worth using: `conceptual`, `latent`, `design trap`,
`assumption`, `tooling`, `caught by tests`.

Number problems sequentially and never renumber them — FEATURES.md talking
points and commit messages will reference these IDs.

---

## WHEN TO UPDATE

**FEATURES.md** — always at the end of every working session, before
reporting completion. Never batch documentation to the end of a project; it
becomes fiction. Also immediately when:

- a feature changes status (`Planned` → `Building` → `Done`)
- measured numbers change → refresh Current State
- a file is added, moved, or renamed → update Code Map
- a feature is cut → status `Cut`, with the reason logged in DECISIONS.md
- a starred feature is completed → write its talking point then, not later

**DECISIONS.md** — immediately when:

- a non-obvious choice is made → decisions row
- a bug is found and fixed → problem entry
- a previous decision is reversed → new row, old row untouched
- an assumption turns out to be wrong → problem entry

**BUILD-PLAN.md** — only on a real change of direction, with that change
logged in DECISIONS.md.

**Never:**

- delete history to make the project look cleaner
- mark something `Done` without verification
- leave the "Last updated" line stale
- copy in a number without having observed it
- write "improved performance" or "various fixes" — say what, and by how much
- edit a DECISIONS.md entry after it is written

---

## WRITING STYLE

- Concrete over abstract. Numbers, filenames, commands, quoted errors.
- Record the WHY, always. The what is recoverable from the code; the why is
  not.
- Keep rejected approaches and failed attempts. They are evidence of
  judgement, and they stop the same ground being re-covered.
- State limitations plainly. "This assumes X, which breaks when Y" is a
  strength, not an admission.
- No marketing language: no "robust", "seamless", "powerful",
  "state-of-the-art".
- Assume the reader is capable but has no context — including yourself in
  three weeks.
- Tables for scanning, prose for reasoning. Do not write a paragraph where a
  table row will do, and do not compress an explanation into a table cell.

---

## CROSS-LINKING

- FEATURES.md links to DECISIONS.md problem IDs and decision dates.
- DECISIONS.md does not link forward to FEATURES.md; it is history and must
  stay valid even as the current state changes underneath it.
- Both link to real file paths in the repo.
- Only FEATURES.md carries a "Last updated" line, so there is exactly one
  place to look for project state.

---

## SCALING DOWN

For a project under a week: drop BUILD-PLAN.md, keep FEATURES.md and
DECISIONS.md. The problems and decisions sections earn their keep at every
project size; the plan does not.
