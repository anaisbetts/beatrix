# ha-agentic-automation

## To Install (Docker Compose)

```yaml
services:
  ha-agentic-automation:
    image: ghcr.io/anaisbetts/ha-agentic-automation:latest
    restart: unless-stopped
    environment:
      # Required for Home Assistant connection
      - HA_BASE_URL=${HA_BASE_URL}
      - HA_TOKEN=${HA_TOKEN}
      
      # Choose one LLM provider:
      # Option 1: Use Anthropic Claude
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      # Option 2: Use Ollama (uncomment and set)
      # - OLLAMA_HOST=http://ollama:11434
      
      # Optional: Override the default data directory
      # - DATA_DIR=/path/to/custom/data
    volumes:
      # Mount a persistent volume for the database
      - ha_agentic_data:/data

volumes:
  ha_agentic_data:
```

## Environment Variables

### Required

| Variable | Description |
|----------|-------------|
| `HA_BASE_URL` | URL to your Home Assistant instance |
| `HA_TOKEN` | Home Assistant long-lived access token |

### LLM Configuration (choose one)

You must configure either Anthropic Claude or Ollama by setting one of these pairs of variables:

| Variable | Description |
|----------|-------------|
| `ANTHROPIC_API_KEY` | Your Anthropic API key |
| `OLLAMA_HOST` | URL to your Ollama instance (e.g., `http://localhost:11434`) |

### Optional

| Variable | Description |
|----------|-------------|
| `DATA_DIR` | Database storage location. Defaults to `/data` in Docker and `./app.db` in development |
| `PORT` | Server port. Defaults to 5432 |

## Running (development mode)

```bash
cp .env.example .env && vim .env  ## Fill this in
bun install
bun start
```
