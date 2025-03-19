import { Connection as HAConnection } from 'home-assistant-js-websocket'
import { createNotifyServer } from './servers/notify'
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import pkg from '../package.json'
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js'
import Anthropic from '@anthropic-ai/sdk'
import {
  ContentBlockParam,
  MessageParam,
} from '@anthropic-ai/sdk/resources/index.mjs'
import { asyncReduce } from './promise-extras'
import debug from 'debug'

const d = debug('ha:anthropic')

// Model token limits and defaults
const MODEL_TOKEN_LIMITS: Record<string, number> = {
  'claude-3-5-sonnet-20240620': 200000,
  'claude-3-7-sonnet-20250219': 200000,
  'claude-3-opus-20240229': 200000,
  'claude-3-haiku-20240307': 200000,
  'claude-3-sonnet-20240229': 200000,
  'default': 150000
}

// Reserve tokens for model responses
const RESPONSE_TOKEN_RESERVE = 4000
const MAX_ITERATIONS = 10 // Safety limit for iterations

export function connectBuiltinServers(
  client: Client,
  connection: HAConnection
) {
  const servers = [createNotifyServer(connection)]

  servers.forEach((server) => {
    const [cli, srv] = InMemoryTransport.createLinkedPair()
    client.connect(cli)
    server.connect(srv)
  })
}

export function messagesToString(msgs: MessageParam[]) {
  return msgs.reduce((acc, msg) => {
    if (msg.content instanceof Array) {
      msg.content.forEach((subMsg) => {
        switch (subMsg.type) {
          case 'text':
            acc += subMsg.text
            break
          case 'tool_use':
            acc += `Running tool: ${subMsg.name}\n`
            break
          case 'tool_result':
            acc += JSON.stringify(subMsg.content)
            break
        }
      })
    } else {
      acc += msg.content
    }

    return acc
  }, '')
}

export async function executePromptWithTools(
  connection: HAConnection,
  prompt: string,
  model?: string,
  maxTokens?: number
) {
  const modelName = model ?? 'claude-3-7-sonnet-20250219'
  const anthropic = new Anthropic({
    apiKey: process.env.ANTHROPIC_API_KEY,
  })

  const client = new Client({
    name: pkg.name,
    version: pkg.version,
  })

  connectBuiltinServers(client, connection)
  const toolList = await client.listTools()

  const anthropicTools = toolList.tools.map((tool) => {
    return {
      name: tool.name,
      description: tool.description || '',
      input_schema: tool.inputSchema,
    }
  })

  const msgs: MessageParam[] = [
    {
      role: 'user',
      content: prompt,
    },
  ]

  // Calculate available token budget for the model
  const modelLimit = MODEL_TOKEN_LIMITS[modelName] || MODEL_TOKEN_LIMITS.default
  let tokenBudget = maxTokens || modelLimit
  let usedTokens = 0
  
  // Track conversation and tool use to avoid infinite loops
  let iterationCount = 0
  
  // We're gonna keep looping until there are no more tool calls to satisfy
  while (iterationCount < MAX_ITERATIONS) {
    iterationCount++
    
    // Calculate response token limit for this iteration
    const responseTokens = Math.min(RESPONSE_TOKEN_RESERVE, (tokenBudget - usedTokens) / 2)
    
    // Check if we have enough tokens left for a meaningful response
    if (responseTokens < 1000) {
      d('Token budget too low for meaningful response. Used: %d/%d', usedTokens, tokenBudget)
      break
    }
    
    d('Prompting iteration %d: %d tokens used, %d tokens remaining', 
      iterationCount, usedTokens, tokenBudget - usedTokens)

    const response = await anthropic.messages.create({
      model: modelName,
      max_tokens: responseTokens,
      messages: msgs,
      tools: anthropicTools,
      tool_choice: { type: 'auto' },
    })

    // Track token usage from response
    if (response.usage) {
      usedTokens += response.usage.input_tokens + response.usage.output_tokens
      d('Token usage for this request: %d input, %d output, %d total', 
        response.usage.input_tokens, 
        response.usage.output_tokens,
        response.usage.input_tokens + response.usage.output_tokens)
    }

    msgs.push({
      role: response.role,
      content: response.content,
    })

    if (!response.content.find((msg) => msg.type === 'tool_use')) {
      break
    }

    const toolCalls = response.content.filter((msg) => msg.type === 'tool_use')
    d('Processing %d tool calls', toolCalls.length)

    // Estimate token usage for tool calls - this is approximate
    // We add a fixed overhead per tool call plus the estimated content size
    const estimatedToolCallTokens = toolCalls.reduce((sum, call) => {
      // Rough estimate: 10 tokens per tool name + overhead + input size
      const inputSize = JSON.stringify(call.input).length / 4 // ~4 chars per token
      return sum + 20 + inputSize
    }, 0)
    usedTokens += estimatedToolCallTokens

    const toolResults = await asyncReduce(
      toolCalls,
      async (acc, toolCall) => {
        d('Calling tool: %o', toolCall)
        const toolResp = await client.callTool({
          name: toolCall.name,
          arguments: toolCall.input as Record<string, any>,
        })

        // Estimate token usage for tool results
        const resultContent = toolResp.content as string
        if (resultContent) {
          // Rough estimate: ~4 chars per token
          usedTokens += (resultContent.length / 4) + 10 // overhead
        }

        acc.push({
          type: 'tool_result',
          tool_use_id: toolCall.id,
          content: resultContent ?? [],
        })
        return acc
      },
      [] as ContentBlockParam[]
    )

    msgs.push({ role: 'user', content: toolResults })
    
    // Check if we're approaching token limit
    if (usedTokens > tokenBudget * 0.9) {
      d('Approaching token budget limit: %d/%d used (90%)', usedTokens, tokenBudget)
      break
    }
  }

  d('Conversation complete. Used %d/%d tokens (%.1f%%)', 
    usedTokens, tokenBudget, (usedTokens / tokenBudget) * 100)
  return msgs
}
