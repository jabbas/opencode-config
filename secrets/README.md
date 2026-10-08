# Secrets

This directory contains API keys and tokens referenced by `opencode.json` via `{file:...}` syntax.

## Required files

| File | Description |
|------|-------------|
| `context7.key` | Context7 API key |
| `github.pat` | GitHub Personal Access Token |
| `homeassistant.url` | ha-mcp webhook endpoint URL (`https://<ha-host>/api/webhook/mcp_<id>`) — webhook ID is the secret, no token needed |
| `firecrawl.url` | Firecrawl MCP API base URL (infrastructure — treated as secret) |
| `firecrawl.key` | Firecrawl MCP API key |
| `jira.url` | Jira base URL for the Atlassian MCP (infrastructure — treated as secret) |
| `jira.token` | Jira personal access token (`--jira-personal-token`) |
| `stitch.key` | Google Stitch MCP API key |
| `alibaba-cloud.key` | Alibaba Cloud API key |
| `grafana-dev.token` | Grafana service-account token for dev (46-char `glsa_…`, read-only Viewer SA) |
| `grafana-test.token` | Grafana service-account token for test (read-only Viewer SA) |
| `grafana-stage.token` | Grafana service-account token for stage (read-only Viewer SA) |

## Setup

On a new machine, create each file with your secret value (no trailing newline):

```bash
printf '%s' 'your-api-key-here'                   > secrets/context7.key
printf '%s' 'your-pat-here'                        > secrets/github.pat
printf '%s' 'https://ha.example.com/api/webhook/mcp_<id>' > secrets/homeassistant.url
printf '%s' 'https://firecrawl.example.internal'   > secrets/firecrawl.url
printf '%s' 'your-firecrawl-key-here'              > secrets/firecrawl.key
printf '%s' 'https://jira.example.internal'        > secrets/jira.url
printf '%s' 'your-jira-token-here'                 > secrets/jira.token
printf '%s' 'your-stitch-key-here'                 > secrets/stitch.key
printf '%s' 'your-key-here'                        > secrets/alibaba-cloud.key
```

### Grafana service-account tokens (dev/test/stage)

Extracted from the cluster secret `grafana-ai-token` (namespace `monitoring`) — no
trailing newline, 46 chars each:

```bash
kubectl --context sm-dev   -n monitoring get secret grafana-ai-token -o jsonpath='{.data.token}' | base64 -d > secrets/grafana-dev.token
kubectl --context sm-test  -n monitoring get secret grafana-ai-token -o jsonpath='{.data.token}' | base64 -d > secrets/grafana-test.token
kubectl --context sm-stage -n monitoring get secret grafana-ai-token -o jsonpath='{.data.token}' | base64 -d > secrets/grafana-stage.token
```

**prod is not available:** the `GrafanaServiceAccount/ai-mcp` CR (and therefore the
`grafana-ai-token` secret) does not exist on `sm-prod`, so there is no
`grafana-prod` MCP server and no `grafana-prod.token` file. Do not add one until the
service account is created in prod.

All files in this directory except `README.md` are gitignored.
