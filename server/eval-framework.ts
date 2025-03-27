import { MessageParam } from '@anthropic-ai/sdk/resources/index.js'
import { messagesToString } from '../shared/prompt'
import {
  ANTHROPIC_EVAL_MODEL,
  AnthropicLargeLanguageProvider,
} from './anthropic'
import { firstValueFrom, lastValueFrom, toArray } from 'rxjs'
import { LargeLanguageProvider } from './llm'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { asyncMap } from '@anaisbetts/commands'
import { createNotifyServer } from './mcp/notify'

import mockServices from '../mocks/services.json'
import mockStates from '../mocks/states.json'
import { HassServices } from 'home-assistant-js-websocket'
import { fetchHAUserInformation } from './lib/ha-ws-api'
import { createHomeAssistantServer } from './mcp/home-assistant'

/*
abstract class Scenario {
  // prompts[]
  // tools[]
  // graders[]
  // - gets msg array, returns { score, possible_score }
}
*/

export type ScenarioResult = {
  prompt: string
  toolsDescription: string
  messages: MessageParam[]
  gradeResults: GradeResult[]
  finalScore: number
  finalScorePossible: number
}

export type GradeResult = {
  score: number
  possible_score: number
  grader_info: string
}

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
  const messages = await firstValueFrom(
    llm.executePromptWithTools(prompt, tools).pipe(toArray())
  )

  const gradeResults = Array.from(
    (await asyncMap(graders, async (g) => g(messages), 2)).values()
  )
  const { finalScore, finalScorePossible } = gradeResults.reduce(
    (acc, x) => {
      acc.finalScore += x.score
      acc.finalScorePossible += x.possible_score
      return acc
    },
    { finalScore: 0, finalScorePossible: 0 }
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

export function createDefaultMockedTools(llm: LargeLanguageProvider) {
  return [
    createNotifyServer(null, {
      mockFetchServices: async () => mockServices as unknown as HassServices,
      mockFetchUsers: async () => fetchHAUserInformation(null, { mockStates }),
      mockSendNotification: async () => {},
    }),
    createHomeAssistantServer(null, llm, {
      testMode: true,
      mockFetchStates: async () => mockStates,
    }),
  ]
}

/*
 * Graders
 */

export function gradeViaSearchForContent(...content: string[]): Grader {
  return async (messages: MessageParam[]) => {
    const lastMsg = messagesToString([messages[messages.length - 1]])
    const score = content.reduce((acc, needle) => {
      if (lastMsg.includes(needle)) {
        return acc + 1
      } else {
        return acc
      }
    }, 0)

    const info = content.map((x) => `"${x}"`).join(', ')
    return {
      score: score,
      possible_score: content.length,
      grader_info: `Looking for ${info}`,
    }
  }
}

export function gradeContentViaPrompt(goal: string): Grader {
  const llm = new AnthropicLargeLanguageProvider(
    process.env.ANTHROPIC_API_KEY!,
    ANTHROPIC_EVAL_MODEL
  )

  return async (messages: MessageParam[]) => {
    const allMsgs = messagesToString(messages)
    const evalMsg = await lastValueFrom(
      llm.executePromptWithTools(evalPrompt(goal, allMsgs), [])
    )

    const { grade, reasoning, suggestions } = JSON.parse(
      evalMsg.content.toString().trim()
    ) as LlmEvalResponse

    return {
      score: grade,
      possible_score: 5,
      grader_info: `Reasoning: ${reasoning}, Suggestions: ${suggestions}`,
    }
  }
}

const evalPrompt = (goal: string, content: string) => `
You are an objective evaluation grader. Based on how well the result meets the specified goal, assign a grade from 1-5.

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
`
