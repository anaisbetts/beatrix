import {
  callService,
  FriendlyStateEntity,
  HAAttributeList,
  Scene,
} from './ha-rest-api'

import { defaultValueFromExample, lerp } from './math'
import { asyncMap } from './promise-extras'

//const d = require('debug')('scene-lerp')
const d = console.log.bind(console)

// NB: Technically, we should actually care about this but it makes my code
// like 100000x more complicated so I'm gonna try to ignore it as long as I
// can. https://developers.home-assistant.io/docs/core/entity/light?_highlight=color&_highlight=mode#color-modes
// has the details around this particular mess.
const attributeIgnoreList = ['color_mode'].reduce(
  (acc, x) => {
    acc[x] = true
    return acc
  },
  {} as Record<string, boolean>
)

function dedupeIdenticalKeys(attributeKeys: string[]): string[] {
  // Home Assistant stores the same attribute key in multiple formats - if we
  // see the same ones throw out a few
  let ret = [...attributeKeys]

  const colorRe = /_color$/
  if (attributeKeys.filter((x) => colorRe.test(x)).length > 1) {
    ret = attributeKeys.filter((x) => !colorRe.test(x))
    ret.push('rgb_color')
  }

  // Deduplicate keys as well as filter out ones in our blocklist
  const dedup = ret.reduce(
    (acc, x) => {
      if (attributeIgnoreList[x]) return acc
      acc[x] = true
      return acc
    },
    {} as Record<string, boolean>
  )

  return Object.keys(dedup)
}

export function lerpEntity(
  from: FriendlyStateEntity,
  to: FriendlyStateEntity,
  t: number
): FriendlyStateEntity {
  // Generate a list of attributes to mutate
  const lerpedKeys = dedupeIdenticalKeys(
    [...Object.keys(from.state), ...Object.keys(to.state)].filter((k) => {
      if (JSON.stringify(from.state[k]) === JSON.stringify(to.state[k])) {
        return false
      }

      return true
    })
  )

  d(`Keys to lerp: ${JSON.stringify(lerpedKeys)}`)
  const state = lerpedKeys.reduce((acc, k) => {
    let [fromVal, toVal] = [from.state[k], to.state[k]]

    fromVal ??= defaultValueFromExample(toVal)
    toVal ??= defaultValueFromExample(fromVal)

    acc[k] = lerp(from.state[k], to.state[k], t)
    return acc
  }, {} as HAAttributeList)

  // NB: If we somehow transition from a color temp setting <=> an RGB
  // setting, we need to make sure we don't try to set both. If we do,
  // Home Assistant will throw an error.
  if (state.rgb_color && state.color_temp) {
    if (to.state.color_temp) {
      delete state.rgb_color
    } else {
      delete state.color_temp
    }
  }

  return {
    ...from,
    state,
  }
}

export function lerpScene(from: Scene, to: Scene, t: number) {
  return Object.keys(from.affects).reduce(
    (acc, entity) => {
      d(`Examining ${entity}`)
      if (!to.affects.hasOwnProperty(entity)) {
        d(`${entity} is in ${from.entity} but not ${to.entity}!`)
        return acc
      }

      acc[entity] = lerpEntity(from.affects[entity], to.affects[entity], t)
      return acc
    },
    {} as Record<string, FriendlyStateEntity>
  )
}

const ignoredStateKeys = ['state'].reduce(
  (acc, x) => {
    acc[x] = true
    return acc
  },
  {} as Record<string, boolean>
)

function filterIgnoredStateKeys(state: HAAttributeList) {
  return Object.keys(state).reduce((acc, k) => {
    if (ignoredStateKeys[k]) return acc

    acc[k] = state[k]
    return acc
  }, {} as HAAttributeList)
}

export async function applySceneTransition(
  toSet: Record<string, FriendlyStateEntity>
) {
  await asyncMap(
    Object.values(toSet),
    async (x) => {
      // NB: Right now we can only deal with lights
      if (!x.entity.startsWith('light.')) {
        return null
      }

      if (x.state.state === 'off') {
        await callService('light', 'turn_off', x.entity, {})
        return
      } else {
        await callService(
          'light',
          'turn_on',
          x.entity,
          filterIgnoredStateKeys(x.state)
        )
      }
    },
    4 /* at a time */
  )
}
