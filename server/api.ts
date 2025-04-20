import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { glob } from 'glob'
import { sql } from 'kysely'
import { DateTime } from 'luxon'
import fs from 'node:fs/promises'
import path from 'node:path'
import {
  Observable,
  concatMap,
  from,
  generate,
  mergeMap,
  of,
  share,
  toArray,
} from 'rxjs'

import { MessageParamWithExtras, ServerWebsocketApi } from '../shared/api'
import {
  Automation,
  AutomationLogEntry,
  BugReportData,
  ScenarioResult,
  SignalHandlerInfo,
  TypeHint,
} from '../shared/types'
import { AppConfig } from '../shared/types'
import { pick } from '../shared/utility'
import { fetchAutomationLogs } from './db'
import { createBuiltinServers, createDefaultLLMProvider } from './llm'
import { i } from './logging'
import { getSystemPrompt } from './prompts'
import { runAllEvals, runQuickEvals } from './run-evals'
import {
  AutomationRuntime,
  LiveAutomationRuntime,
  now,
} from './workflow/automation-runtime'
import { automationFromString } from './workflow/parser'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    private config: AppConfig,
    private runtime: AutomationRuntime,
    private notebookDirectory: string,
    private testMode: boolean,
    private evalMode: boolean
  ) {}

  getDriverList(): Observable<string[]> {
    const list = []
    if (this.config.anthropicApiKey) {
      list.push('anthropic')
    }
    if (this.config.ollamaHost) {
      list.push('ollama')
    }

    if (this.config.openAIProviders && this.config.openAIProviders.length > 0) {
      list.push(
        ...this.config.openAIProviders.map((x) => x.providerName ?? 'openai')
      )
    }

    return of(list)
  }

  getModelListForDriver(driver: string): Observable<string[]> {
    const llm = createDefaultLLMProvider(this.config, driver.toLowerCase())
    return from(llm.getModelList())
  }

  getAutomationLogs(beforeTimestamp?: Date): Observable<AutomationLogEntry[]> {
    return from(
      fetchAutomationLogs(
        this.runtime.db,
        this.runtime.automationList,
        DateTime.fromJSDate(beforeTimestamp ?? new Date()).setZone(
          this.runtime.timezone
        )
      )
    )
  }

  getAutomations(): Observable<Automation[]> {
    return of(
      this.filterAutomationPaths(
        this.runtime.notebookDirectory ?? '',
        this.runtime.automationList
      )
    )
  }

  getCues(): Observable<Automation[]> {
    return of(
      this.filterAutomationPaths(
        this.runtime.notebookDirectory ?? '',
        this.runtime.cueList
      )
    )
  }

  private filterAutomationPaths(
    notebookDirectory: string,
    automations: Automation[]
  ) {
    return automations.map((x) =>
      automationFromString(
        x.contents,
        x.fileName.replace(notebookDirectory + path.sep, ''),
        true
      )
    )
  }

  getScheduledSignals(): Observable<SignalHandlerInfo[]> {
    return of(
      // NB: If we don't do this, we will end up trying to serialize an Observable
      // which obvs won't work
      this.runtime.scheduledSignals.map((x) => {
        const ret = pick(x, [
          'automation',
          'friendlySignalDescription',
          'isValid',
          'signal',
        ])

        // Make the filenames relative to the automation dir when returning them
        ret.automation.fileName = ret.automation.fileName.replace(
          `${this.runtime.notebookDirectory}${path.sep}`,
          ''
        )

        return ret
      })
    )
  }

  getConfig(): Observable<AppConfig> {
    return of(this.config)
  }

  setConfig(config: AppConfig): Observable<void> {
    return from(this.runtime.saveConfigAndClose(config))
  }

  handlePromptRequest(
    prompt: string,
    model?: string,
    driver?: string,
    previousConversationId?: number,
    typeHint?: TypeHint
  ): Observable<MessageParamWithExtras> {
    const rqRuntime = new LiveAutomationRuntime(
      this.runtime.api,
      () => createDefaultLLMProvider(this.config, driver, model),
      this.runtime.db,
      this.notebookDirectory
    )

    const tools = createBuiltinServers(rqRuntime, null, {
      testMode: this.testMode || this.evalMode,
      includeCueServer: typeHint === 'chat',
    })

    const convo = previousConversationId
      ? from(
          this.runtime.db
            .selectFrom('automationLogs')
            .select('messageLog')
            .where('id', '=', previousConversationId)
            .executeTakeFirst()
            .then((x) => JSON.parse(x?.messageLog ?? '[]') as MessageParam[])
        )
      : of([])

    let serverId: bigint | undefined = previousConversationId
      ? BigInt(previousConversationId)
      : undefined
    let previousMessages: MessageParam[] = []

    const resp = convo.pipe(
      mergeMap((prevMsgs) => {
        const msgs: MessageParam[] = prevMsgs.map((msg) =>
          pick(msg, ['content', 'role'])
        )

        previousMessages = msgs
        const llm = this.runtime.llmFactory()
        if (prevMsgs.length > 0) {
          // If we are in a continuing conversation, we don't include the system
          // prompt
          return llm.executePromptWithTools(prompt, tools, msgs)
        } else {
          return from(getSystemPrompt(this.runtime, typeHint ?? 'debug')).pipe(
            mergeMap((sysPrompt) => {
              const finalPromptText = `${sysPrompt}\n${prompt}`
              return llm.executePromptWithTools(finalPromptText, tools, msgs)
            })
          )
        }
      }),
      mergeMap((msg) => {
        // NB: We insert into the database twice so that the caller can get
        // the ID faster even though it's a little hamfisted
        if (!serverId) {
          const insert = this.runtime.db
            .insertInto('automationLogs')
            .values({
              createdAt: now(this.runtime).toISO()!,
              type: 'manual',
              messageLog: JSON.stringify([msg]),
            })
            .execute()
            .then((x) => {
              serverId = x[0].insertId
              return x
            })

          return from(
            insert.then((x) =>
              Object.assign({}, msg, { serverId: Number(x[0].insertId) })
            )
          )
        } else {
          return of(Object.assign({}, msg, { serverId: Number(serverId) }))
        }
      }),
      share()
    )

    resp
      .pipe(
        toArray(),
        mergeMap(async (newMsgs) => {
          const filteredNewMsgs: MessageParam[] = newMsgs.map((msg: any) =>
            pick(msg, ['content', 'role'])
          )

          const fullMessageLog = [...previousMessages, ...filteredNewMsgs]

          await this.runtime.db
            .updateTable('automationLogs')
            .set({
              type: 'manual',
              messageLog: JSON.stringify(fullMessageLog),
            })
            .where('id', '=', Number(serverId!))
            .execute()
        })
      )
      .subscribe()

    return resp
  }

  runEvals(
    model: string,
    driver: string,
    type: 'all' | 'quick',
    count: number
  ): Observable<ScenarioResult> {
    const counter = generate({
      initialState: 0,
      iterate: (x) => x + 1,
      condition: (x) => x < count,
    })

    const runEvals = type === 'all' ? runAllEvals : runQuickEvals
    return from(
      counter.pipe(
        concatMap(() =>
          runEvals(() => createDefaultLLMProvider(this.config, driver, model))
        )
      )
    )
  }

  captureBugReport(): Observable<void> {
    return from(this._captureBugReport())
  }

  async _captureBugReport(): Promise<void> {
    const services = await this.runtime.api.fetchServices()
    const states = await this.runtime.api.fetchStates()

    const toSave: BugReportData = {
      timezone: this.runtime.timezone,
      cues: this.runtime.cueList,
      automations: this.runtime.automationList,
      notebookRoot: this.runtime.notebookDirectory,
      services,
      states,
    }

    await this.runtime.db
      .insertInto('logs')
      .values({
        level: 100,
        createdAt: DateTime.now().toISO(),
        message: JSON.stringify(toSave),
      })
      .execute()

    await sql`VACUUM`.execute(this.runtime.db)
  }

  listNotebookFiles(): Observable<string[]> {
    return from(
      (async () => {
        const pattern = '**/*'
        const files = await glob(pattern, {
          cwd: this.notebookDirectory,
          nodir: true,
          absolute: false,
        })
        return files
      })()
    )
  }

  readNotebookFile(filePath: string): Observable<string> {
    return from(
      (async () => {
        const fullPath = path.resolve(this.notebookDirectory, filePath)
        if (!fullPath.startsWith(this.notebookDirectory)) {
          throw new Error('Invalid file path')
        }
        return await fs.readFile(fullPath, 'utf-8')
      })()
    )
  }

  writeNotebookFile(filePath: string, content: string): Observable<void> {
    return from(
      (async () => {
        const fullPath = path.resolve(this.notebookDirectory, filePath)

        if (!fullPath.startsWith(this.notebookDirectory)) {
          throw new Error('Invalid file path')
        }

        const dir = path.dirname(fullPath)
        await fs.mkdir(dir, { recursive: true })

        await fs.writeFile(fullPath, content, 'utf-8')
        i('Saved notebook file: %s', filePath)
      })()
    )
  }

  // Implementation for creating new files
  createNotebookFile(
    fileName: string,
    type: 'cue' | 'automation'
  ): Observable<{ relativePath: string }> {
    return from(
      (async () => {
        const subfolder = type === 'cue' ? 'cues' : 'automations'
        const targetDirectory = path.resolve(this.notebookDirectory, subfolder)

        // Basic filename sanitization
        let sanitizedFileName = fileName.trim()
        if (
          !sanitizedFileName ||
          sanitizedFileName === '.' ||
          sanitizedFileName === '..'
        ) {
          throw new Error('Invalid file name.')
        }
        // Remove potentially problematic characters (allow letters, numbers, underscore, hyphen, dot)
        sanitizedFileName = sanitizedFileName.replace(/[^a-zA-Z0-9_.-]/g, '_')
        // Prevent path traversal by ensuring no slashes remain
        if (
          sanitizedFileName.includes('/') ||
          sanitizedFileName.includes('\\')
        ) {
          throw new Error('File name cannot contain path separators.')
        }

        // Add default extension if missing (e.g., .md)
        // Let's decide against this for now to allow flexibility, user can name it fully.
        // if (!sanitizedFileName.includes('.')) {
        //    sanitizedFileName += '.md';
        // }

        const relativePath = path.join(subfolder, sanitizedFileName)
        const fullPath = path.resolve(this.notebookDirectory, relativePath)

        // Security: Final check to ensure the resolved path is within the target subfolder
        if (
          !fullPath.startsWith(targetDirectory + path.sep) &&
          fullPath !== targetDirectory /* In case filename makes it the dir */
        ) {
          // Check if the path is exactly the target directory (filename was empty/dots after sanitize?)
          if (fullPath === targetDirectory) {
            throw new Error('Invalid file name results in directory path.')
          }
          console.error(
            `Path traversal attempt detected: ${fullPath} vs ${targetDirectory}`
          )
          throw new Error('Security violation: Invalid path construction.')
        }

        // Ensure directory exists
        await fs.mkdir(targetDirectory, { recursive: true })

        try {
          // Create file with 'wx' flag to fail if it already exists
          await fs.writeFile(fullPath, '\n', { flag: 'wx' })
          i('Created new notebook file: %s', relativePath)
          return { relativePath }
        } catch (error: any) {
          if (error.code === 'EEXIST') {
            throw new Error(`File already exists: ${relativePath}`)
          } else {
            throw error // Re-throw other errors
          }
        }
      })()
    )
  }
}
