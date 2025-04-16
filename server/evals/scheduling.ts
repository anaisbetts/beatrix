import { deepEquals } from 'bun'
import { Kysely } from 'kysely'

import {
  CronSignal,
  RelativeTimeSignal,
  SignalData,
  StateRegexSignal,
} from '../../shared/types'
import { Schema } from '../db-schema'
import {
  createEvalRuntime,
  failureGrader,
  runScenario,
} from '../eval-framework'
import { LargeLanguageProvider } from '../llm'
import { automationFromString } from '../workflow/parser'
import {
  createDefaultSchedulerTools,
  schedulerPrompt,
} from '../workflow/scheduler-step'

export async function* simplestSchedulerEval(llm: LargeLanguageProvider) {
  const inputAutomation = automationFromString(
    'Every Monday at 8:00 AM, turn on the living room lights.',
    'test_automation.md',
    true
  )

  const service = await createEvalRuntime(llm)
  const tools = createDefaultSchedulerTools(service, inputAutomation)

  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation.contents, ''),
    tools,
    'Evaled scheduler tools',
    [
      failureGrader(),
      findSingularScheduleGrader(service.db, 'cron', {
        type: 'cron',
        cron: '0 8 * * 1',
      }),
    ]
  )
}

function findSingularScheduleGrader(
  db: Kysely<Schema>,
  expectedType: string,
  expectedData: SignalData
) {
  return async () => {
    let points = 0
    const rows = await db.selectFrom('signals').selectAll().execute()

    // Basic checks first to avoid errors on empty results
    if (!rows || rows.length === 0) {
      return {
        score: 0,
        possibleScore: 4,
        graderInfo: 'Found 0 signals, expected 1.',
      }
    }
    if (rows.length > 1) {
      return {
        score: 0, // Penalize extra signals
        possibleScore: 4,
        graderInfo: `Found ${rows.length} signals, expected 1.`,
      }
    }

    // Now we know rows.length === 1
    points += 1 // Point for correct count

    const row = rows[0]
    let parsedData: any = null
    try {
      parsedData = JSON.parse(row.data)
    } catch (e) {
      return {
        score: points, // Keep points for count
        possibleScore: 4,
        graderInfo: `Found 1 signal, but failed to parse data: ${row.data}. Error: ${e}`,
      }
    }

    if (row.type === expectedType) {
      points += 1 // Point for correct type
    }

    // Construct the full trigger object from parsed data + type
    let foundSignal: SignalData | null = null
    switch (row.type) {
      case 'cron':
        foundSignal = { type: 'cron', cron: parsedData.cron }
        break
      case 'state':
        foundSignal = {
          type: 'state',
          entityIds: parsedData.entityIds,
          regex: parsedData.regex,
        }
        break
      case 'offset':
        foundSignal = {
          type: 'offset',
          offsetInSeconds: parsedData.offsetInSeconds,
        }
        break
      case 'time':
        foundSignal = { type: 'time', iso8601Time: parsedData.iso8601Time }
        break
    }

    if (foundSignal && deepEquals(foundSignal, expectedData)) {
      points += 2 // Points for correct data
    }

    return {
      score: points,
      possibleScore: 4,
      graderInfo: `Found ${rows.length} signals. Type match: ${row.type === expectedType}. Data match: ${foundSignal && deepEquals(foundSignal, expectedData)}. Expected: ${JSON.stringify(expectedData)}, Found: ${row.data}`,
    }
  }
}

function findMultipleSchedulesGrader(
  db: Kysely<Schema>,
  expectedSignals: SignalData[]
) {
  return async () => {
    const rows = await db.selectFrom('signals').selectAll().execute()
    let points = 0
    const possibleScore = expectedSignals.length * 2 + 1

    const foundSignals: SignalData[] = rows.map((row) => {
      const data = JSON.parse(row.data)
      switch (row.type) {
        case 'cron':
          return { type: 'cron', cron: data.cron }
        case 'state':
          return {
            type: 'state',
            entityIds: data.entityIds,
            regex: data.regex,
          }
        case 'offset':
          return {
            type: 'offset',
            offsetInSeconds: data.offsetInSeconds,
          }
        case 'time':
          return {
            type: 'time',
            iso8601Time: data.iso8601Time,
          }
        default:
          console.warn(`Unknown trigger type found in DB: ${row.type}`)
          return { type: row.type, ...data }
      }
    })

    if (rows.length === expectedSignals.length) {
      points += 1
    }

    let matches = 0
    const remainingExpected = [...expectedSignals]
    const remainingFound = [...foundSignals]

    for (let i = remainingFound.length - 1; i >= 0; i--) {
      const found = remainingFound[i]
      const matchingExpectedIndex = remainingExpected.findIndex((expected) =>
        deepEquals(found, expected)
      )
      if (matchingExpectedIndex !== -1) {
        matches++
        remainingFound.splice(i, 1)
        remainingExpected.splice(matchingExpectedIndex, 1)
      }
    }

    points += matches * 2

    const graderInfo = `Found ${rows.length} signals (${matches} matched). Expected: ${JSON.stringify(expectedSignals)}, Found: ${JSON.stringify(foundSignals)}`

    return {
      score: points,
      possibleScore,
      graderInfo,
    }
  }
}

// --- Consolidated Absolute Time Evals ---
export async function* evalAbsoluteTimePrompts(llm: LargeLanguageProvider) {
  // Scenario 1: Single specific date/time
  // const prompt1 =
  //   'Schedule my bedroom chandelier to turn on at 7:15am on April 25th, 2025'
  // const inputAutomation1 = automationFromString(prompt1, 'test_automation.md')
  // const service1 = await createEvalRuntime(llm)

  // Scenario 2: Daily on/off (becomes cron)
  const prompt2 =
    'Set the foyer floor lights on at 7:00am and off at 8:00pm every day'
  const inputAutomation2 = automationFromString(
    prompt2,
    'test_automation.md',
    true
  )
  const service2 = await createEvalRuntime(llm)
  const tools2 = createDefaultSchedulerTools(service2, inputAutomation2)
  const expected2: CronSignal[] = [
    { type: 'cron', cron: '0 7 * * *' },
    { type: 'cron', cron: '0 20 * * *' },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation2.contents, ''),
    tools2,
    'Eval Absolute Time: Daily on/off (becomes cron)',
    [failureGrader(), findMultipleSchedulesGrader(service2.db, expected2)]
  )

  // Scenario 7: Multiple times daily (becomes cron)
  const prompt7 = 'Turn off all lights in the house at 11:00pm and 3:00am'
  const inputAutomation7 = automationFromString(
    prompt7,
    'test_automation.md',
    true
  )
  const service7 = await createEvalRuntime(llm)
  const tools7 = createDefaultSchedulerTools(service7, inputAutomation7)
  const expected7: CronSignal[] = [
    { type: 'cron', cron: '0 23 * * *' },
    { type: 'cron', cron: '0 3 * * *' },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation7.contents, ''),
    tools7,
    'Eval Absolute Time: Multiple times daily (becomes cron)',
    [failureGrader(), findMultipleSchedulesGrader(service7.db, expected7)]
  )

  // Scenario 8: Multiple specific times daily (becomes cron)
  const prompt8 =
    'Send me a message at 8:00am, 12:00pm, and 5:00pm to take my medication'
  const inputAutomation8 = automationFromString(
    prompt8,
    'test_automation.md',
    true
  )
  const service8 = await createEvalRuntime(llm)
  const tools8 = createDefaultSchedulerTools(service8, inputAutomation8)
  const expected8: CronSignal[] = [
    { type: 'cron', cron: '0 8 * * *' },
    { type: 'cron', cron: '0 12 * * *' },
    { type: 'cron', cron: '0 17 * * *' },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation8.contents, ''),
    tools8,
    'Eval Absolute Time: Multiple specific times daily (becomes cron)',
    [failureGrader(), findMultipleSchedulesGrader(service8.db, expected8)]
  )

  // Scenario 9: Weekday/Weekend split (becomes cron)
  const prompt9 =
    'Turn on the kitchen dining room chandelier at 6:45am on weekdays and 8:30am on weekends'
  const inputAutomation9 = automationFromString(
    prompt9,
    'test_automation.md',
    true
  )
  const service9 = await createEvalRuntime(llm)
  const tools9 = createDefaultSchedulerTools(service9, inputAutomation9)
  const expected9: CronSignal[] = [
    { type: 'cron', cron: '45 6 * * 1-5' },
    { type: 'cron', cron: '30 8 * * 0,6' },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation9.contents, ''),
    tools9,
    'Eval Absolute Time: Weekday/Weekend split (becomes cron)',
    [failureGrader(), findMultipleSchedulesGrader(service9.db, expected9)]
  )
}

// --- Consolidated Cron Evals ---
export async function* evalCronPrompts(llm: LargeLanguageProvider) {
  // Scenario 2: Weekday specific time
  const prompt2 = 'Turn on the bathroom overhead light at 8:00am on weekdays'
  const inputAutomation2 = automationFromString(
    prompt2,
    'test_automation.md',
    true
  )
  const service2 = await createEvalRuntime(llm)
  const tools2 = createDefaultSchedulerTools(service2, inputAutomation2)
  const expected2: CronSignal = {
    type: 'cron',
    cron: '0 8 * * 1-5',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation2.contents, ''),
    tools2,
    'Eval Cron: Weekday specific time',
    [
      failureGrader(),
      findSingularScheduleGrader(service2.db, expected2.type, expected2),
    ]
  )

  // Scenario 3: End of month (becomes start of next month)
  const prompt3 = 'At the end of the month, announce to drink water'
  const inputAutomation3 = automationFromString(
    prompt3,
    'test_automation.md',
    true
  )
  const service3 = await createEvalRuntime(llm)
  const tools3 = createDefaultSchedulerTools(service3, inputAutomation3)
  const expected3: CronSignal = {
    type: 'cron',
    cron: '0 0 1 * *',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation3.contents, ''),
    tools3,
    'Eval Cron: End of month (becomes start of next month)',
    [
      failureGrader(),
      findSingularScheduleGrader(service3.db, expected3.type, expected3),
    ]
  )
}

// --- Consolidated Mixed Signal Evals ---
export async function* evalMixedPrompts(llm: LargeLanguageProvider) {
  // Scenario 1: Sunset and Sunrise (becomes state triggers)
  const prompt1 =
    'Turn on the foyer bird sconces at sunset and turn them off at sunrise'
  const inputAutomation1 = automationFromString(
    prompt1,
    'test_automation.md',
    true
  )
  const service1 = await createEvalRuntime(llm)
  const tools1 = createDefaultSchedulerTools(service1, inputAutomation1)
  const expected1: StateRegexSignal[] = [
    { type: 'state', entityIds: ['sun.sun'], regex: '^below_horizon$' },
    { type: 'state', entityIds: ['sun.sun'], regex: '^above_horizon$' },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation1.contents, ''),
    tools1,
    'Eval Mixed: Sunset and Sunrise (becomes state triggers)',
    [failureGrader(), findMultipleSchedulesGrader(service1.db, expected1)]
  )

  // Scenario 2: State trigger (person arrives)
  const prompt2 =
    'When ani arrives home, turn on the living room overhead light and set night mode to off'
  const inputAutomation2 = automationFromString(
    prompt2,
    'test_automation.md',
    true
  )
  const service2 = await createEvalRuntime(llm)
  const tools2 = createDefaultSchedulerTools(service2, inputAutomation2)
  const expected2: StateRegexSignal = {
    type: 'state',
    entityIds: ['person.ani'],
    regex: '^home$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation2.contents, ''),
    tools2,
    'Eval Mixed: State trigger (person arrives)',
    [
      failureGrader(),
      findSingularScheduleGrader(service2.db, expected2.type, expected2),
    ]
  )

  // Scenario 3: Time condition (becomes cron) + state condition
  const prompt3 =
    "If it's after 10pm and the sync box is still on, announce to go to bed"
  const inputAutomation3 = automationFromString(
    prompt3,
    'test_automation.md',
    true
  )
  const service3 = await createEvalRuntime(llm)
  const tools3 = createDefaultSchedulerTools(service3, inputAutomation3)
  const expected3: CronSignal = {
    type: 'cron',
    cron: '0 22 * * *',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation3.contents, ''),
    tools3,
    'Eval Mixed: Time condition (becomes cron) + state condition',
    [
      failureGrader(),
      findSingularScheduleGrader(service3.db, expected3.type, expected3),
    ]
  )

  // Scenario 4: State trigger (relative time handled post-trigger)
  const prompt4 =
    'Turn off all the lights 30 minutes after night mode has been turned on'
  const inputAutomation4 = automationFromString(
    prompt4,
    'test_automation.md',
    true
  )
  const service4 = await createEvalRuntime(llm)
  const tools4 = createDefaultSchedulerTools(service4, inputAutomation4)
  const expected4: StateRegexSignal = {
    type: 'state',
    entityIds: ['input_boolean.night_mode'],
    regex: '^on$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation4.contents, ''),
    tools4,
    'Eval Mixed: State trigger (relative time handled post-trigger)',
    [
      failureGrader(),
      findSingularScheduleGrader(service4.db, expected4.type, expected4),
    ]
  )

  // Scenario 5: Cron and State trigger
  const prompt5 =
    'Every morning at 8am and when red alert is turned on, announce to be careful'
  const inputAutomation5 = automationFromString(
    prompt5,
    'test_automation.md',
    true
  )
  const service5 = await createEvalRuntime(llm)
  const tools5 = createDefaultSchedulerTools(service5, inputAutomation5)
  const expected5: (CronSignal | StateRegexSignal)[] = [
    { type: 'cron', cron: '0 8 * * *' },
    {
      type: 'state',
      entityIds: ['input_boolean.red_alert'],
      regex: '^on$',
    },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation5.contents, ''),
    tools5,
    'Eval Mixed: Cron and State trigger',
    [failureGrader(), findMultipleSchedulesGrader(service5.db, expected5)]
  )

  // Scenario 6: Cron or State trigger
  const prompt6 =
    'Turn off the foyer overhead light at 11pm or when everyone leaves the house'
  const inputAutomation6 = automationFromString(
    prompt6,
    'test_automation.md',
    true
  )
  const service6 = await createEvalRuntime(llm)
  const tools6 = createDefaultSchedulerTools(service6, inputAutomation6)
  const expected6: (CronSignal | StateRegexSignal)[] = [
    { type: 'cron', cron: '0 23 * * *' },
    {
      type: 'state',
      entityIds: ['group.all_people'],
      regex: '^not_home$',
    },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation6.contents, ''),
    tools6,
    'Eval Mixed: Cron or State trigger',
    [failureGrader(), findMultipleSchedulesGrader(service6.db, expected6)]
  )

  // Scenario 7: Sunset trigger with complex state/duration condition
  const prompt7 =
    'If the office overhead light has been on for more than 15 minutes after sunset, announce to check the office'
  const inputAutomation7 = automationFromString(
    prompt7,
    'test_automation.md',
    true
  )
  const service7 = await createEvalRuntime(llm)
  const tools7 = createDefaultSchedulerTools(service7, inputAutomation7)
  const expected7: StateRegexSignal = {
    type: 'state',
    entityIds: ['sun.sun'],
    regex: '^below_horizon$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation7.contents, ''),
    tools7,
    'Eval Mixed: Sunset trigger with complex state/duration condition',
    [
      failureGrader(),
      findSingularScheduleGrader(service7.db, expected7.type, expected7),
    ]
  )

  // Scenario 9: Cron and State trigger (with time condition on state)
  const prompt9 =
    'Set the kitchen dining room chandelier to on at 10pm and if someone enters the kitchen between 10pm and 6am'
  const inputAutomation9 = automationFromString(
    prompt9,
    'test_automation.md',
    true
  )
  const service9 = await createEvalRuntime(llm)
  const tools9 = createDefaultSchedulerTools(service9, inputAutomation9)
  const expected9: (CronSignal | StateRegexSignal)[] = [
    { type: 'cron', cron: '0 22 * * *' },
    {
      type: 'state',
      entityIds: ['binary_sensor.kitchen_motion'],
      regex: '^on$',
    },
  ]
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation9.contents, ''),
    tools9,
    'Eval Mixed: Cron and State trigger (with time condition on state)',
    [failureGrader(), findMultipleSchedulesGrader(service9.db, expected9)]
  )
}

// --- Consolidated Relative Time Evals ---
export async function* evalRelativeTimePrompts(llm: LargeLanguageProvider) {
  // Scenario 1: State trigger (offset handled post-trigger)
  const prompt1 =
    'Turn off the living room overhead light 30 minutes after ani leaves the house'
  const inputAutomation1 = automationFromString(
    prompt1,
    'test_automation.md',
    true
  )
  const service1 = await createEvalRuntime(llm)
  const tools1 = createDefaultSchedulerTools(service1, inputAutomation1)
  const expected1: StateRegexSignal = {
    type: 'state',
    entityIds: ['person.ani'],
    regex: '^not_home$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation1.contents, ''),
    tools1,
    'Eval Relative Time: State trigger (offset handled post-trigger)',
    [
      failureGrader(),
      findSingularScheduleGrader(service1.db, expected1.type, expected1),
    ]
  )

  // Scenario 2: Simple offset trigger
  const prompt2 = 'Announce to check on dinner in 45 minutes'
  const inputAutomation2 = automationFromString(
    prompt2,
    'test_automation.md',
    true
  )
  const service2 = await createEvalRuntime(llm)
  const tools2 = createDefaultSchedulerTools(service2, inputAutomation2)
  const expected2: RelativeTimeSignal = {
    type: 'offset',
    offsetInSeconds: 45 * 60,
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation2.contents, ''),
    tools2,
    'Eval Relative Time: Simple offset trigger',
    [
      failureGrader(),
      findSingularScheduleGrader(service2.db, expected2.type, expected2),
    ]
  )

  // Scenario 4: Group state trigger (offset handled post-trigger)
  const prompt4 =
    'Announce on cleaning music 10 minutes after everyone has left the house'
  const inputAutomation4 = automationFromString(
    prompt4,
    'test_automation.md',
    true
  )
  const service4 = await createEvalRuntime(llm)
  const tools4 = createDefaultSchedulerTools(service4, inputAutomation4)
  const expected4: StateRegexSignal = {
    type: 'state',
    entityIds: ['group.all_people'],
    regex: '^not_home$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation4.contents, ''),
    tools4,
    'Eval Relative Time: Group state trigger (offset handled post-trigger)',
    [
      failureGrader(),
      findSingularScheduleGrader(service4.db, expected4.type, expected4),
    ]
  )

  // Scenario 5: Recurring action with state condition (becomes cron)
  const prompt5 =
    'Announce every 15 minutes reminding to drink water while ani is home'
  const inputAutomation5 = automationFromString(
    prompt5,
    'test_automation.md',
    true
  )
  const service5 = await createEvalRuntime(llm)
  const tools5 = createDefaultSchedulerTools(service5, inputAutomation5)
  const expected5: CronSignal = {
    type: 'cron',
    cron: '*/15 * * * *',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation5.contents, ''),
    tools5,
    'Eval Relative Time: Recurring action with state condition (becomes cron)',
    [
      failureGrader(),
      findSingularScheduleGrader(service5.db, expected5.type, expected5),
    ]
  )

  // Scenario 7: Recurring action after specific time (becomes cron)
  const prompt7 =
    'Increase the brightness of the office overhead light by 10% every 30 minutes starting at 4pm'
  const inputAutomation7 = automationFromString(
    prompt7,
    'test_automation.md',
    true
  )
  const service7 = await createEvalRuntime(llm)
  const tools7 = createDefaultSchedulerTools(service7, inputAutomation7)
  const expected7: CronSignal = {
    type: 'cron',
    cron: '0,30 16-23 * * *',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation7.contents, ''),
    tools7,
    'Eval Relative Time: Recurring action after specific time (becomes cron)',
    [
      failureGrader(),
      findSingularScheduleGrader(service7.db, expected7.type, expected7),
    ]
  )
}

// --- Consolidated State Regex Evals ---
export async function* evalStateRegexPrompts(llm: LargeLanguageProvider) {
  // Scenario 1: Any person arrives (group state)
  const prompt1 = 'Turn on the foyer bird sconces when any person arrives home'
  const inputAutomation1 = automationFromString(
    prompt1,
    'test_automation.md',
    true
  )
  const service1 = await createEvalRuntime(llm)
  const tools1 = createDefaultSchedulerTools(service1, inputAutomation1)
  const expected1: StateRegexSignal = {
    type: 'state',
    entityIds: ['group.all_people'],
    regex: '^home$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation1.contents, ''),
    tools1,
    'Eval State Regex: Any person arrives (group state)',
    [
      failureGrader(),
      findSingularScheduleGrader(service1.db, expected1.type, expected1),
    ]
  )

  // Scenario 2: Specific entity turns off
  const prompt2 = 'Announce when sync box light sync turns off'
  const inputAutomation2 = automationFromString(
    prompt2,
    'test_automation.md',
    true
  )
  const service2 = await createEvalRuntime(llm)
  const tools2 = createDefaultSchedulerTools(service2, inputAutomation2)
  const expected2: StateRegexSignal = {
    type: 'state',
    entityIds: ['switch.sync_box_light_sync'],
    regex: '^off$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation2.contents, ''),
    tools2,
    'Eval State Regex: Specific entity turns off',
    [
      failureGrader(),
      findSingularScheduleGrader(service2.db, expected2.type, expected2),
    ]
  )

  // Scenario 4: Specific entity turns on
  const prompt4 =
    'Set the living room bookshelf light to on when sync box power turns on'
  const inputAutomation4 = automationFromString(
    prompt4,
    'test_automation.md',
    true
  )
  const service4 = await createEvalRuntime(llm)
  const tools4 = createDefaultSchedulerTools(service4, inputAutomation4)
  const expected4: StateRegexSignal = {
    type: 'state',
    entityIds: ['switch.sync_box_power'],
    regex: '^on$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation4.contents, ''),
    tools4,
    'Eval State Regex: Specific entity turns on',
    [
      failureGrader(),
      findSingularScheduleGrader(service4.db, expected4.type, expected4),
    ]
  )

  // Scenario 7: Update entity changes state (to on)
  // Note: Assuming a more specific entity ID pattern than before for better testing
  const prompt7 = 'Announce when esphome update changes from off to on'
  const inputAutomation7 = automationFromString(
    prompt7,
    'test_automation.md',
    true
  )
  const service7 = await createEvalRuntime(llm)
  const tools7 = createDefaultSchedulerTools(service7, inputAutomation7)
  const expected7: StateRegexSignal = {
    type: 'state',
    entityIds: ['update.esphome_some_device'], // Made specific for testability
    regex: '^on$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation7.contents, ''),
    tools7,
    'Eval State Regex: Update entity changes state (to on)',
    [
      failureGrader(),
      findSingularScheduleGrader(service7.db, expected7.type, expected7),
    ]
  )

  // Scenario 8: Input boolean turns off
  const prompt8 = 'Turn on night mode when red alert is turned off'
  const inputAutomation8 = automationFromString(
    prompt8,
    'test_automation.md',
    true
  )
  const service8 = await createEvalRuntime(llm)
  const tools8 = createDefaultSchedulerTools(service8, inputAutomation8)
  const expected8: StateRegexSignal = {
    type: 'state',
    entityIds: ['input_boolean.red_alert'],
    regex: '^off$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation8.contents, ''),
    tools8,
    'Eval State Regex: Input boolean turns off',
    [
      failureGrader(),
      findSingularScheduleGrader(service8.db, expected8.type, expected8),
    ]
  )
  // Scenario 9: Input boolean changes to on (Duplicate logic from MixedPrompt4, kept for coverage)
  const prompt9 = 'Turn off all lights when night mode changes to on'
  const inputAutomation9 = automationFromString(
    prompt9,
    'test_automation.md',
    true
  )
  const service9 = await createEvalRuntime(llm)
  const tools9 = createDefaultSchedulerTools(service9, inputAutomation9)
  const expected9: StateRegexSignal = {
    type: 'state',
    entityIds: ['input_boolean.night_mode'],
    regex: '^on$',
  }
  yield runScenario(
    llm,
    schedulerPrompt(inputAutomation9.contents, ''),
    tools9,
    'Eval State Regex: Input boolean changes to on',
    [
      failureGrader(),
      findSingularScheduleGrader(service9.db, expected9.type, expected9),
    ]
  )
}
