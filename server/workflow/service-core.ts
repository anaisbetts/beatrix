import { Kysely } from 'kysely'
import { Schema } from '../db-schema'
import { LargeLanguageProvider } from '../llm'
import { HomeAssistantApi } from '../lib/ha-ws-api'
import { Automation, parseAllAutomations } from './parser'
import { defer, from, map, merge, Observable, of, share, switchMap } from 'rxjs'
import { createBufferedDirectoryMonitor } from '../lib/directory-monitor'
import { rescheduleAutomations } from './scheduler-step'
import { CronTrigger } from '../mcp/scheduler'
import { Cron, parseCronExpression } from 'cron-schedule'
import { TimerBasedCronScheduler as scheduler } from 'cron-schedule/schedulers/timer-based.js'
import debug from 'debug'

const d = debug('ha:service')

export class ServiceCore {
  private automationList: Automation[]
  private reparseAutomations: Observable<void>
  private scannedAutomationDir: Observable<Automation[]>
  private createdSignalsForForAutomations: Observable<void>
  private signalFired: Observable<Automation>

  constructor(
    private readonly api: HomeAssistantApi,
    private readonly llm: LargeLanguageProvider,
    private readonly db: Kysely<Schema>,
    private readonly automationDirectory: string
  ) {
    this.automationList = []
    this.reparseAutomations = merge(
      of(), // Start on initial subscribe
      createBufferedDirectoryMonitor(
        {
          path: this.automationDirectory,
          recursive: true,
        },
        2000
      ).pipe(map(() => {}))
    )

    this.scannedAutomationDir = defer(() => this.reparseAutomations).pipe(
      switchMap(() => {
        d('Reparsing automations...')

        return from(
          parseAllAutomations(this.automationDirectory).then(
            (x) => (this.automationList = x)
          )
        )
      })
    )

    this.createdSignalsForForAutomations = defer(
      () => this.scannedAutomationDir
    ).pipe(
      switchMap((automations) => {
        d('Rescheduling automations...')

        return from(
          rescheduleAutomations(this.api, this.llm, this.db, automations)
        )
      })
    )

    this.signalFired = defer(() => this.createdSignalsForForAutomations).pipe(
      switchMap(() => from(this.observableForDatabaseSignals())),
      switchMap((x) => x)
    )
  }

  start() {
    return this.signalFired.subscribe()
  }

  private async observableForDatabaseSignals() {
    const observableList: Observable<Automation>[] = []

    d('Loading signals from database')
    const signals = await this.db.selectFrom('signals').selectAll().execute()

    for (const signal of signals) {
      const automation = this.automationList.find(
        (x) => x.hash === signal.automationHash
      )

      if (!automation) {
        d(
          'Found automation hash %s but not in our list? Deleting',
          signal.automationHash
        )

        await this.db
          .deleteFrom('signals')
          .where('automationHash', '=', signal.automationHash)

        continue
      }

      switch (signal.type) {
        case 'cron':
          d('Creating trigger for automation %s', signal.automationHash)

          const data: CronTrigger = JSON.parse(signal.data)
          const cron = parseCronExpression(data.cron)
          observableList.push(
            cronToObservable(cron).pipe(map(() => automation))
          )
          break
      }
    }

    return merge(...observableList)
  }
}

function cronToObservable(cron: Cron): Observable<void> {
  return new Observable<void>((subj) => {
    const handle = scheduler.setInterval(cron, () => {
      subj.next()
    })

    return () => scheduler.clearTimeoutOrInterval(handle)
  }).pipe(share())
}
