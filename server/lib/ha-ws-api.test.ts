import { describe, expect, it, jest } from 'bun:test'
import { Connection } from 'home-assistant-js-websocket'

import { createConfigViaEnv } from '../config'
import { LiveHomeAssistantApi } from './ha-ws-api'

describe('LiveHomeAssistantApi', () => {
  describe('fetchServices method', () => {
    it('can fetch the services list', async () => {
      // This test uses a real Home Assistant connection
      // Should be skipped or mocked for CI environments
      if (process.env.CI) {
        return
      }

      // XXX: Normally hard-coding this is Bad but we know that this
      // is only used in development
      const config = await createConfigViaEnv('./notebook')
      const api = await LiveHomeAssistantApi.createViaConfig(config)
      const svcs = await api.fetchServices()

      console.log('Services:', svcs.notify)
      expect(svcs).toBeDefined()
    })
  })

  describe('callService method', () => {
    it('should correctly format and send service call message', async () => {
      // Create mock connection
      const mockSendMessagePromise = jest
        .fn()
        .mockResolvedValue({ result: 'success' })
      const mockConnection = {
        sendMessagePromise: mockSendMessagePromise,
      } as unknown as Connection

      // Create the API instance with the mock connection
      const api = new LiveHomeAssistantApi(mockConnection)

      // Call the method
      await api.callService({
        domain: 'light',
        service: 'turn_on',
        service_data: {
          color_name: 'beige',
          brightness: '101',
        },
        target: {
          entity_id: 'light.kitchen',
        },
        return_response: true,
      })

      // Verify correct message was sent
      expect(mockSendMessagePromise).toHaveBeenCalledWith({
        type: 'call_service',
        domain: 'light',
        service: 'turn_on',
        service_data: {
          color_name: 'beige',
          brightness: '101',
        },
        target: {
          entity_id: 'light.kitchen',
        },
        return_response: true,
      })
    })

    it('should validate entity ID domain in test mode', async () => {
      const mockConnection = {
        sendMessagePromise: jest.fn(),
      } as unknown as Connection

      // Create the API instance with test mode enabled
      const api = new LiveHomeAssistantApi(mockConnection, true)

      // Valid entity ID that starts with the domain
      const result = await api.callService({
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: 'light.kitchen',
        },
      })

      // Should pass validation and return null
      expect(result).toBeNull()
      // Should not call sendMessagePromise in test mode
      expect(mockConnection.sendMessagePromise).not.toHaveBeenCalled()
    })

    it('should throw error for invalid entity ID in test mode', async () => {
      const mockConnection = {
        sendMessagePromise: jest.fn(),
      } as unknown as Connection

      // Create the API instance with test mode enabled
      const api = new LiveHomeAssistantApi(mockConnection, true)

      // Entity ID that doesn't match the domain
      expect(
        api.callService({
          domain: 'light',
          service: 'turn_on',
          target: {
            entity_id: 'switch.kitchen',
          },
        })
      ).rejects.toThrow("Entity ID switch.kitchen doesn't match domain light")

      // Should not call sendMessagePromise when validation fails
      expect(mockConnection.sendMessagePromise).not.toHaveBeenCalled()
    })

    it('should handle array of entity IDs in test mode', async () => {
      const mockConnection = {
        sendMessagePromise: jest.fn(),
      } as unknown as Connection

      // Create the API instance with test mode enabled
      const api = new LiveHomeAssistantApi(mockConnection, true)

      // Valid array of entity IDs that all start with the domain
      const result = await api.callService({
        domain: 'light',
        service: 'turn_on',
        target: {
          entity_id: ['light.kitchen', 'light.living_room'],
        },
      })

      // Should pass validation and return null
      expect(result).toBeNull()
      // Should not call sendMessagePromise in test mode
      expect(mockConnection.sendMessagePromise).not.toHaveBeenCalled()
    })

    it('should throw error for mixed valid/invalid entity IDs in test mode', async () => {
      const mockConnection = {
        sendMessagePromise: jest.fn(),
      } as unknown as Connection

      // Create the API instance with test mode enabled
      const api = new LiveHomeAssistantApi(mockConnection, true)

      // Array with one valid and one invalid entity ID
      expect(
        api.callService({
          domain: 'light',
          service: 'turn_on',
          target: {
            entity_id: ['light.kitchen', 'switch.porch'],
          },
        })
      ).rejects.toThrow("Entity ID switch.porch doesn't match domain light")

      // Should not call sendMessagePromise when validation fails
      expect(mockConnection.sendMessagePromise).not.toHaveBeenCalled()
    })
  })
})
