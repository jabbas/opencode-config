# Secrets

This directory contains API keys and tokens referenced by `opencode.json` via `{file:...}` syntax.

## Required files

| File | Description |
|------|-------------|
| `context7.key` | Context7 API key |
| `github.pat` | GitHub Personal Access Token |
| `homeassistant.url` | ha-mcp webhook endpoint URL (`https://<ha-host>/api/webhook/mcp_<id>`) — webhook ID is the secret, no token needed |
| `firecrawl.url` | Firecrawl MCP API base URL (infrastructure — treated as secret) |
| `alibaba-cloud.key` | Alibaba Cloud API key |
| `stitch.key` | Google Stitch MCP API key (X-Goog-Api-Key) |

## Setup

On a new machine, create each file with your secret value:

```bash
printf '%s' 'your-api-key-here' > secrets/context7.key
printf '%s' 'your-pat-here' > secrets/github.pat
printf '%s' 'https://ha.example.com/api/webhook/mcp_<id>' > secrets/homeassistant.url
printf '%s' 'https://firecrawl.example.internal' > secrets/firecrawl.url
printf '%s' 'your-key-here' > secrets/alibaba-cloud.key
printf '%s' 'your-stitch-key-here' > secrets/stitch.key
```

All files in this directory except `README.md` are gitignored.
