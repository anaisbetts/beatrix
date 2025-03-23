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
      # Optional: Override the default data directory
      # - DATA_DIR=/path/to/custom/data
    volumes:
      # Mount a persistent volume for the database
      - ha_agentic_data:/data

volumes:
  ha_agentic_data:
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `ANTHROPIC_API_KEY` | Yes | Your Anthropic API key |
| `HA_BASE_URL` | Yes | URL to your Home Assistant instance |
| `HA_TOKEN` | Yes | Home Assistant long-lived access token |
| `DATA_DIR` | No | Database storage location. Defaults to `/data` in Docker and `./app.db` in development |
| `PORT` | No | Server port. Defaults to 5432 |

## Running (development mode)

```bash
cp .env.example .env && vim .env  ## Fill this in
bun install
bun start
```
