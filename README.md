# Beatrix - write Home Assistant automations in Markdown, in plain language

Beatrix is an Agentic AI application that allows you to write [Home Assistant](https://www.home-assistant.io) automations in straightforward, plain English. So, instead of building automations via complicated if-then statements, or via Node Red flows, open up a text file and write something like:

<img src="https://github.com/user-attachments/assets/69c8fa9e-ffe1-4db4-a7d8-b2d3bdd855fd" width="50%" />

Beatrix runs in the background and just....does what you asked! That's it.

## Wait so then where's the part where I spend hours fighting with Home Assistant trying to get it to do what I actually want?

Sorry, it's not there!

## 🚫🚫 This software is Pre-Alpha in-progress 🚫🚫

This software is _brand-new_ and is missing many features! Issues and other feedback is welcomed

## To Install (Docker Compose)

```yaml
services:
  beatrix:
    image: ghcr.io/beatrix-ha/beatrix:latest
    restart: unless-stopped
    volumes:
      - ./notebook:/notebook
      - beatrix_data:/data

volumes:
  beatrix_data:
```

## Configuration (`config.toml`)

Beatrix is configured using a TOML file named `config.toml`. Place this file in your notebook directory (or in development, in the root of the project)

```toml
# Required: Home Assistant Connection Details
ha_base_url = "YOUR_HA_INSTANCE_URL" # e.g., "http://homeassistant.local:8123"
ha_token = "YOUR_HA_LONG_LIVED_ACCESS_TOKEN"

# Required: Choose ONE LLM provider by specifying its name
# Options: "anthropic", "openai", "ollama", "scaleway" etc
llm = "anthropic"

[anthropic]
key = "YOUR_ANTHROPIC_API_KEY"
model = "claude-3-7-sonnet-20250219"   # Optional, defaults to latest Sonnet

# Settings for Ollama
# Note that Ollama will only work with models that understand Tool Calling
# (i.e. it shows up on https://ollama.com/search?c=tools)

[ollama]
host = "URL_TO_YOUR_OLLAMA_INSTANCE" # e.g., "http://localhost:11434"
model = "qwen2.5:16"

[openai]
key = "YOUR_OPENAI_API_KEY"
# Optional: Base URL for Azure or other compatible APIs
# base_url = "YOUR_OPENAI_COMPATIBLE_BASE_URL"

# Example for a custom OpenAI provider (e.g. Scaleway)
# You can define multiple [openai.*] sections
[openai.scaleway]
base_url = "SCALEWAY_API_ENDPOINT"
key = "SCALEWAY_API_KEY"
model = 'llama-3.3-70b-instruct'

[openai.google]
base_url = "https://generativelanguage.googleapis.com/v1beta/openai/"
key = "GOOGLE_API_KEY"
model = 'gemini-2.5-pro-exp-03-25'
```

### Required Fields

- `ha_base_url`: URL to your Home Assistant instance.
- `ha_token`: Home Assistant long-lived access token.
- `llm`: The primary LLM provider to use (`"anthropic"`, `"openai"`, or `"ollama"`).

### LLM Configuration

You must provide the configuration details for the LLM provider specified in the `llm` field.

- **Anthropic**: Set the API key under the `[anthropic]` section.
- **OpenAI**: Set the API key under the `[openai]` section. You can optionally provide a `base_url` for Azure or other OpenAI-compatible APIs. You can also define multiple named OpenAI configurations (e.g., `[openai.scaleway]`) if you use different providers.
- **Ollama**: Set the host URL under the `[ollama]` section. Ensure your Ollama model supports function calling.

## What AI should I use though?

#### The short version:

- "I want the best experience, I don't mind spending $$" <== Use GPT 4.1 or Claude 3.7 Sonnet
- "I want a pretty good experience, but not spend as much $$" <== Use GPT 4.1 Mini or Gemini 2.5 Pro
- "I want to use Ollama" <== Use qwen2.5:7b or qwen2.5:14b

#### The medium length version (17.04.2025)

![image](https://github.com/user-attachments/assets/361d310c-1b8c-426e-9e2d-1c02f8bd0b31)

Note that this is the Quick test, with n=2. This is far from statistically valid, but it was what I could get done without spending a ton of money and time

#### I don't believe you!

In that case, use the Model Evaluations page! Model evaluations will test a model against a list of typical queries and grade its result. Note that you will _have_ to set up an Anthropic account because we use Sonnet 3.7 to grade results, and this _will_ cost you money in real-life (though if you run Quick tests, it will be on the order of cents)

## Running (development mode)

```bash
cp config.example.toml config.toml && vim config.toml ## Fill this in
bun install
bun dev

### Ain't workin' good?
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
