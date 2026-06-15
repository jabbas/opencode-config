# Memory Rules

## Search before starting

At the start of any task, run both `memory_recall` and `memory_recall_global` with keywords from the user's request. If relevant memories exist, factor them into your approach. Do not ask the user for information that is already in memory.

## Memory routing rules

- **User preference or personal fact** → `memory_store_global` with `core=true`
  Examples: "uses podman not docker", "has Daikin heat pump", "prefers concise responses"
- **Cross-project convention** → `memory_store_global`
  Examples: "use uv for Python", "prefer Helm over Kustomize", "use ESM not CommonJS"
- **Project-specific context** → `memory_store`
  Examples: architecture decisions, bug root causes, repo-specific patterns
- **Critical project fact** → `memory_store` with `core=true`
  Examples: "this repo uses pnpm", "deploys to an internal k8s cluster"

## When to store

After any of these, store a concise memory with the appropriate scope:
- A user preference or workflow pattern learned during conversation
- A design or architecture decision
- A bug fix (root cause + solution)
- A cross-project convention or tooling choice
- A significant discovery, gotcha, or workaround

## Updating memories

When information changes or a memory is wrong, use `memory_delete` to remove the outdated memory first, then store the corrected version.

## What NOT to store

- Trivial exchanges: greetings, simple factual questions, file reads
- Information already stored in memory (check first)
- Temporary debugging output or intermediate steps

## Agent-specific rules

- **debugger**: Read memory (`memory_recall`, `memory_recall_global`) but only store when a root cause is confirmed.
- **ha**: Store device names, sensor mappings, and automation patterns as global core memories on first encounter.
