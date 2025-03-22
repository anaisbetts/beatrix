import debug from 'debug'
import {
  createLongLivedTokenAuth,
  createConnection,
  Connection,
  HassEventBase,
  HassServices,
} from 'home-assistant-js-websocket'
import { LRUCache } from 'lru-cache'

import { Observable, Subscription } from 'rxjs'

const d = debug('ha:ws')

export interface HassState {
  entity_id: string
  state: string
  attributes: Record<string, any>
  last_changed: string
  last_reported: string
  last_updated: string
}

interface HAPersonInformation {
  name: string
  notifiers: string[]
  state: string
}

export interface CallServiceOptions {
  domain: string
  service: string
  service_data?: Record<string, any>
  target?: {
    entity_id?: string | string[]
    device_id?: string | string[]
    area_id?: string | string[]
  }
  return_response?: boolean
}

export async function connectToHAWebsocket() {
  const auth = createLongLivedTokenAuth(
    process.env.HA_BASE_URL!,
    process.env.HA_TOKEN!
  )

  const connection = await createConnection({ auth })
  return connection
}

const cache = new LRUCache<string, any>({
  ttl: 5 * 60 * 1000,
  max: 100,
  ttlAutopurge: false,
})

export async function fetchServices(
  connection: Connection
): Promise<HassServices> {
  if (cache.has('services')) {
    return cache.get('services') as HassServices
  }

  const ret = await connection.sendMessagePromise<HassServices>({
    type: 'get_services',
  })

  cache.set('services', ret)
  return ret
}

export async function fetchStates(
  connection: Connection
): Promise<HassState[]> {
  if (cache.has('states')) {
    return cache.get('states') as HassState[]
  }

  const ret = await connection.sendMessagePromise<HassState[]>({
    type: 'get_states',
  })

  ret.forEach((x: any) => delete x.context)
  cache.set('states', ret, { ttl: 1000 })
  return ret
}

export function eventsObservable(
  connection: Connection
): Observable<HassEventBase> {
  return new Observable((subj) => {
    const disp = new Subscription()

    connection
      .subscribeEvents<HassEventBase>((ev) => subj.next(ev))
      .then(
        (unsub) => disp.add(() => void unsub()),
        (err) => subj.error(err)
      )

    return disp
  })
}

export async function fetchHAUserInformation(connection: Connection) {
  const states = await fetchStates(connection)

  const people = states.filter((state) => state.entity_id.startsWith('person.'))
  d('people: %o', people)

  const ret = people.reduce(
    (acc, x) => {
      const name =
        (x.attributes.friendly_name as string) ??
        x.entity_id.replace('person.', '')

      const notifiers = ((x.attributes.device_trackers as string[]) ?? []).map(
        (t: string) => deviceTrackerNameToNotifyName(t)
      )

      acc[x.entity_id.replace('person.', '')] = {
        name,
        notifiers,
        state: x.state,
      }

      return acc
    },
    {} as Record<string, HAPersonInformation>
  )

  d('ret: %o', ret)
  return ret
}

export async function extractNotifiers(svcs: HassServices) {
  return Object.keys(svcs.notify).reduce(
    (acc, k) => {
      if (k === 'persistent_notification' || k === 'send_message') {
        return acc
      }

      const service = svcs.notify[k]
      acc.push({ name: k, description: service.name! })
      return acc
    },
    [] as { name: string; description: string }[]
  )
}

export async function sendNotification(
  testMode: boolean,
  connection: Connection,
  target: string,
  message: string,
  title: string | undefined
) {
  if (testMode) {
    const svcs = await fetchServices(connection)
    const notifiers = await extractNotifiers(svcs)

    if (!notifiers.find((n) => n.name === target)) {
      throw new Error('Target not found')
    }
  } else {
    await connection.sendMessagePromise({
      type: 'call_service',
      domain: 'notify',
      service: target,
      service_data: { message, ...(title ? { title } : {}) },
    })
  }
}

export async function callService<T = any>(
  connection: Connection,
  options: CallServiceOptions,
  testMode = false
): Promise<T | null> {
  if (testMode) {
    // In test mode, validate that entity_id starts with domain
    const entityId = options.target?.entity_id

    if (entityId) {
      // Handle both string and array cases
      const entities = Array.isArray(entityId) ? entityId : [entityId]

      for (const entity of entities) {
        if (!entity.startsWith(`${options.domain}.`)) {
          throw new Error(
            `Entity ID ${entity} doesn't match domain ${options.domain}`
          )
        }
      }
    }

    return null
  }

  const message = {
    type: 'call_service',
    ...options,
  }

  return connection.sendMessagePromise<T>(message)
}

function deviceTrackerNameToNotifyName(tracker: string) {
  // XXX: There is no nice way to do this and it sucks ass
  return `mobile_app_${tracker.replace('device_tracker.', '')}`
}

export function filterUncommonEntities(
  entities: HassState[],
  options: {
    includeUnavailable?: boolean
  } = {}
): HassState[] {
  // Default options
  const { includeUnavailable = false } = options

  // Domain-based filtering
  const LOW_VALUE_DOMAINS = [
    'update.',
    'device_tracker.',
    'button.',
    'binary_sensor.remote_ui',
    'conversation.',
    'stt.',
    'tts.',
    'number.', // Often configuration values
    'select.', // Often configuration options
  ]

  // Name-based pattern filtering
  const LOW_VALUE_PATTERNS = [
    '_uptime',
    '_cpu_utilization',
    '_memory_',
    '_battery_',
    '_uplink_mac',
    '_firmware',
    'debug_',
    '_identify',
    '_reboot',
    '_restart',
    '_power_cycle',
    '_fan_speed',
    '_signal',
    '_mac',
    '_version',
    '_bssid',
    '_ssid',
    '_ip',
    'hacs_',
    '_connectivity',
  ]

  // High-value domains to always include
  const HIGH_PRIORITY_DOMAINS = [
    'light.',
    'switch.',
    'climate.',
    'media_player.',
    'vacuum.',
    'cover.',
    'scene.',
    'script.',
  ]

  // Exception patterns that should be kept despite matching low-value patterns
  const EXCEPTION_PATTERNS = [
    'temperature_sensor', // Room temperature sensors are important
    'battery_level', // Overall battery level of critical devices
    'room_temperature', // Room temperature readings
  ]

  // Create maps to track devices and their entities
  const deviceGroups: Record<string, HassState[]> = {}
  const primaryEntities: HassState[] = []
  const utilityEntities: HassState[] = []

  // Step 1: Filter out unavailable/unknown entities if configured
  let filtered = includeUnavailable
    ? entities
    : entities.filter(
        (e) =>
          e.state !== 'unavailable' &&
          e.state !== 'unknown' &&
          changedRecently(new Date(e.last_changed), 24)
      )

  // Step 2: First pass - categorize entities
  filtered.forEach((entity) => {
    const { entity_id } = entity

    // Extract device/group name
    const parts = entity_id.split('.')
    const name = parts[1]

    // Try to extract base device name (without specific sensor type)
    // This helps group related entities like light.kitchen_light and binary_sensor.kitchen_light_overheating
    const deviceNameParts = name.split('_')
    // Find a meaningful device name - either the full name or remove the last part if it's a modifier
    let deviceKey = name

    // If the last part seems to be a modifier/attribute rather than part of the device name
    if (
      deviceNameParts.length > 1 &&
      [
        'light',
        'switch',
        'sensor',
        'temperature',
        'humidity',
        'motion',
        'battery',
      ].includes(deviceNameParts[deviceNameParts.length - 1])
    ) {
      deviceKey = deviceNameParts.slice(0, -1).join('_')
    }

    // Initialize group if it doesn't exist
    if (!deviceGroups[deviceKey]) {
      deviceGroups[deviceKey] = []
    }

    // Add to the appropriate device group
    deviceGroups[deviceKey].push(entity)

    // Check if it's a primary or utility entity
    const isPrimaryDomain = HIGH_PRIORITY_DOMAINS.some((d) =>
      entity_id.startsWith(d)
    )
    const isLowValueDomain = LOW_VALUE_DOMAINS.some((d) =>
      entity_id.startsWith(d)
    )
    const hasLowValuePattern = LOW_VALUE_PATTERNS.some((p) =>
      entity_id.includes(p)
    )
    const hasExceptionPattern = EXCEPTION_PATTERNS.some((p) =>
      entity_id.includes(p)
    )

    if (isPrimaryDomain || hasExceptionPattern) {
      primaryEntities.push(entity)
    } else if (isLowValueDomain || hasLowValuePattern) {
      utilityEntities.push(entity)
    } else {
      // For entities that don't clearly fit either category,
      // add to primary by default
      primaryEntities.push(entity)
    }
  })

  // Step 3: Process device groups to keep only essential entities
  const essentialEntities: HassState[] = []

  Object.entries(deviceGroups).forEach(([, deviceEntities]) => {
    // Skip empty groups
    if (deviceEntities.length === 0) return

    // Keep main controls (lights, switches) and core sensors
    const controlEntities = deviceEntities.filter((e) => {
      return (
        HIGH_PRIORITY_DOMAINS.some((d) => e.entity_id.startsWith(d)) ||
        e.entity_id.includes('temperature') ||
        e.entity_id.includes('humidity') ||
        e.entity_id.includes('occupancy') ||
        e.entity_id.includes('motion')
      )
    })

    // If we found control entities, add them
    if (controlEntities.length > 0) {
      essentialEntities.push(...controlEntities)
    } else {
      // If no control entities, keep the first entity as representative
      essentialEntities.push(deviceEntities[0])
    }
  })

  // Step 4: Add important primary entities that weren't in device groups
  primaryEntities.forEach((entity) => {
    if (!essentialEntities.some((e) => e.entity_id === entity.entity_id)) {
      essentialEntities.push(entity)
    }
  })

  // Step 5: Special handling for important entity types not caught above

  // Add important sensors like temperatures if not already included
  const temperatureSensors = filtered.filter(
    (e) =>
      e.entity_id.startsWith('sensor.') &&
      e.entity_id.includes('temperature') &&
      !e.entity_id.includes('device_temperature')
  )

  temperatureSensors.forEach((sensor) => {
    if (!essentialEntities.some((e) => e.entity_id === sensor.entity_id)) {
      essentialEntities.push(sensor)
    }
  })

  // Add person entities - these are usually important
  const personEntities = filtered.filter((e) =>
    e.entity_id.startsWith('person.')
  )
  personEntities.forEach((entity) => {
    if (!essentialEntities.some((e) => e.entity_id === entity.entity_id)) {
      essentialEntities.push(entity)
    }
  })

  // Step 6: Limit to maxEntities if needed
  const sortedEntities = essentialEntities.sort((a, b) => {
    // Sort primary domains first
    const aIsPrimary = HIGH_PRIORITY_DOMAINS.some((d) =>
      a.entity_id.startsWith(d)
    )
    const bIsPrimary = HIGH_PRIORITY_DOMAINS.some((d) =>
      b.entity_id.startsWith(d)
    )

    if (aIsPrimary && !bIsPrimary) return -1
    if (!aIsPrimary && bIsPrimary) return 1

    // Then sort by person entities
    const aIsPerson = a.entity_id.startsWith('person.')
    const bIsPerson = b.entity_id.startsWith('person.')

    if (aIsPerson && !bIsPerson) return -1
    if (!aIsPerson && bIsPerson) return 1

    // Default sort by entity_id
    return a.entity_id.localeCompare(b.entity_id)
  })

  return sortedEntities
}

function changedRecently(date: Date, hours: number): boolean {
  const now = new Date().getTime()
  const dateTime = date.getTime()

  const timeDifference = now - dateTime
  const hoursInMilliseconds = hours * 60 * 60 * 1000

  return timeDifference < hoursInMilliseconds
}
