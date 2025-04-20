import { MessageParam } from '@anthropic-ai/sdk/resources/index.js'
import { Observable } from 'rxjs'

import { AppConfig, TypeHint } from './types'
import {
  Automation,
  AutomationLogEntry,
  ScenarioResult,
  SignalHandlerInfo,
} from './types'

export type MessageParamWithExtras = MessageParam & {
  serverId: number
}

export interface ServerWebsocketApi {
  handlePromptRequest(
    prompt: string,
    model?: string,
    driver?: string,
    previousConversationId?: number,
    typeHint?: TypeHint
  ): Observable<MessageParamWithExtras>

  runEvals(
    model: string,
    driver: string,
    type: 'all' | 'quick',
    count: number
  ): Observable<ScenarioResult>

  getModelListForDriver(driver: string): Observable<string[]>
  getDriverList(): Observable<string[]>

  getAutomationLogs(beforeTimestamp?: Date): Observable<AutomationLogEntry[]>

  getAutomations(): Observable<Automation[]>
  getCues(): Observable<Automation[]>
  getScheduledSignals(): Observable<SignalHandlerInfo[]>

  getConfig(): Observable<AppConfig>
  setConfig(config: AppConfig): Observable<void>

  captureBugReport(): Observable<void>

  // Notebook Editor
  listNotebookFiles(): Observable<string[]>
  readNotebookFile(filePath: string): Observable<string>
  writeNotebookFile(filePath: string, content: string): Observable<void>
  createNotebookFile(
    fileName: string,
    type: 'cue' | 'automation'
  ): Observable<{ relativePath: string }>
}

export function messagesToString(
  msgs: MessageParam[],
  annotateSides: boolean = false
) {
  return msgs
    .reduce((acc, msg) => {
      const side = annotateSides ? `${msg.role}: ` : ''

      if (msg.content instanceof Array) {
        msg.content.forEach((subMsg) => {
          switch (subMsg.type) {
            case 'text':
              acc.push(side + subMsg.text)
              break
            case 'tool_use':
              acc.push(
                `Running tool: ${subMsg.name}, ${JSON.stringify(subMsg.input)}\n`
              )
              break
            case 'tool_result':
              acc.push(`${JSON.stringify(subMsg.content)}\n`)
              break
          }
        })
      } else {
        acc.push(side + msg.content)
      }

      return acc
    }, [] as string[])
    .join('\n\n---\n\n')
}
