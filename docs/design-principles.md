# Design Principles

These principles govern every design, code, and config decision made by any agent.
When a principle conflicts with a skill's default behavior, the principle wins
(user instructions > skills).

## Prime Principle

**If it doesn't exist, it can't break.**

Before adding a component, dependency, flag, layer, file, or abstraction, ask
whether the goal can be reached without it. Removing or simplifying beats adding.

## The Zen of Python (PEP 20)

Numbered so reviews and reports can cite a rule (e.g. "#10").

1. Beautiful is better than ugly.
2. Explicit is better than implicit.
3. Simple is better than complex.
4. Complex is better than complicated.
5. Flat is better than nested.
6. Sparse is better than dense.
7. Readability counts.
8. Special cases aren't special enough to break the rules.
9. Although practicality beats purity.
10. Errors should never pass silently.
11. Unless explicitly silenced.
12. In the face of ambiguity, refuse the temptation to guess.
13. There should be one-- and preferably only one --obvious way to do it.
14. Although that way may not be obvious at first unless you're Dutch.
15. Now is better than never.
16. Although never is often better than *right* now.
17. If the implementation is hard to explain, it's a bad idea.
18. If the implementation is easy to explain, it may be a good idea.
19. Namespaces are one honking great idea -- let's do more of those!

## How Agents Apply This

- **Ambiguity → ask, failure → diagnose (#12).** Do not guess requirements, paths,
  names, or intent — ask. When something fails for an unclear reason, find the root
  cause before changing anything; no trial-and-error fixes.
- **No silent failures (#10, #11).** Never swallow errors. Any deliberate silencing is
  explicit and carries a comment explaining why.
- **Now, but not half-baked (#15, #16).** Don't postpone indefinitely, but don't ship
  something unfinished just to have it now. Anything deliberately left out is listed
  explicitly as debt — in your final report, and in the spec or plan the work came from.
- **Subtract before adding.** Prefer deleting or simplifying an existing mechanism
  over introducing a new one.
- **One obvious way (#13).** Do not create parallel mechanisms that do the same thing.
- **Explainable or redesign (#17, #18).** If a solution can't be explained in a few
  sentences, go back to design.
- **Flat and namespaced (#5, #19).** Prefer shallow structures and clear names,
  prefixes, and namespaces over deep nesting.
- **Readable over clever (#1, #6, #7).** Use full descriptive names; no one-liners at
  the cost of readability; of two working solutions, pick the simpler one.
- **No abbreviations.**
  - *To the user* — in chat, in summaries relayed from subagents, and in specs and
    plans (`docs/superpowers/`): write full names. If an abbreviation is unavoidable,
    expand it on first use in that message or document. Never assume an abbreviation
    is "commonly known".
  - *In code and scripts* — no abbreviated identifiers (`create_list`, not
    `create_lst`); long flags and full resource names in scripts and pipelines
    (`--namespace`, `kustomization` not `ks`). Exceptions: language idioms (`err`,
    `ctx`, `i`, single-letter Go receivers) and acronyms common in code (`URL`, `ID`,
    `HTTP`).
