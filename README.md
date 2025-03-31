# Beatrix

## To Install (Docker Compose)

```yaml
services:
  beatrix:
    image: ghcr.io/anaisbetts/beatrix:latest
    restart: unless-stopped
    environment:
      # Required for Home Assistant connection
      - HA_BASE_URL=${HA_BASE_URL}
      - HA_TOKEN=${HA_TOKEN}

      # Choose one LLM provider:
      # Option 1: Use Anthropic Claude
      - ANTHROPIC_API_KEY=${ANTHROPIC_API_KEY}

      # Option 2: Use OpenAI
      # - OPENAI_API_KEY=${OPENAI_API_KEY}
      # - OPENAI_BASE_URL=${OPENAI_BASE_URL}  # Optional: for Azure or other OpenAI-compatible APIs

      # Option 3: Use Ollama (uncomment and set)
      # - OLLAMA_HOST=http://ollama:11434
      # - Note: When using Ollama, you must use a model that supports function calling/tool use (like Qwen or Mixtral)

      # Optional: Override the default data directory
      # - DATA_DIR=/path/to/custom/data
    volumes:
      # Mount a persistent volume for the database
      - beatrix_data:/data

volumes:
  beatrix_data:
```

## Environment Variables

### Required

| Variable      | Description                            |
| ------------- | -------------------------------------- |
| `HA_BASE_URL` | URL to your Home Assistant instance    |
| `HA_TOKEN`    | Home Assistant long-lived access token |

### LLM Configuration (choose one)

You must configure either Anthropic Claude, OpenAI, or Ollama by setting one of these sets of variables:

| Variable            | Description                                                                                                                                                                     |
| ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ANTHROPIC_API_KEY` | Your Anthropic API key                                                                                                                                                          |
| `OPENAI_API_KEY`    | Your OpenAI API key                                                                                                                                                             |
| `OPENAI_BASE_URL`   | (Optional) Custom base URL for OpenAI API (e.g., for Azure OpenAI or other compatible endpoints)                                                                                |
| `OLLAMA_HOST`       | URL to your Ollama instance (e.g., `http://localhost:11434`). **Note**: When using Ollama, you must use a model that supports function calling/tool use (like Qwen or Mixtral). |

### Optional

| Variable   | Description                                                                                             |
| ---------- | ------------------------------------------------------------------------------------------------------- |
| `DATA_DIR` | Directory for database storage. Defaults to `/data` in Docker and the current directory in development. |
| `PORT`     | Server port. Defaults to 5432                                                                           |

## Running (development mode)

```bash
cp .env.example .env && vim .env  ## Fill this in
bun install
bun dev

### Shit ain't workin' good?
bun dev:debug
```
