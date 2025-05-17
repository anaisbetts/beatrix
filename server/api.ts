import fs from 'node:fs/promises'
import path from 'node:path'
import { MessageParam } from '@anthropic-ai/sdk/resources/index.mjs'
import { glob } from 'glob'
import { sql } from 'kysely'
import { DateTime } from 'luxon'
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
  getAutomationDirectory,
  getCueDirectory,
  now,
} from './workflow/automation-runtime'
import { automationFromString } from './workflow/parser'

export class ServerWebsocketApiImpl implements ServerWebsocketApi {
  public constructor(
    public config: AppConfig,
    public runtime: AutomationRuntime,
    public notebookDirectory: string,
    public testMode: boolean,
    public evalMode: boolean
  ) {}

  getDriverList(): Observable<{
    automationModelWithDriver: string
    drivers: string[]
  }> {
    const drivers: string[] = []
    if (this.config.anthropicApiKey) {
      drivers.push('anthropic')
    }
    if (this.config.ollamaHost) {
      drivers.push('ollama')
    }
    if (this.config.openAIProviders && this.config.openAIProviders.length > 0) {
      drivers.push(
        ...this.config.openAIProviders.map((x) => x.providerName ?? 'openai')
      )
    }

    return of({
      automationModelWithDriver: this.config.automationModel ?? '',
      drivers,
    })
  }

  getModelListForDriver(driver: string): Observable<{ models: string[] }> {
    const llm = createDefaultLLMProvider(this.config, {
      modelWithDriver: `${driver}/dontcare`,
    })

    return from(
      llm.getModelList().then((models) => ({
        models,
      }))
    )
  }

  getAutomationLogs(beforeTimestamp?: Date): Observable<AutomationLogEntry[]> {
    return from(
      fetchAutomationLogs(
        this.runtime.db,
        this.runtime.automationList,
        beforeTimestamp
          ? DateTime.fromJSDate(beforeTimestamp).setZone(this.runtime.timezone)
          : undefined
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
        const ret = structuredClone(
          pick(x, [
            'automation',
            'friendlySignalDescription',
            'isValid',
            'signal',
          ])
        )

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
    modelWithDriver: string,
    previousConversationId?: number,
    typeHint?: TypeHint
  ): Observable<MessageParamWithExtras> {
    const rqRuntime = new LiveAutomationRuntime(
      this.runtime.api,
      (modelSpec) => createDefaultLLMProvider(this.config, modelSpec),
      this.runtime.db,
      this.notebookDirectory
    )

    // Track referenced images during this prompt request
    const referencedImages: Record<string, ArrayBufferLike> = {}

    const tools = createBuiltinServers(rqRuntime, null, {
      testMode: this.testMode || this.evalMode,
      includeCueServer: typeHint === 'chat',
      onImageReferenced: (name: string, bytes: ArrayBufferLike) => {
        referencedImages[name] = bytes
      },
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
        const llm = this.runtime.llmFactory({
          modelWithDriver,
        })
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

          // Store any referenced images in the database
          const imageEntries = Object.entries(referencedImages)
          if (imageEntries.length > 0) {
            for (const [name, bytes] of imageEntries) {
              await this.runtime.db
                .insertInto('images')
                .values({
                  automationLogId: Number(serverId!),
                  createdAt: now(this.runtime).toISO()!,
                  bytes: Buffer.from(bytes),
                })
                .execute()
              i('Saved image reference: %s for log %d', name, Number(serverId!))
            }
          }
        })
      )
      .subscribe()

    return resp
  }

  runEvals(
    modelWithDriver: string,
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
          runEvals(() =>
            createDefaultLLMProvider(this.config, { modelWithDriver })
          )
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
        const targetDirectory =
          type == 'cue'
            ? getCueDirectory(this.runtime)
            : getAutomationDirectory(this.runtime)

        const target = path.resolve(targetDirectory, fileName)
        if (!target.startsWith(targetDirectory)) {
          throw new Error('Cannot write outside directory')
        }

        await fs.mkdir(path.dirname(target), { recursive: true })

        const relativePath = target.replace(`${targetDirectory}${path.sep}`, '')
        try {
          // Create file with 'wx' flag to fail if it already exists
          await fs.writeFile(target, '\n', { flag: 'wx' })
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
