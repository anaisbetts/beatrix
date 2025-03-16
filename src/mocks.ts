import {
  FriendlyStateEntity,
  HADetailedSensorReading,
  HAThinSensorReading,
  Scene,
} from './home-assistant-api'

export const testOneFrom: FriendlyStateEntity = {
  entity: 'light.office_lamp_left',
  name: 'Office Lamp Left',
  state: {
    min_mireds: 153,
    max_mireds: 500,
    effect_list: ['None', 'candle', 'fire'],
    supported_color_modes: ['color_temp', 'xy'],
    mode: 'normal',
    dynamics: 'none',
    friendly_name: 'Office Lamp Left',
    supported_features: 44,
    color_mode: 'color_temp',
    brightness: 89,
    color_temp: 382,
    hs_color: [28.583, 68.442],
    rgb_color: [255, 163, 80],
    xy_color: [0.535, 0.388],
    effect: 'None',
    state: 'on',
  },
}

export const testOneTo: FriendlyStateEntity = {
  entity: 'light.office_lamp_left',
  name: 'Office Lamp Left',
  state: {
    min_mireds: 153,
    max_mireds: 500,
    effect_list: ['None', 'candle', 'fire'],
    supported_color_modes: ['color_temp', 'xy'],
    mode: 'normal',
    dynamics: 'none',
    friendly_name: 'Office Lamp Left',
    supported_features: 44,
    color_mode: 'color_temp',
    brightness: 250,
    color_temp: 196,
    hs_color: [27.12, 17.875],
    rgb_color: [255, 230, 209],
    xy_color: [0.368, 0.349],
    effect: 'None',
    state: 'on',
  },
}

export const testTwoFrom: FriendlyStateEntity = {
  entity: 'light.office_lamp_right',
  name: 'Office Lamp Right',
  state: {
    min_mireds: 153,
    max_mireds: 500,
    effect_list: ['None', 'candle', 'fire'],
    supported_color_modes: ['color_temp', 'xy'],
    mode: 'normal',
    dynamics: 'none',
    friendly_name: 'Office Lamp Right',
    supported_features: 44,
    color_mode: 'color_temp',
    brightness: 82,
    color_temp: 382,
    hs_color: [28.583, 68.442],
    rgb_color: [255, 163, 80],
    xy_color: [0.535, 0.388],
    effect: 'None',
    state: 'on',
  },
}

export const testTwoTo: FriendlyStateEntity = {
  entity: 'light.office_lamp_right',
  name: 'Office Lamp Right',
  state: {
    min_mireds: 153,
    max_mireds: 500,
    effect_list: ['None', 'candle', 'fire'],
    supported_color_modes: ['color_temp', 'xy'],
    mode: 'normal',
    dynamics: 'none',
    friendly_name: 'Office Lamp Right',
    supported_features: 44,
    color_mode: 'color_temp',
    brightness: 209,
    color_temp: 200,
    hs_color: [27.001, 19.243],
    rgb_color: [255, 228, 205],
    xy_color: [0.372, 0.35],
    effect: 'None',
    state: 'on',
  },
}

export const onOffTestFrom: FriendlyStateEntity = {
  entity: 'light.office_overhead_light',
  name: 'Overhead Light',
  state: {
    supported_color_modes: ['brightness'],
    friendly_name: 'Overhead Light',
    supported_features: 32,
    state: 'off',
  },
}

export const onOffTestTo: FriendlyStateEntity = {
  entity: 'light.office_overhead_light',
  name: 'Overhead Light',
  state: {
    supported_color_modes: ['brightness'],
    friendly_name: 'Overhead Light',
    supported_features: 32,
    color_mode: 'brightness',
    brightness: 181,
    state: 'on',
  },
}

export const testOneSceneFrom: Scene = {
  entity: 'scene.office_night',
  internalId: '1643228416807',
  name: 'Office Night',
  affects: {
    'light.office_lamp_left': {
      entity: 'light.office_lamp_left',
      name: 'Office Lamp Left',
      state: {
        min_mireds: 153,
        max_mireds: 500,
        effect_list: ['None', 'candle', 'fire'],
        supported_color_modes: ['color_temp', 'xy'],
        mode: 'normal',
        dynamics: 'none',
        friendly_name: 'Office Lamp Left',
        supported_features: 44,
        color_mode: 'color_temp',
        brightness: 89,
        color_temp: 382,
        hs_color: [28.583, 68.442],
        rgb_color: [255, 163, 80],
        xy_color: [0.535, 0.388],
        effect: 'None',
        state: 'on',
      },
    },
    'light.office_lamp_right': {
      entity: 'light.office_lamp_right',
      name: 'Office Lamp Right',
      state: {
        min_mireds: 153,
        max_mireds: 500,
        effect_list: ['None', 'candle', 'fire'],
        supported_color_modes: ['color_temp', 'xy'],
        mode: 'normal',
        dynamics: 'none',
        friendly_name: 'Office Lamp Right',
        supported_features: 44,
        color_mode: 'color_temp',
        brightness: 82,
        color_temp: 382,
        hs_color: [28.583, 68.442],
        rgb_color: [255, 163, 80],
        xy_color: [0.535, 0.388],
        effect: 'None',
        state: 'on',
      },
    },
    'light.office_overhead_light': {
      entity: 'light.office_overhead_light',
      name: 'Overhead Light',
      state: {
        supported_color_modes: ['brightness'],
        friendly_name: 'Overhead Light',
        supported_features: 32,
        state: 'off',
      },
    },
    'light.elgato_key_light': {
      entity: 'light.elgato_key_light',
      name: 'Elgato Key Light',
      state: {
        min_mireds: 143,
        max_mireds: 344,
        supported_color_modes: ['color_temp'],
        friendly_name: 'Elgato Key Light',
        supported_features: 0,
        state: 'off',
      },
    },
    'light.elgato_ring_light': {
      entity: 'light.elgato_ring_light',
      name: 'Elgato Ring Light',
      state: {
        min_mireds: 143,
        max_mireds: 344,
        supported_color_modes: ['color_temp'],
        friendly_name: 'Elgato Ring Light',
        supported_features: 0,
        state: 'off',
      },
    },
  },
}

export const testOneSceneTo: Scene = {
  entity: 'scene.office_day',
  internalId: '1655635182629',
  name: 'Office Day',
  affects: {
    'light.office_lamp_left': {
      entity: 'light.office_lamp_left',
      name: 'Office Lamp Left',
      state: {
        min_mireds: 153,
        max_mireds: 500,
        effect_list: ['None', 'candle', 'fire'],
        supported_color_modes: ['color_temp', 'xy'],
        mode: 'normal',
        dynamics: 'none',
        friendly_name: 'Office Lamp Left',
        supported_features: 44,
        color_mode: 'color_temp',
        brightness: 250,
        color_temp: 196,
        hs_color: [27.12, 17.875],
        rgb_color: [255, 230, 209],
        xy_color: [0.368, 0.349],
        effect: 'None',
        state: 'on',
      },
    },
    'light.office_lamp_right': {
      entity: 'light.office_lamp_right',
      name: 'Office Lamp Right',
      state: {
        min_mireds: 153,
        max_mireds: 500,
        effect_list: ['None', 'candle', 'fire'],
        supported_color_modes: ['color_temp', 'xy'],
        mode: 'normal',
        dynamics: 'none',
        friendly_name: 'Office Lamp Right',
        supported_features: 44,
        color_mode: 'color_temp',
        brightness: 209,
        color_temp: 200,
        hs_color: [27.001, 19.243],
        rgb_color: [255, 228, 205],
        xy_color: [0.372, 0.35],
        effect: 'None',
        state: 'on',
      },
    },
    'light.office_overhead_light': {
      entity: 'light.office_overhead_light',
      name: 'Overhead Light',
      state: {
        supported_color_modes: ['brightness'],
        friendly_name: 'Overhead Light',
        supported_features: 32,
        color_mode: 'brightness',
        brightness: 181,
        state: 'on',
      },
    },
  },
}

const sensorReadings: Array<HADetailedSensorReading | HAThinSensorReading>[] = [
  [
    {
      entity_id: 'sensor.foyer_temperature',
      state: '26.68',
      attributes: {
        state_class: 'measurement',
        time: '2022-06-24T19:48:53.288Z',
        setting: 0,
        unit_of_measurement: '°C',
        device_class: 'temperature',
        friendly_name: 'Foyer temperature',
      },
      last_changed: '2022-06-24T19:57:19.050289+00:00',
      last_updated: '2022-06-24T19:57:19.050289+00:00',
    },
    {
      state: '26.6',
      last_changed: '2022-06-24T20:12:12.497696+00:00',
    },
    {
      state: '26.68',
      last_changed: '2022-06-24T20:27:12.017509+00:00',
    },
    {
      state: '26.6',
      last_changed: '2022-06-24T20:47:12.143266+00:00',
    },
    {
      state: '26.7',
      last_changed: '2022-06-24T21:02:12.354242+00:00',
    },
    {
      state: '26.77',
      last_changed: '2022-06-24T21:22:12.305804+00:00',
    },
    {
      state: '26.75',
      last_changed: '2022-06-24T21:57:11.915398+00:00',
    },
    {
      state: '26.78',
      last_changed: '2022-06-24T22:32:12.353513+00:00',
    },
    {
      state: '26.77',
      last_changed: '2022-06-24T22:52:12.408006+00:00',
    },
    {
      state: '26.78',
      last_changed: '2022-06-24T23:07:12.121016+00:00',
    },
    {
      state: '26.75',
      last_changed: '2022-06-24T23:27:12.007965+00:00',
    },
    {
      state: '26.73',
      last_changed: '2022-06-24T23:42:12.203172+00:00',
    },
    {
      state: '26.77',
      last_changed: '2022-06-25T00:02:12.373204+00:00',
    },
    {
      state: '26.76',
      last_changed: '2022-06-25T00:17:11.987314+00:00',
    },
    {
      state: '26.75',
      last_changed: '2022-06-25T00:37:12.138646+00:00',
    },
    {
      state: '26.76',
      last_changed: '2022-06-25T01:12:12.344905+00:00',
    },
    {
      state: '26.74',
      last_changed: '2022-06-25T01:32:12.243778+00:00',
    },
    {
      state: '26.77',
      last_changed: '2022-06-25T01:47:11.992735+00:00',
    },
    {
      state: '26.82',
      last_changed: '2022-06-25T02:07:12.010635+00:00',
    },
    {
      state: '26.86',
      last_changed: '2022-06-25T02:42:12.309613+00:00',
    },
    {
      state: '26.83',
      last_changed: '2022-06-25T02:57:12.036699+00:00',
    },
    {
      state: '26.86',
      last_changed: '2022-06-25T03:17:12.083587+00:00',
    },
    {
      state: '26.9',
      last_changed: '2022-06-25T03:37:12.015003+00:00',
    },
    {
      state: '26.85',
      last_changed: '2022-06-25T03:52:12.244589+00:00',
    },
    {
      state: '26.86',
      last_changed: '2022-06-25T04:32:12.401062+00:00',
    },
    {
      state: '26.81',
      last_changed: '2022-06-25T04:47:12.005243+00:00',
    },
    {
      state: '26.76',
      last_changed: '2022-06-25T05:07:12.042473+00:00',
    },
    {
      state: '26.7',
      last_changed: '2022-06-25T05:22:12.178122+00:00',
    },
    {
      state: '26.66',
      last_changed: '2022-06-25T05:42:13.305218+00:00',
    },
    {
      state: '26.5',
      last_changed: '2022-06-25T06:02:12.571882+00:00',
    },
    {
      state: '26.44',
      last_changed: '2022-06-25T06:22:12.321620+00:00',
    },
    {
      state: '26.34',
      last_changed: '2022-06-25T06:37:12.136983+00:00',
    },
    {
      state: '26.35',
      last_changed: '2022-06-25T06:52:12.286300+00:00',
    },
    {
      state: '26.36',
      last_changed: '2022-06-25T07:07:12.032438+00:00',
    },
    {
      state: '26.34',
      last_changed: '2022-06-25T07:22:12.437146+00:00',
    },
    {
      state: '26.33',
      last_changed: '2022-06-25T07:37:12.247952+00:00',
    },
    {
      state: '26.34',
      last_changed: '2022-06-25T07:57:12.257276+00:00',
    },
    {
      state: '26.43',
      last_changed: '2022-06-25T08:27:12.283825+00:00',
    },
    {
      state: '26.48',
      last_changed: '2022-06-25T08:42:12.703626+00:00',
    },
    {
      state: '26.44',
      last_changed: '2022-06-25T09:02:12.382251+00:00',
    },
    {
      state: '26.5',
      last_changed: '2022-06-25T09:22:12.512137+00:00',
    },
    {
      state: '26.44',
      last_changed: '2022-06-25T09:37:12.369576+00:00',
    },
    {
      state: '26.43',
      last_changed: '2022-06-25T09:57:12.190296+00:00',
    },
    {
      state: '26.42',
      last_changed: '2022-06-25T10:17:12.300102+00:00',
    },
    {
      state: '26.49',
      last_changed: '2022-06-25T10:32:12.288067+00:00',
    },
    {
      state: '26.45',
      last_changed: '2022-06-25T10:52:12.458274+00:00',
    },
    {
      state: '26.41',
      last_changed: '2022-06-25T11:07:12.271319+00:00',
    },
    {
      state: '26.4',
      last_changed: '2022-06-25T11:22:12.501994+00:00',
    },
    {
      state: '26.52',
      last_changed: '2022-06-25T11:42:12.659209+00:00',
    },
    {
      state: '26.51',
      last_changed: '2022-06-25T12:02:12.471255+00:00',
    },
    {
      state: '26.57',
      last_changed: '2022-06-25T12:22:12.495605+00:00',
    },
    {
      state: '26.61',
      last_changed: '2022-06-25T12:42:12.589753+00:00',
    },
    {
      state: '26.78',
      last_changed: '2022-06-25T12:52:12.402112+00:00',
    },
    {
      state: '26.99',
      last_changed: '2022-06-25T12:57:12.256827+00:00',
    },
    {
      state: '27.21',
      last_changed: '2022-06-25T13:12:12.602990+00:00',
    },
    {
      state: '27.37',
      last_changed: '2022-06-25T13:22:12.428855+00:00',
    },
    {
      state: '27.27',
      last_changed: '2022-06-25T13:32:12.441807+00:00',
    },
    {
      state: '27.24',
      last_changed: '2022-06-25T13:52:12.524174+00:00',
    },
    {
      state: '27.19',
      last_changed: '2022-06-25T14:07:12.207549+00:00',
    },
    {
      state: '27.09',
      last_changed: '2022-06-25T14:44:30.258107+00:00',
    },
    {
      state: '27.02',
      last_changed: '2022-06-25T14:59:30.690625+00:00',
    },
    {
      state: '27.03',
      last_changed: '2022-06-25T15:19:30.389496+00:00',
    },
    {
      state: '27.02',
      last_changed: '2022-06-25T15:39:30.555576+00:00',
    },
    {
      state: '27.16',
      last_changed: '2022-06-25T15:54:30.305867+00:00',
    },
    {
      state: '27.14',
      last_changed: '2022-06-25T16:14:30.383113+00:00',
    },
    {
      state: '27.17',
      last_changed: '2022-06-25T16:34:30.186311+00:00',
    },
    {
      state: '27.32',
      last_changed: '2022-06-25T16:49:30.747620+00:00',
    },
    {
      state: '27.29',
      last_changed: '2022-06-25T17:04:30.110531+00:00',
    },
    {
      state: '27.23',
      last_changed: '2022-06-25T17:24:30.111402+00:00',
    },
    {
      state: '27.25',
      last_changed: '2022-06-25T17:44:30.296822+00:00',
    },
    {
      state: '27.24',
      last_changed: '2022-06-25T17:59:30.549052+00:00',
    },
    {
      state: '27.12',
      last_changed: '2022-06-25T18:14:30.172151+00:00',
    },
    {
      state: '27.06',
      last_changed: '2022-06-25T18:34:30.233778+00:00',
    },
    {
      state: '27.04',
      last_changed: '2022-06-25T18:49:30.684996+00:00',
    },
    {
      state: '26.87',
      last_changed: '2022-06-25T18:59:30.571325+00:00',
    },
    {
      state: '26.84',
      last_changed: '2022-06-25T19:14:30.294569+00:00',
    },
    {
      state: '26.86',
      last_changed: '2022-06-25T19:34:30.409227+00:00',
    },
    {
      state: '26.81',
      last_changed: '2022-06-25T19:49:30.525634+00:00',
    },
  ],
  [
    {
      entity_id: 'sensor.main_bedroom_humidity',
      state: '44.6',
      attributes: {
        state_class: 'measurement',
        time: '2022-06-24T19:40:51.278Z',
        unit_of_measurement: '%',
        device_class: 'humidity',
        friendly_name: 'Main Bedroom humidity',
      },
      last_changed: '2022-06-24T19:57:19.050289+00:00',
      last_updated: '2022-06-24T19:57:19.050289+00:00',
    },
    {
      state: '45.5',
      last_changed: '2022-06-24T20:02:12.624854+00:00',
    },
    {
      state: '46.0',
      last_changed: '2022-06-24T20:17:12.212094+00:00',
    },
    {
      state: '47.0',
      last_changed: '2022-06-24T20:37:12.217055+00:00',
    },
    {
      state: '46.7',
      last_changed: '2022-06-24T20:57:12.224260+00:00',
    },
    {
      state: '47.3',
      last_changed: '2022-06-24T21:12:12.482880+00:00',
    },
    {
      state: '47.8',
      last_changed: '2022-06-24T21:32:12.502869+00:00',
    },
    {
      state: '47.5',
      last_changed: '2022-06-24T21:52:12.426215+00:00',
    },
    {
      state: '47.7',
      last_changed: '2022-06-24T22:12:12.408754+00:00',
    },
    {
      state: '47.3',
      last_changed: '2022-06-24T22:32:12.465473+00:00',
    },
    {
      state: '46.6',
      last_changed: '2022-06-24T22:47:12.107514+00:00',
    },
    {
      state: '47.8',
      last_changed: '2022-06-24T23:02:12.319459+00:00',
    },
    {
      state: '49.5',
      last_changed: '2022-06-24T23:17:12.252045+00:00',
    },
    {
      state: '48.3',
      last_changed: '2022-06-24T23:32:12.495829+00:00',
    },
    {
      state: '48.6',
      last_changed: '2022-06-24T23:47:12.478521+00:00',
    },
    {
      state: '49.2',
      last_changed: '2022-06-25T00:07:12.209417+00:00',
    },
    {
      state: '50.0',
      last_changed: '2022-06-25T00:27:12.191852+00:00',
    },
    {
      state: '49.1',
      last_changed: '2022-06-25T00:42:12.407442+00:00',
    },
    {
      state: '48.8',
      last_changed: '2022-06-25T01:02:12.287363+00:00',
    },
    {
      state: '48.9',
      last_changed: '2022-06-25T01:22:12.385445+00:00',
    },
    {
      state: '50.2',
      last_changed: '2022-06-25T01:42:12.289331+00:00',
    },
    {
      state: '47.5',
      last_changed: '2022-06-25T01:57:12.209960+00:00',
    },
    {
      state: '49.0',
      last_changed: '2022-06-25T02:12:12.360964+00:00',
    },
    {
      state: '50.8',
      last_changed: '2022-06-25T02:32:12.272138+00:00',
    },
    {
      state: '50.3',
      last_changed: '2022-06-25T02:47:12.084776+00:00',
    },
    {
      state: '50.8',
      last_changed: '2022-06-25T03:27:12.203442+00:00',
    },
    {
      state: '50.4',
      last_changed: '2022-06-25T03:57:12.035018+00:00',
    },
    {
      state: '51.3',
      last_changed: '2022-06-25T04:17:12.096557+00:00',
    },
    {
      state: '52.6',
      last_changed: '2022-06-25T04:37:12.310495+00:00',
    },
    {
      state: '51.8',
      last_changed: '2022-06-25T04:52:12.417321+00:00',
    },
    {
      state: '52.7',
      last_changed: '2022-06-25T05:12:12.579709+00:00',
    },
    {
      state: '53.3',
      last_changed: '2022-06-25T05:32:12.447406+00:00',
    },
    {
      state: '52.8',
      last_changed: '2022-06-25T05:52:12.532021+00:00',
    },
    {
      state: '54.4',
      last_changed: '2022-06-25T06:07:12.324897+00:00',
    },
    {
      state: '55.0',
      last_changed: '2022-06-25T06:47:12.064475+00:00',
    },
    {
      state: '54.5',
      last_changed: '2022-06-25T07:02:12.518792+00:00',
    },
    {
      state: '54.9',
      last_changed: '2022-06-25T07:17:12.410112+00:00',
    },
    {
      state: '55.2',
      last_changed: '2022-06-25T07:37:12.378942+00:00',
    },
    {
      state: '53.4',
      last_changed: '2022-06-25T07:52:12.833434+00:00',
    },
    {
      state: '55.7',
      last_changed: '2022-06-25T08:02:12.577317+00:00',
    },
    {
      state: '54.1',
      last_changed: '2022-06-25T08:22:12.615103+00:00',
    },
    {
      state: '53.3',
      last_changed: '2022-06-25T08:42:12.843043+00:00',
    },
    {
      state: '54.0',
      last_changed: '2022-06-25T08:57:12.297855+00:00',
    },
    {
      state: '53.8',
      last_changed: '2022-06-25T09:12:12.532766+00:00',
    },
    {
      state: '54.0',
      last_changed: '2022-06-25T09:32:12.343957+00:00',
    },
    {
      state: '54.5',
      last_changed: '2022-06-25T09:47:12.338689+00:00',
    },
    {
      state: '54.1',
      last_changed: '2022-06-25T10:02:12.729619+00:00',
    },
    {
      state: '54.7',
      last_changed: '2022-06-25T10:17:12.447621+00:00',
    },
    {
      state: '54.2',
      last_changed: '2022-06-25T10:37:12.254915+00:00',
    },
    {
      state: '53.3',
      last_changed: '2022-06-25T10:52:12.575147+00:00',
    },
    {
      state: '54.8',
      last_changed: '2022-06-25T10:57:12.427369+00:00',
    },
    {
      state: '55.0',
      last_changed: '2022-06-25T11:17:12.319432+00:00',
    },
    {
      state: '54.3',
      last_changed: '2022-06-25T11:32:12.716702+00:00',
    },
    {
      state: '54.6',
      last_changed: '2022-06-25T11:52:12.644136+00:00',
    },
    {
      state: '53.5',
      last_changed: '2022-06-25T12:27:12.296529+00:00',
    },
    {
      state: '52.6',
      last_changed: '2022-06-25T12:42:12.709077+00:00',
    },
    {
      state: '53.3',
      last_changed: '2022-06-25T12:57:12.364990+00:00',
    },
    {
      state: '52.4',
      last_changed: '2022-06-25T13:17:12.350670+00:00',
    },
    {
      state: '51.9',
      last_changed: '2022-06-25T13:22:12.540862+00:00',
    },
    {
      state: '52.1',
      last_changed: '2022-06-25T13:57:12.375556+00:00',
    },
    {
      state: '51.5',
      last_changed: '2022-06-25T14:17:12.345894+00:00',
    },
    {
      state: '52.3',
      last_changed: '2022-06-25T14:29:28.788138+00:00',
    },
    {
      state: '55.1',
      last_changed: '2022-06-25T14:44:30.350944+00:00',
    },
    {
      state: '54.4',
      last_changed: '2022-06-25T14:54:30.414458+00:00',
    },
    {
      state: '52.8',
      last_changed: '2022-06-25T15:09:30.690896+00:00',
    },
    {
      state: '53.1',
      last_changed: '2022-06-25T15:29:30.523546+00:00',
    },
    {
      state: '52.4',
      last_changed: '2022-06-25T15:44:30.419400+00:00',
    },
    {
      state: '51.6',
      last_changed: '2022-06-25T16:04:30.410419+00:00',
    },
    {
      state: '53.2',
      last_changed: '2022-06-25T16:19:30.591438+00:00',
    },
    {
      state: '52.9',
      last_changed: '2022-06-25T16:34:30.292486+00:00',
    },
    {
      state: '52.4',
      last_changed: '2022-06-25T16:49:30.858545+00:00',
    },
    {
      state: '52.2',
      last_changed: '2022-06-25T17:09:30.439325+00:00',
    },
    {
      state: '52.4',
      last_changed: '2022-06-25T17:29:30.596576+00:00',
    },
    {
      state: '52.1',
      last_changed: '2022-06-25T17:44:30.402536+00:00',
    },
    {
      state: '51.8',
      last_changed: '2022-06-25T17:59:30.657542+00:00',
    },
    {
      state: '53.7',
      last_changed: '2022-06-25T18:19:30.915696+00:00',
    },
    {
      state: '54.1',
      last_changed: '2022-06-25T18:29:30.508271+00:00',
    },
    {
      state: '55.4',
      last_changed: '2022-06-25T19:04:30.373950+00:00',
    },
    {
      state: '54.9',
      last_changed: '2022-06-25T19:19:30.725551+00:00',
    },
    {
      state: '54.5',
      last_changed: '2022-06-25T19:39:30.595108+00:00',
    },
    {
      state: '55.9',
      last_changed: '2022-06-25T19:54:30.278777+00:00',
    },
  ],
]
