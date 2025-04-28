import { Observable, SchedulerLike, map, switchAll, timer } from 'rxjs'

interface GetAllPropertiesOptions {
  includeSymbols?: boolean
  includeNonEnumerable?: boolean
  includeFunctions?: boolean
  stopAtObject?: boolean
}

export function getAllProperties(
  obj: any,
  options: GetAllPropertiesOptions = {}
): string[] {
  // Default options
  const {
    includeSymbols = true,
    includeNonEnumerable = true,
    includeFunctions = true,
    stopAtObject = true,
  } = options

  // Set to keep track of properties we've already seen
  const seenProperties = new Set<string>()

  // Function to collect properties from a prototype
  function collectPropertiesFromPrototype(proto: object | null): void {
    if (!proto || (stopAtObject && proto === Object.prototype)) {
      return
    }

    // Get own property descriptors
    const descriptors = Object.getOwnPropertyDescriptors(proto)

    // Process each property
    for (const [key, descriptor] of Object.entries(descriptors)) {
      // Skip if we've seen this property before
      if (seenProperties.has(key)) continue

      // Skip functions if specified
      if (!includeFunctions && typeof descriptor.value === 'function') continue

      // Add the property
      seenProperties.add(key)
    }

    // Add symbol properties if requested
    if (includeSymbols) {
      const symbols = Object.getOwnPropertySymbols(proto)
      for (const sym of symbols) {
        const key = sym.toString()
        if (!seenProperties.has(key)) {
          seenProperties.add(key)
        }
      }
    }

    // Recurse up the prototype chain
    collectPropertiesFromPrototype(Object.getPrototypeOf(proto))
  }

  // Get enumerable own properties
  Object.keys(obj).forEach((key) => seenProperties.add(key))

  // Get non-enumerable own properties if requested
  if (includeNonEnumerable) {
    Object.getOwnPropertyNames(obj).forEach((key) => seenProperties.add(key))
  }

  // Get symbol properties if requested
  if (includeSymbols) {
    Object.getOwnPropertySymbols(obj).forEach((sym) => {
      seenProperties.add(sym.toString())
    })
  }

  // Collect properties from the prototype chain
  collectPropertiesFromPrototype(Object.getPrototypeOf(obj))

  // Convert the set to an array and return
  return Array.from(seenProperties)
}

export function pick<T extends object, K extends keyof T>(
  obj: T,
  allowedKeys: K[]
): Pick<T, K> {
  return allowedKeys.reduce(
    (acc, key) => {
      acc[key] = obj[key]
      return acc
    },
    {} as Pick<T, K>
  )
}

export function omit<T extends object, K extends keyof T>(
  obj: T,
  disallowedKeys: K[]
): Omit<T, K> {
  const result = {} as Omit<T, K>
  const unk: any = result
  const disallowedKeysSet = new Set(disallowedKeys)

  getAllProperties(obj).forEach((key) => {
    if (!disallowedKeysSet.has(key as K)) {
      unk[key] = obj[key as keyof T]
    }
  })

  return result
}

export const guaranteedThrottle =
  <T>(time: number, scheduler?: SchedulerLike) =>
  (source: Observable<T>) => {
    return source.pipe(
      map((x: any) => timer(time, scheduler).pipe(map(() => x))),
      switchAll()
    )
  }
