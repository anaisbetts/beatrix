# ha-agentic-automation

## To Install (Docker Compose)

```
services:
  ha-agentic-automation:
    image: ghcr.io/anaisbetts/ha-agentic-automation:latest
    restart: unless-stopped
    environment:
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}
      - HA_BASE_URL=${HA_BASE_URL}
      - HA_TOKEN=${HA_TOKEN}
```

## Running (development mode)

```bash
cp .env.example .env && vim .env  ## Fill this in
bun install
bun start
```
