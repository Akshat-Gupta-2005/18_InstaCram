# UML — InstaCram in diagrams

The system drawn from six angles, high level down to individual decisions. Every diagram is **Mermaid inside Markdown**, so it renders on GitHub and stays editable as text — no image to regenerate when the code moves.

**To view them:** GitHub renders these in the browser. In VS Code, the built-in Markdown preview renders Mermaid, or use the *Markdown Preview Mermaid Support* extension. Nothing needs installing to *edit* them.

## Which diagram answers which question

| File | Diagrams | Answers |
|---|---|---|
| [01-hld.md](01-hld.md) | context, container, deployment | What is this system, what runs, on what, talking to what |
| [02-lld.md](02-lld.md) | component × 2, class × 2 | What is inside each service, and what the important objects are |
| [03-data-model.md](03-data-model.md) | ER, class (API shapes) | What is stored, how it relates, what crosses the wire |
| [04-sequences.md](04-sequences.md) | 6 sequence diagrams | What happens, in order, when someone does something |
| [05-state-machines.md](05-state-machines.md) | 5 state diagrams | What states a thing can be in, and what moves it |
| [06-activity.md](06-activity.md) | 4 activity/decision flows | How a decision is actually made, branch by branch |

## Reading conventions

- **Solid arrow** = a call or a write. **Dashed arrow** = a return, or a read of something written earlier.
- **Blue** = serving (fast, synchronous, user-facing). **Purple** = pipeline (slow, background). **Grey** = infrastructure. **Red** = something that only exists because of a bug we hit; the note names it (`P33`, `P37`…), and [DECISIONS.md](../DECISIONS.md) has the story.
- Where a diagram shows a decision, the branch labels are the **real return values in the code**, not paraphrases.

## The one thing to understand first

Serving and pipeline **never call each other**. There is no HTTP, no broker, no RPC between them. Serving writes a `topic` row with `status = 'pending'`; the pipeline claims it. The queue is a table. If you look for an arrow between the two services in any diagram here, you will not find one — and that is the design, not an omission.

Prose versions: [SYSTEM-GUIDE.md](../SYSTEM-GUIDE.md) for the running system, [FEATURES.md](../FEATURES.md) for what is true today, [DECISIONS.md](../DECISIONS.md) for why.
