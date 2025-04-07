import { beforeEach, describe, expect, it, mock } from 'bun:test'
import { HassServices } from 'home-assistant-js-websocket'
import { NEVER } from 'rxjs'

import mockServices from '../mocks/services.json'
import mockStates from '../mocks/states.json'
import { EvalHomeAssistantApi } from './eval-framework'
import { CallServiceOptions, HassState } from './lib/ha-ws-api'

// Create mock notifiers for testing
const mockNotifiers = [
  { name: 'valid_target', friendly_name: 'Valid Target' },
  { name: 'mobile_app_phone', friendly_name: 'Mobile App Phone' },
]

const mockStatesArr = mockStates as unknown as HassState[]
const mockStatesDict = Object.fromEntries(
  mockStatesArr.map((x) => [x.entity_id, x])
)

// Mock the extractNotifiers function
// eslint-disable-next-line @typescript-eslint/no-floating-promises
mock.module('./lib/ha-ws-api', () => {
  return {
    extractNotifiers: () => mockNotifiers,
  }
})

describe('EvalHomeAssistantApi', () => {
  let api: EvalHomeAssistantApi

  beforeEach(() => {
    api = new EvalHomeAssistantApi()
  })

  describe('fetchServices method', () => {
    it('should return mock services', async () => {
      const services = await api.fetchServices()
      const svcs = mockServices as any as HassServices

      // Verify it returns the mock services
      expect(services).toEqual(svcs)

      // Verify specific services exist in the mock data
      expect(services.light).toBeDefined()
      expect(services.notify).toBeDefined()
    })
  })

  describe('fetchStates method', () => {
    it('should return mock states', async () => {
      const states = await api.fetchStates()

      // Verify it returns the mock states dictionary
      expect(states).toEqual(mockStatesDict)
      expect(typeof states).toBe('object')

      // Verify states have the expected structure
      const stateKeys = Object.keys(states)
      if (stateKeys.length > 0) {
        const firstState = states[stateKeys[0]]
        expect(firstState).toHaveProperty('entity_id')
        expect(firstState).toHaveProperty('state')
        expect(firstState).toHaveProperty('attributes')
      }
    })
  })

  describe('eventsObservable method', () => {
    it('should return NEVER observable', () => {
      const observable = api.eventsObservable()

      // Verify it returns the NEVER observable
      expect(observable).toBe(NEVER)

      // Verify it's an Observable
      expect(typeof observable.subscribe).toBe('function')
    })
  })

  describe('sendNotification method', () => {
    it('should succeed with valid target', async () => {
      // Test with first mock notifier
      expect(
        api.sendNotification('valid_target', 'Test message', 'Test title')
      ).resolves.toBeUndefined()

      // Test with second mock notifier
      expect(
        api.sendNotification('mobile_app_phone', 'Test message', 'Test title')
      ).resolves.toBeUndefined()
    })

    it('should throw error with invalid target', async () => {
      // Test with non-existent target
      expect(
        api.sendNotification('invalid_target', 'Test message', 'Test title')
      ).rejects.toThrow('Target not found')

      // Test with empty target
      expect(
        api.sendNotification('', 'Test message', 'Test title')
      ).rejects.toThrow('Target not found')
    })

    it('should handle undefined title', async () => {
      // Test with undefined title
      expect(
        api.sendNotification('valid_target', 'Test message', undefined)
      ).resolves.toBeUndefined()
    })
  })

  describe('callService method', () => {
    it('should validate entity_id matches domain for single entity', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: 'light.kitchen',
        },
      }

      expect(api.callService(options)).resolves.toBeNull()
    })

    it('should validate entity_id matches domain for multiple entities', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: ['light.kitchen', 'light.living_room'],
        },
      }

      expect(api.callService(options)).resolves.toBeNull()
    })

    it('should throw error when entity_id does not match domain', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: 'switch.kitchen',
        },
      }

      expect(api.callService(options)).rejects.toThrow(
        "Entity ID switch.kitchen doesn't match domain light"
      )
    })

    it('should throw error when any entity_id in array does not match domain', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: ['light.kitchen', 'switch.living_room'],
        },
      }

      expect(api.callService(options)).rejects.toThrow(
        "Entity ID switch.living_room doesn't match domain light"
      )
    })

    it('should not throw error when no entity_id is provided', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
        target: {},
      }

      expect(api.callService(options)).resolves.toBeNull()
    })

    it('should not throw error when target is undefined', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
      }

      expect(api.callService(options)).resolves.toBeNull()
    })

    it('should ignore testModeOverride parameter', async () => {
      const options: CallServiceOptions = {
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: 'light.kitchen',
        },
      }

      // Test with testModeOverride = true
      expect(api.callService(options, true)).resolves.toBeNull()

      // Test with testModeOverride = false
      expect(api.callService(options, false)).resolves.toBeNull()
    })
  })
})
