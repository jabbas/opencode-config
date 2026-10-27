# Design Principles

These principles govern every design, code, and config decision made by any agent.
When a principle conflicts with a skill's default behavior, the principle wins
(user instructions > skills).

## Prime Principle

**If it doesn't exist, it can't break.**

Before adding a component, dependency, flag, layer, file, or abstraction, ask
whether the goal can be reached without it. Removing or simplifying beats adding.

## The Zen of Python (PEP 20)

Beautiful is better than ugly.
Explicit is better than implicit.
Simple is better than complex.
Complex is better than complicated.
Flat is better than nested.
Sparse is better than dense.
Readability counts.
Special cases aren't special enough to break the rules.
Although practicality beats purity.
Errors should never pass silently.
Unless explicitly silenced.
In the face of ambiguity, refuse the temptation to guess.
There should be one-- and preferably only one --obvious way to do it.
Although that way may not be obvious at first unless you're Dutch.
Now is better than never.
Although never is often better than *right* now.
If the implementation is hard to explain, it's a bad idea.
If the implementation is easy to explain, it may be a good idea.
Namespaces are one honking great idea -- let's do more of those!

## How Agents Apply This

- **Ambiguity → ask.** Do not guess requirements, paths, names, or intent.
- **No silent failures.** Never swallow errors. Any deliberate silencing is explicit
  and carries a comment explaining why.
- **Subtract before adding.** Prefer deleting or simplifying an existing mechanism
  over introducing a new one.
- **One obvious way.** Do not create parallel mechanisms that do the same thing.
- **Explainable or redesign.** If a solution can't be explained in a few sentences,
  go back to design.
- **Flat and namespaced.** Prefer shallow structures and clear names/prefixes over
  deep nesting.
