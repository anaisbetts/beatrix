import { describe, expect, it } from 'bun:test'
import { distribute, fillArray } from './math'

describe('the distribute method', () => {
  it('splits an array equally', () => {
    const input = fillArray(9, 0)
    const result = distribute(input, 3)

    expect(result.length).toBe(3)
    result.forEach((arr) => expect(arr.length).toBe(3))
  })
})
