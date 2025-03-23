export function clamp(min: number, n: number, max: number) {
  return Math.max(min, Math.min(n, max))
}

export function lerpNum(from: number, to: number, t: number, asInt = true) {
  const ret = (1 - t) * from + t * to
  return asInt ? Math.floor(ret) : ret
}

export function lerpArray(from: number[], to: number[], t: number) {
  return from.map((x, i) => lerpNum(x, to[i], t))
}

export function lerpState(from: string, to: string, t: number) {
  return t > 0.5 ? to : from
}

const defaultNumber = 0.0

export function fillArray(len: number, n: number) {
  return Array.from({ length: len }, () => n)
}

export function defaultValueFromExample(example: any) {
  if (typeof example === 'number') {
    return defaultNumber
  }

  if (Array.isArray(example)) {
    return fillArray(example.length, defaultNumber)
  }

  throw new Error(
    `Don't know how to create default value for ${JSON.stringify(example)}`
  )
}

export function lerp(from: any, to: any, t: number) {
  if (typeof from === 'number' || typeof to === 'number') {
    return lerpNum(
      from ?? defaultValueFromExample(to),
      to ?? defaultValueFromExample(from),
      t
    )
  }

  if (Array.isArray(from) || Array.isArray(to)) {
    return lerpArray(
      from ?? defaultValueFromExample(to),
      to ?? defaultValueFromExample(from),
      t
    )
  }

  if (typeof from === 'string' && typeof to === 'string') {
    return lerpState(from, to, t)
  }

  throw new Error(
    `Failed to Lerp: ${JSON.stringify(from)} => ${JSON.stringify(to)}`
  )
}

export function distribute<T>(arr: T[], bucketSize: number): Array<T[]> {
  return arr.reduce(
    (acc, x, n) => {
      const bucket = n % bucketSize
      acc[bucket] = acc[bucket] || []
      acc[bucket].push(x)

      return acc
    },
    [] as Array<T[]>
  )
}
