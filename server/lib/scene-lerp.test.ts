import { describe, expect, it } from 'bun:test'

import {
  onOffTestFrom,
  onOffTestTo,
  testOneFrom,
  testOneSceneFrom,
  testOneSceneTo,
  testOneTo,
} from './mocks'
import { lerpEntity, lerpScene } from './scene-lerp'

describe('lerp-entity', () => {
  it('Can interpolate between two lights that are on', () => {
    const ret = lerpEntity(testOneFrom, testOneTo, 0.5)
    expect(ret.entity).toBe(testOneFrom.entity)
    expect(ret.entity).toBe(testOneTo.entity)

    expect(ret.state.brightness).toBeCloseTo(Math.floor((89 + 250) / 2))
    expect(ret.state.color_temp).toBeCloseTo((382 + 196) / 2)
  })

  it('First half of interpolation between off => on is off', () => {
    const inp = [0.0, 0.1, 0.3, 0.48]

    inp.forEach((t) => {
      const ret = lerpEntity(onOffTestFrom, onOffTestTo, t)
      expect(ret.state.state).toBe('off')
    })
  })

  it('Last half of interpolation between off => on is on', () => {
    const inp = [0.51, 0.8, 1.0]

    inp.forEach((t) => {
      const ret = lerpEntity(onOffTestFrom, onOffTestTo, t)
      expect(ret.state.state).toBe('on')
    })
  })
})

describe('lerpScene', () => {
  it('Can interpolate between two test scenes at 50%', () => {
    const ret = lerpScene(testOneSceneFrom, testOneSceneTo, 0.5)

    console.log(JSON.stringify(ret, null, 2))
    return
  })
})
