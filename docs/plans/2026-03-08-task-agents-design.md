# Task Agents Design

**Date:** 2026-03-08

## Goal

Create 5 task-specific OpenCode agents covering the daily workflow: Kubernetes/Helm/Flux authoring + live cluster ops, polyglot coding, architecture design, full-stack debugging, and DevOps/CI-CD pipeline work.

## Agent Roster

| Agent | Model (primary) | Mode | Purpose |
|-------|-----------------|------|---------|
| `k8s` | `openrouter/anthropic/claude-sonnet-4.6` | all | Helm charts, Flux, manifests, live cluster ops |
| `coder` | `openrouter/anthropic/claude-sonnet-4.6` | all | Polyglot code (Go, Python, TS, others) |
| `designer` | `openrouter/anthropic/claude-opus-4.6` | all | Architecture ADRs, system design docs |
| `debugger` | `openrouter/anthropic/claude-opus-4.6` | all | Full-stack debugging: cluster + application |
| `devops` | `openrouter/anthropic/claude-haiku-4.5` | all | CI/CD pipelines, Jenkins, GitHub, git ops |

Copilot enterprise models remain configured as fallback provider.

## Tools & Permissions

| Agent | bash | edit | write | MCP |
|-------|------|------|-------|-----|
| `k8s` | ask (kubectl/helm/flux/kustomize auto-allowed) | ask | ask | context7 |
| `coder` | ask | ask | ask | context7 |
| `designer` | deny | deny | ask | context7 |
| `debugger` | ask (kubectl/logs/describe auto-allowed) | deny | deny | context7 |
| `devops` | ask (git/gh/flux auto-allowed) | deny | deny | context7, github, jenkins |

## Agent Prompts (summary)

- **k8s:** Kubernetes/Helm/Flux expert. Knows GitOps patterns, Flux v2 (HelmRelease, Kustomization, GitRepository), Helm best practices. Uses context7 for docs. Asks before kubectl apply/delete.
- **coder:** Polyglot engineer. Go, Python, TypeScript. TDD. Uses context7 for library docs. Runs tests after changes.
- **designer:** Architecture-only mode. Produces ADRs, system diagrams (mermaid), design docs. No code execution. Think first, write clean docs.
- **debugger:** Root-cause analyst. Cluster events → pod logs → app code. Never modifies. Reports findings with evidence.
- **devops:** CI/CD specialist. Jenkins builds, GitHub Actions, Flux reconciliation, git branching. Fast and cheap — status checks, log tailing, pipeline queries.

## File Plan

```
agents/
  k8s.md
  coder.md
  designer.md
  debugger.md
  devops.md
opencode.json   (add model entries for 5 agents under "agent" key)
```
