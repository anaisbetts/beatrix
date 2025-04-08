# Beatrix - write Home Assistant automations in Markdown, in plain language

Beatrix is an Agentic AI application that allows you to write [Home Assistant](https://www.home-assistant.io) automations in straightforward, plain English. So, instead of building automations via complicated if-then statements, or via Node Red flows, open up a text file and write something like:

<img src="https://github.com/user-attachments/assets/69c8fa9e-ffe1-4db4-a7d8-b2d3bdd855fd" width="50%" />

Beatrix runs in the background and just....does what you asked! That's it.

## Wait so then where's the part where I spend hours fighting with Home Assistant trying to get it to do what I actually want?

Sorry, it's not there!

## 🚫🚫 This software is Pre-Alpha in-progress 🚫🚫

Right now there is only a demo chat that can let you test out the MCP tools, but the core functionality is still being worked on. Any feedback for ideas / code improvements are definitely welcome!

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

### What do you mean, "agentic?"

When automations run in Beatrix, rather than e.g. Voice Assistant which only allows the AI to make a single action, without knowing if it was successful or not, automations in Beatrix are provided a set of tools via [Model Context Protocol](https://modelcontextprotocol.io), and can take multiple turns in order to accomplish its goal.

When an automation in Beatrix tries something (e.g. calls a service), it sees the new Home Assistant state after it completes and can evaluate whether it worked correctly! This means that while Beatrix automations often take more time to run, they are _significantly_ more reliable, and can orchestrate complicated actions that could not be done in a single service call.

### Workflow Overflow

Automations are processed in several steps with different goals

1. For each automation, have the LLM evaluate the contents with the goal, "Decide when this automation should be triggered and call the Scheduler tool". This is evaluated with a set of tools that only allow scheduling and read-only introspection to Home Assistant

1. Set up watches for all triggers (e.g. state changes, time triggers, etc.)

1. When a trigger fires, have the LLM evaluate the contents with the goal, "Decide what to do now that this automation has been triggered". This is evaluated with a set of tools that allow calling services and reading Home Assistant state

### So what's the difference between "test mode" and "eval mode"?

In test mode, Beatrix is still running against a live Home Assistant instance - it's a _real_ house, but it is prevented from actually calling any services. This is useful for testing automations without worrying about them actually doing anything. It will still log what it _would've_ done, so it's a good way to try out Beatrix without actually changing anything in your house.

In eval mode, Beatrix is running against a canned fake snapshot of Home Assistant. This works even if you don't even have Home Assistant at all, and it is useful for debugging evals or trying out the app.

### What even is an "eval"?

An Eval is a Machine Learning evaluation - you can think of it as a unit-test but with partial credit. Evals help us both test to make sure the tools we give the LLM are usable, that our prompts do what we want them to, and it also helps us grade which models are best to do for this task.

If you've ever wanted to answer the question, "Does adding this text to the prompt help any?", or, "Which Ollama model should I use?", evals help to answer that.
