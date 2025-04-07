import { describe, expect, it } from 'bun:test'
import { firstValueFrom, timer } from 'rxjs'

import { withTimeout } from './promise-extras'

async function waitThenThrow() {
  await firstValueFrom(timer(1000))
  throw new Error('no')
}

describe('the withTimeout function', () => {
  it('should let me catch stuff', async () => {
    let itThrew = false
    try {
      await withTimeout(waitThenThrow(), 10000)
    } catch {
      itThrew = true
    }

    expect(itThrew).toBe(true)
  })

  it('should timeout', async () => {
    let itThrew = false
    try {
      await withTimeout(firstValueFrom(timer(5000)), 100)
    } catch {
      itThrew = true
    }

    expect(itThrew).toBe(true)
  })
})
