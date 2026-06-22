# Secrets

This directory contains API keys and tokens referenced by `opencode.json` via `{file:...}` syntax.

## Required files

| File | Description |
|------|-------------|
| `context7.key` | Context7 API key |
| `github.pat` | GitHub Personal Access Token |
| `homeassistant.token` | Home Assistant long-lived access token (without "Bearer " prefix) |
| `homeassistant.url` | Home Assistant MCP endpoint URL (infrastructure — treated as secret) |
| `firecrawl.url` | Firecrawl MCP API base URL (infrastructure — treated as secret) |
| `firecrawl.key` | Firecrawl MCP API key |
| `jira.url` | Jira base URL for the Atlassian MCP (infrastructure — treated as secret) |
| `jira.token` | Jira personal access token (`--jira-personal-token`) |
| `stitch.key` | Google Stitch API key |
| `alibaba-cloud.key` | Alibaba Cloud API key |

## Setup

On a new machine, create each file with your secret value (no trailing newline):

```bash
printf '%s' 'your-api-key-here'                   > secrets/context7.key
printf '%s' 'your-pat-here'                        > secrets/github.pat
printf '%s' 'your-jwt-here'                        > secrets/homeassistant.token
printf '%s' 'https://ha.example.com/api/mcp'       > secrets/homeassistant.url
printf '%s' 'https://firecrawl.example.internal'   > secrets/firecrawl.url
printf '%s' 'your-firecrawl-key-here'              > secrets/firecrawl.key
printf '%s' 'https://jira.example.internal'        > secrets/jira.url
printf '%s' 'your-jira-token-here'                 > secrets/jira.token
printf '%s' 'your-stitch-key-here'                 > secrets/stitch.key
printf '%s' 'your-key-here'                        > secrets/alibaba-cloud.key
```

All files in this directory except `README.md` are gitignored.
