# How to write the notes in this repo

Applies to everything in `notes/` and to `CLAUDE.md`. These files exist to be read
by an agent picking this project up cold, so they are optimised for that, not for
browsing.

Grounded in published findings on agent context files, plus what actually went
wrong in this project. See Sources at the end.

## The one rule

**Write what the code cannot say.** Code states what happens. These notes state
why, what was tried and rejected, what the hardware does that no source explains,
and what is still unproven. If a fact is already obvious from `packages/core`, it
does not belong here.

## Mark confidence on every non-obvious claim

This project has repeatedly been misled by its own confident-sounding notes. An
unmarked claim reads as established fact and gets built on.

Use the three markers `research/README.md` already declares. Do not invent a
fourth, and do not introduce a parallel scheme in a new file.

| Marker | Means |
| --- | --- |
| *verified* | checked against bytes or running hardware |
| *derived* | inferred from firmware literals or app source, not run |
| *unverified* | plausible, explicitly not checked |

Where it matters how something was verified, say so in the sentence: "confirmed
on hardware by alternating 0b01 and 0b11" beats the bare word.

Keep an `Unverified` section. When something graduates, move it and say what
verified it. When something turns out wrong, **correct the entry in place and say
it was wrong** - do not silently delete it, or the next session re-derives it.

## Record corrections, not just conclusions

The most valuable entries here are the mistakes:

- `MODE` operates on saved content, not the DIY buffer
- batching blocks per ATT write silently loses columns
- `Agreement.java` was read without listing its own directory

Each cost an hour and none is inferable from the code. A note that only states the
final answer throws away the expensive part.

## Style

- Lead with the conclusion, then the evidence. Never build up to it.
- One concept, one term, everywhere. `DIY buffer` and `DATS storage` are distinct
  things; never let them blur.
- Self-contained sections. Assume a reader arrives at one heading having read none
  of the others, so avoid "as described above".
- Concrete over general: exact bytes, exact commands, exact file paths.
- Tables for anything with repeated structure. Prose for reasoning only.
- Keep it lean. Bloat measurably degrades agent performance; more rules do not
  produce better behaviour. Add a rule when something has actually gone wrong,
  not speculatively.
- British English, ~90 char lines, no em-dashes or en-dashes.

## Structure

`CLAUDE.md` is pointers only, and stays short enough to read in full every session:
the mental model, the gotchas that cause silent failure, and links. Detail lives in
`notes/`, one file per topic.

Anything that will silently produce wrong results belongs in `CLAUDE.md`, not
buried in `notes/`. Two current examples: one block per ATT write, and leaving DIY
mode restoring the vendor image.

## Do not

- Do not paste generated summaries in wholesale. Human-curated context files
  outperform LLM-generated ones; generated files made agents slower and less
  accurate in most tested settings.
- Do not let a fact go stale. Stale context harms more than missing context. If a
  claim is now doubtful, mark it doubtful rather than leaving it confident.
- Do not mix concerns in one section. Setup, protocol reference and design
  rationale confuse retrieval when blended.

## Sources

- [Agent READMEs: An Empirical Study of Context Files for Agentic Coding](https://arxiv.org/pdf/2511.12884)
- [Evaluating AGENTS.md: Are Repository-Level Context Files Helpful for Coding Agents?](https://arxiv.org/pdf/2602.11988)
- [Write LLM-friendly docs, Fern](https://buildwithfern.com/post/how-to-write-llm-friendly-documentation)
- [skills-best-practices](https://github.com/mgechev/skills-best-practices)
