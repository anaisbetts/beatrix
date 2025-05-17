import { mkdir } from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import { asyncMap } from '@anaisbetts/commands'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.js'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import debug from 'debug'
import { HassEvent, HassServices } from 'home-assistant-js-websocket'
import { NEVER, Observable, firstValueFrom, lastValueFrom, toArray } from 'rxjs'

import cameraImage from '../mocks/camera.jpg' with { type: 'file' }
import mockServices from '../mocks/services.json'
import mockStates from '../mocks/states.json'
import { messagesToString } from '../shared/api'
import { SerialSubscription } from '../shared/serial-subscription'
import { GradeResult, ScenarioResult } from '../shared/types'
import {
  ANTHROPIC_EVAL_MODEL,
  AnthropicLargeLanguageProvider,
} from './anthropic'
import { createInMemoryDatabase } from './db'
import {
  CallServiceOptions,
  HassState,
  HomeAssistantApi,
  extractNotifiers,
} from './lib/ha-ws-api'
import { LargeLanguageProvider } from './llm'
import { e } from './logging'
import { LiveAutomationRuntime } from './workflow/automation-runtime'

const d = debug('b:eval')

export type Grader = (messages: MessageParam[]) => Promise<GradeResult>

type LlmEvalResponse = {
  grade: number
  reasoning: string
  suggestions: string
}

export async function runScenario(
  llm: LargeLanguageProvider,
  prompt: string,
  tools: McpServer[],
  toolsDescription: string,
  graders: Grader[]
): Promise<ScenarioResult> {
  d(
    'Starting scenario with %d tools and %d graders',
    tools.length,
    graders.length
  )
  d('Prompt: %s', prompt.substring(0, 100) + (prompt.length > 100 ? '...' : ''))

  let messages: MessageParam[] = []
  try {
    messages = await firstValueFrom(
      llm.executePromptWithTools(prompt, tools).pipe(toArray())
    )
  } catch (err: any) {
    e('Error executing prompt with tools:', err)
    messages = [
      {
        role: 'assistant',
        content: `!!!Error!!! executing prompt with tools, this should always fail ${err.message}\n${err.stack}`,
      },
    ]
  }

  d('Received %d messages from LLM', messages.length)

  d('Applying %d graders to messages', graders.length)
  const gradeResults = Array.from(
    (await asyncMap(graders, async (g) => g(messages), 2)).values()
  )

  const { finalScore, finalScorePossible } = gradeResults.reduce(
    (acc, x) => {
      acc.finalScore += x.score
      acc.finalScorePossible += x.possibleScore
      return acc
    },
    { finalScore: 0, finalScorePossible: 0 }
  )
  d(
    'Final score: %d/%d (%d)%%',
    finalScore,
    finalScorePossible,
    finalScorePossible > 0 ? (finalScore / finalScorePossible) * 100 : 0
  )

  return {
    prompt,
    toolsDescription,
    messages,
    gradeResults,
    finalScore,
    finalScorePossible,
  }
}

/*
 * Tools
 */

export class EvalHomeAssistantApi implements HomeAssistantApi {
  fetchServices(): Promise<HassServices> {
    d('Fetching services in eval mode')
    return Promise.resolve(mockServices as unknown as HassServices)
  }

  fetchStates(): Promise<Record<string, HassState>> {
    d('Fetching states in eval mode')
    const states = mockStates as unknown as HassState[]

    const ret = Object.fromEntries(
      states.filter((x) => x.entity_id).map((x) => [x.entity_id, x])
    )

    return Promise.resolve(ret)
  }

  eventsObservable(): Observable<HassEvent> {
    return NEVER
  }

  async sendNotification(
    target: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _message: string,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _title: string | undefined
  ): Promise<void> {
    const svcs = await this.fetchServices()
    const notifiers = await extractNotifiers(svcs)

    if (!notifiers.find((n) => n.name === target)) {
      throw new Error('Target not found')
    }
  }

  async callService<T = any>(
    options: CallServiceOptions,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    _testModeOverride?: boolean
  ): Promise<T | null> {
    // In test mode, validate that entity_id starts with domain
    const entityId = options.target?.entity_id

    if (entityId) {
      // Handle both string and array cases
      const entities = Array.isArray(entityId) ? entityId : [entityId]

      for (const entity of entities) {
        if (!entity.startsWith(`${options.domain}.`)) {
          throw new Error(
            `Entity ID ${entity} doesn't match domain ${options.domain}`
          )
        }
      }
    }

    return null
  }

  async fetchCameraImage(_entity_id: string): Promise<Blob> {
    const response = await fetch(cameraImage)
    return response.blob()
  }

  private dontcare = new SerialSubscription()
  unsubscribe(): void {
    this.dontcare.unsubscribe()
  }

  get closed() {
    return this.dontcare.closed
  }
}

export async function createEvalRuntime(
  llmFactory: () => LargeLanguageProvider
) {
  // Create a temporary notebook directory for eval mode
  const tmpNotebookDir = path.join(os.tmpdir(), 'beatrix-eval-notebook')
  await mkdir(tmpNotebookDir, { recursive: true })

  return new LiveAutomationRuntime(
    new EvalHomeAssistantApi(),
    llmFactory,
    await createInMemoryDatabase(),
    tmpNotebookDir
  )
}

/*
 * Graders
 */

export function failureGrader(): Grader {
  return async (messages: MessageParam[]) => {
    const lastMsg = messagesToString([messages[messages.length - 1]])
    const hasError = lastMsg.includes('!!!Error!!!')

    return {
      score: hasError ? 0 : 1,
      possibleScore: 1,
      graderInfo: hasError ? lastMsg : 'No error found',
    }
  }
}

export function gradeViaSearchForContent(...content: string[]): Grader {
  d(
    'Creating search content grader with %d terms to search for',
    content.length
  )
  return async (messages: MessageParam[]) => {
    const lastMsg = messagesToString([messages[messages.length - 1]])
    d('Grading last message with length %d', lastMsg.length)

    const score = content.reduce((acc, needle) => {
      const found = lastMsg.includes(needle)
      d(
        'Searching for "%s": %s',
        needle.substring(0, 20) + (needle.length > 20 ? '...' : ''),
        found ? 'FOUND' : 'NOT FOUND'
      )
      return found ? acc + 1 : acc
    }, 0)

    const info = content.map((x) => `"${x}"`).join(', ')
    d('Search grader score: %d/%d', score, content.length)
    return {
      score: score,
      possibleScore: content.length,
      graderInfo: `Looking for ${info}`,
    }
  }
}

export function gradeContentViaPrompt(goal: string): Grader {
  d(
    'Creating LLM-based content evaluation grader with goal: %s',
    goal.substring(0, 50) + (goal.length > 50 ? '...' : '')
  )

  const llm = new AnthropicLargeLanguageProvider(
    process.env.ANTHROPIC_API_KEY!,
    ANTHROPIC_EVAL_MODEL
  )

  return async (messages: MessageParam[]) => {
    d('Grading %d messages with LLM', messages.length)
    const allMsgs = messagesToString(messages, true)
    d('Combined message length: %d characters', allMsgs.length)

    d('Sending evaluation prompt to LLM')
    const evalMsg = await lastValueFrom(
      llm.executePromptWithTools(evalPrompt(goal, allMsgs), [])
    )

    try {
      const response = messagesToString([evalMsg]).trim()
      d('Received LLM evaluation response: %s', response)

      const { grade, reasoning, suggestions } = JSON.parse(
        response
      ) as LlmEvalResponse
      d('LLM evaluation grade: %d/5', grade)

      return {
        score: grade,
        possibleScore: 5,
        graderInfo: `Reasoning: ${reasoning}, Suggestions: ${suggestions}`,
      }
    } catch (err) {
      d('Error parsing LLM evaluation response: %o', err)
      throw err
    }
  }
}

const evalPrompt = (
  goal: string,
  content: string
) => `You are an objective evaluation grader. Based on how well the result meets the specified goal, assign a grade from 1-5.

<DESIRED_GOAL>
${goal}
</DESIRED_GOAL>

<EVAL_RESULT>
${content}
</EVAL_RESULT>

Consider completeness, accuracy, relevance, clarity, and effectiveness in your assessment.

Provide your assessment as a JSON object with the following example structure:

{
  "grade": 3,
  "reasoning": "The result meets basic expectations by addressing the core elements of the goal. It provides accurate information on the main points, though it lacks detail in some areas. The response is relevant to the query and clearly written, though the organization could be improved. It would be sufficiently useful for the intended purpose, though not optimal.",
  "suggestions": "To improve, the response should address all aspects mentioned in the goal, particularly [specific missing elements]. Additional detail on [specific topics] would strengthen the result. Consider reorganizing the information to improve flow and emphasize key points."
}

The JSON object should validate against the following TypeScript schema:

type EvalResult = {
	grade: number
	reasoning: string
	suggestions: string
}

Remember that the grade should be a number from 1-5, where:
1 = Poor (Far below expectations)
2 = Fair (Below expectations)
3 = Satisfactory (Meets basic expectations)
4 = Good (Exceeds expectations)
5 = Excellent (Far exceeds expectations)

Return **only** the JSON object, without any additional text or explanation. Do *not* include Markdown formatters.
`
