type JsonSchema = Record<string, unknown>;

const stringSchema = { type: 'string' };
const isoDateTimeSchema = { type: 'string', format: 'date-time' };
const roomIdSchema = {
  type: 'string',
  enum: ['entrance', 'living_room', 'kitchen', 'dining_room', 'master_bedroom', 'child_bedroom', 'study', 'bathroom', 'garden']
};
const idempotencyKeySchema = {
  type: 'string',
  minLength: 1,
  maxLength: 128,
  description: 'Client-generated key used to make retryable control commands safe.'
};

const twinSnapshotSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'scenarioId', 'simClock', 'homeState', 'rooms', 'people', 'devices', 'activities', 'alerts'],
  properties: {
    homeId: stringSchema,
    runId: stringSchema,
    scenarioId: stringSchema,
    simClock: {
      type: 'object',
      required: ['currentTime', 'speed', 'paused', 'sequence'],
      properties: {
        currentTime: isoDateTimeSchema,
        speed: { type: 'number' },
        paused: { type: 'boolean' },
        sequence: { type: 'integer', minimum: 0 }
      }
    },
    homeState: {
      type: 'object',
      properties: {
        occupancyCount: { type: 'integer', minimum: 0 },
        mode: { type: 'string' },
        securityMode: { type: 'string', enum: ['armed', 'disarmed'] }
      }
    },
    rooms: { type: 'object', additionalProperties: true },
    people: { type: 'object', additionalProperties: true },
    devices: { type: 'object', additionalProperties: true },
    activities: { type: 'object', additionalProperties: true },
    alerts: { type: 'object', additionalProperties: true }
  }
};

const twinEventBaseSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: stringSchema,
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    reason: stringSchema
  },
  additionalProperties: true
};

const abnormalityInjectedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'kind', 'affectedEntities'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['AbnormalityInjected'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    reason: stringSchema,
    kind: {
      type: 'string',
      enum: ['door_left_open', 'fridge_left_open', 'network_offline', 'senior_no_activity']
    },
    affectedEntities: {
      type: 'array',
      items: stringSchema
    }
  }
};

const alertStatusChangedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'alertId', 'previousStatus', 'status'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['AlertStatusChanged'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    reason: stringSchema,
    alertId: stringSchema,
    previousStatus: alertLifecycleStatusSchema(),
    status: alertLifecycleStatusSchema()
  }
};

const objectMovedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'objectId', 'from', 'to'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['ObjectMoved'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    reason: stringSchema,
    objectId: stringSchema,
    from: roomIdSchema,
    to: roomIdSchema,
    carriedByPersonId: stringSchema
  }
};

const twinEventSchema: JsonSchema = {
  anyOf: [
    { $ref: '#/components/schemas/AbnormalityInjectedEvent' },
    { $ref: '#/components/schemas/AlertStatusChangedEvent' },
    { $ref: '#/components/schemas/ObjectMovedEvent' },
    twinEventBaseSchema
  ]
};

const homeDefinitionSchema: JsonSchema = {
  type: 'object',
  required: ['building', 'floors', 'topology', 'people'],
  properties: {
    building: {
      type: 'object',
      required: ['id', 'name'],
      properties: {
        id: stringSchema,
        name: stringSchema
      }
    },
    floors: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'name', 'level', 'rooms', 'fixtures'],
        properties: {
          id: stringSchema,
          name: stringSchema,
          level: { type: 'integer' },
          rooms: {
            type: 'array',
            items: { type: 'object', additionalProperties: true }
          },
          fixtures: {
            type: 'object',
            required: ['devices'],
            properties: {
              devices: {
                type: 'array',
                items: { type: 'object', additionalProperties: true }
              }
            }
          }
        }
      }
    },
    topology: {
      type: 'object',
      required: ['connections'],
      properties: {
        connections: {
          type: 'array',
          items: {
            type: 'object',
            required: ['from', 'to'],
            properties: {
              from: stringSchema,
              to: stringSchema
            }
          }
        }
      }
    },
    people: {
      type: 'array',
      items: { type: 'object', additionalProperties: true }
    }
  }
};

const updateResponseSchema: JsonSchema = {
  type: 'object',
  required: ['snapshot', 'events'],
  properties: {
    snapshot: { $ref: '#/components/schemas/TwinSnapshot' },
    events: {
      type: 'array',
      items: { $ref: '#/components/schemas/TwinEvent' }
    }
  }
};

const twinSocketUpdateMessageSchema: JsonSchema = {
  type: 'object',
  required: ['type', 'runId', 'sequence', 'replayComplete', 'events'],
  properties: {
    type: { type: 'string', enum: ['twin.update'] },
    runId: stringSchema,
    sequence: { type: 'integer', minimum: 0 },
    snapshot: { $ref: '#/components/schemas/TwinSnapshot' },
    replayComplete: {
      type: 'boolean',
      description: 'False when reconnect replay was truncated and the client should continue replaying or refresh the snapshot.'
    },
    events: {
      type: 'array',
      items: { $ref: '#/components/schemas/TwinEvent' }
    }
  }
};

const twinSocketHeartbeatMessageSchema: JsonSchema = {
  type: 'object',
  required: ['type', 'ts', 'runId', 'sequence'],
  properties: {
    type: { type: 'string', enum: ['twin.heartbeat'] },
    ts: isoDateTimeSchema,
    runId: stringSchema,
    sequence: { type: 'integer', minimum: 0 }
  }
};

const validationErrorSchema: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'VALIDATION_FAILED' },
        message: stringSchema,
        issues: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              path: stringSchema,
              message: stringSchema
            }
          }
        }
      }
    }
  }
};

const idempotencyConflictSchema: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'IDEMPOTENCY_CONFLICT' },
        message: stringSchema
      }
    }
  }
};

const notFoundErrorSchema: JsonSchema = {
  type: 'object',
  required: ['error'],
  properties: {
    error: {
      type: 'object',
      required: ['code', 'message'],
      properties: {
        code: { type: 'string', example: 'NOT_FOUND' },
        message: stringSchema
      }
    }
  }
};

const accessAuditRecordSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'ts', 'method', 'endpoint', 'privacy', 'runId', 'sequence', 'details'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    ts: isoDateTimeSchema,
    method: stringSchema,
    endpoint: stringSchema,
    privacy: { type: 'string', enum: ['admin', 'public', 'ml-observation'] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    sequence: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    details: { type: 'object', additionalProperties: true }
  }
};

const commandMetadataSchema: JsonSchema = {
  type: 'object',
  required: ['label', 'controlType', 'valueType', 'field', 'highRisk', 'requiresConfirmation', 'lifecycle', 'failureReasons'],
  properties: {
    label: stringSchema,
    controlType: { type: 'string', enum: ['button', 'toggle', 'slider', 'select'] },
    valueType: { type: 'string', enum: ['none', 'boolean', 'number', 'string', 'enum'] },
    field: { anyOf: [stringSchema, { type: 'null' }] },
    min: { type: 'number' },
    max: { type: 'number' },
    options: {
      type: 'array',
      items: stringSchema
    },
    highRisk: { type: 'boolean' },
    requiresConfirmation: { type: 'boolean' },
    lifecycle: {
      type: 'array',
      items: { type: 'string', enum: ['requested', 'sent', 'acknowledged', 'failed', 'rolled_back'] }
    },
    failureReasons: {
      type: 'array',
      items: { type: 'string', enum: ['offline', 'unsupported', 'invalid_params', 'device_rejected', 'timeout'] }
    }
  }
};

const commandTimelineEntrySchema: JsonSchema = {
  type: 'object',
  required: ['status', 'at', 'reason'],
  properties: {
    status: { type: 'string', enum: ['requested', 'sent', 'acknowledged', 'failed', 'rolled_back'] },
    at: isoDateTimeSchema,
    reason: { anyOf: [stringSchema, { type: 'null' }] }
  }
};

const healthSignalSchema: JsonSchema = {
  type: 'object',
  required: ['kind', 'label', 'sourceField', 'recommendation', 'impact'],
  properties: {
    kind: { type: 'string', enum: ['battery', 'command_failure', 'connectivity', 'drift', 'latency', 'range', 'staleness'] },
    label: stringSchema,
    sourceField: { anyOf: [stringSchema, { type: 'null' }] },
    normalRange: {
      type: 'array',
      items: { type: 'number' },
      minItems: 2,
      maxItems: 2
    },
    warningBelow: { type: 'number' },
    alertBelow: { type: 'number' },
    warningAbove: { type: 'number' },
    alertAbove: { type: 'number' },
    staleAfterMinutes: { type: 'number' },
    recommendation: stringSchema,
    impact: { type: 'string', enum: ['automation_reliability', 'care', 'comfort', 'energy', 'safety', 'security', 'water'] }
  }
};

const healthStatusSchema: JsonSchema = {
  type: 'object',
  required: ['kind', 'label', 'sourceField', 'status', 'reportedValue', 'recommendation', 'impact'],
  properties: {
    kind: { type: 'string', enum: ['battery', 'command_failure', 'connectivity', 'drift', 'latency', 'range', 'staleness'] },
    label: stringSchema,
    sourceField: { anyOf: [stringSchema, { type: 'null' }] },
    status: { type: 'string', enum: ['normal', 'watch', 'alert'] },
    reportedValue: {
      anyOf: [
        stringSchema,
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' }
      ]
    },
    recommendation: stringSchema,
    impact: { type: 'string', enum: ['automation_reliability', 'care', 'comfort', 'energy', 'safety', 'security', 'water'] }
  }
};

const deviceVisualModelSchema = {
  type: 'string',
  enum: [
    'air_conditioner_wall',
    'bed_sleep_pad',
    'curtain_panel',
    'dishwasher_box',
    'door_lock',
    'fridge_tower',
    'generic_box',
    'generic_sphere',
    'light_disc',
    'package_pad',
    'range_hood',
    'robot_vacuum',
    'router_antennas',
    'sensor_puck',
    'soil_probe',
    'sprinkler_head',
    'stove_top',
    'tv_screen',
    'wall_camera',
    'washer_drum',
    'water_pipe_sensor',
    'water_valve_handle'
  ]
};

const devicePoseSchema: JsonSchema = {
  type: 'object',
  required: ['x', 'y', 'z', 'rotation', 'mount', 'visualVariant'],
  properties: {
    x: { type: 'number' },
    y: { type: 'number' },
    z: { type: 'number' },
    rotation: { type: 'number' },
    mount: { type: 'string', enum: ['ceiling', 'counter', 'embedded', 'floor', 'outdoor', 'pipe', 'wall'] },
    visualVariant: { anyOf: [stringSchema, { type: 'null' }] }
  }
};

const deviceAccessRecordSchema: JsonSchema = {
  type: 'object',
  required: ['deviceId', 'roomId', 'deviceType', 'displayName', 'shortLabel', 'instanceGroup', 'privacyLevel', 'riskLevel', 'visualModel', 'visualScale', 'pose', 'protocol', 'desiredState', 'reportedState', 'stateFields', 'supportedCommands', 'commandMetadata', 'connectivity', 'lastSeenAt', 'dataQuality', 'healthStatus'],
  properties: {
    deviceId: stringSchema,
    roomId: stringSchema,
    deviceType: stringSchema,
    displayName: stringSchema,
    shortLabel: stringSchema,
    instanceGroup: { type: 'string', enum: ['bathroom_water', 'bedroom_comfort', 'dining_lighting', 'entrance_security', 'garden_irrigation', 'kitchen_appliance', 'living_comfort', 'network_infrastructure'] },
    privacyLevel: { type: 'string', enum: ['household', 'private', 'public'] },
    riskLevel: { type: 'string', enum: ['normal', 'confirmation', 'required_confirmation', 'privacy_sensitive', 'high'] },
    visualModel: deviceVisualModelSchema,
    visualScale: { type: 'number', minimum: 0 },
    pose: devicePoseSchema,
    protocol: { type: 'string', enum: ['simulated'] },
    desiredState: {
      anyOf: [
        { type: 'object', additionalProperties: true },
        { type: 'null' }
      ]
    },
    reportedState: { type: 'object', additionalProperties: true },
    stateFields: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['type', 'required'],
        properties: {
          type: { type: 'string', enum: ['boolean', 'number', 'string', 'unknown'] },
          required: { type: 'boolean' },
          defaultValue: {
            anyOf: [
              stringSchema,
              { type: 'number' },
              { type: 'boolean' },
              { type: 'null' }
            ]
          },
          unit: stringSchema,
          normalRange: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2
          },
          nullable: { type: 'boolean' },
          enum: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    },
    supportedCommands: {
      type: 'array',
      items: stringSchema
    },
    commandMetadata: {
      type: 'object',
      additionalProperties: commandMetadataSchema
    },
    connectivity: { type: 'string', enum: ['online', 'offline', 'unknown'] },
    lastSeenAt: isoDateTimeSchema,
    dataQuality: {
      type: 'object',
      required: ['source', 'confidence', 'freshness'],
      properties: {
        source: { type: 'string', enum: ['simulator'] },
        confidence: { type: 'number', minimum: 0, maximum: 1 },
        freshness: { type: 'string', enum: ['live', 'stale'] }
      }
    },
    lastCommand: {
      anyOf: [
        {
          type: 'object',
          required: ['commandId', 'status', 'requestedAt', 'acknowledgedAt', 'reason', 'timeline'],
          properties: {
            commandId: stringSchema,
            status: { type: 'string', enum: ['requested', 'sent', 'acknowledged', 'failed', 'timed-out', 'none'] },
            requestedAt: isoDateTimeSchema,
            acknowledgedAt: {
              anyOf: [isoDateTimeSchema, { type: 'null' }]
            },
            reason: {
              anyOf: [stringSchema, { type: 'null' }]
            },
            timeline: {
              type: 'array',
              items: commandTimelineEntrySchema
            }
          }
        },
        { type: 'null' }
      ]
    },
    healthStatus: {
      type: 'array',
      items: healthStatusSchema
    }
  }
};

const deviceCapabilitySchema: JsonSchema = {
  type: 'object',
  required: ['displayName', 'shortLabel', 'icon', 'markerKind', 'animationHint', 'visualModel', 'visualScale', 'riskLevel', 'defaultState', 'stateFields', 'telemetry', 'supportedCommands', 'commandMetadata', 'healthSignals'],
  properties: {
    displayName: stringSchema,
    shortLabel: stringSchema,
    icon: stringSchema,
    markerKind: { type: 'string', enum: ['sensor', 'actuator', 'appliance', 'security', 'lighting', 'climate', 'media', 'mobile', 'network'] },
    animationHint: { type: 'string', enum: ['airflow', 'glow', 'none', 'open_close', 'patrol', 'pulse', 'rotate', 'scan', 'vibrate', 'waterflow'] },
    visualModel: deviceVisualModelSchema,
    visualScale: { type: 'number', minimum: 0 },
    riskLevel: { type: 'string', enum: ['normal', 'confirmation', 'required_confirmation', 'privacy_sensitive', 'high'] },
    defaultState: { type: 'object', additionalProperties: true },
    stateFields: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['type', 'required'],
        properties: {
          type: { type: 'string', enum: ['boolean', 'number', 'string', 'unknown'] },
          required: { type: 'boolean' },
          defaultValue: {
            anyOf: [
              stringSchema,
              { type: 'number' },
              { type: 'boolean' },
              { type: 'null' }
            ]
          },
          unit: stringSchema,
          normalRange: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2
          },
          nullable: { type: 'boolean' },
          enum: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    },
    telemetry: {
      type: 'object',
      additionalProperties: {
        type: 'object',
        required: ['unit'],
        properties: {
          unit: stringSchema,
          normalRange: {
            type: 'array',
            items: { type: 'number' },
            minItems: 2,
            maxItems: 2
          }
        }
      }
    },
    supportedCommands: {
      type: 'array',
      items: stringSchema
    },
    commandMetadata: {
      type: 'object',
      additionalProperties: commandMetadataSchema
    },
    healthSignals: {
      type: 'array',
      items: healthSignalSchema
    }
  }
};

const telemetrySummarySchema: JsonSchema = {
  type: 'object',
  required: ['runId', 'window', 'devices'],
  properties: {
    runId: {
      anyOf: [stringSchema, { type: 'null' }]
    },
    window: {
      type: 'object',
      required: ['eventLimit', 'eventCount', 'firstSeenAt', 'lastSeenAt'],
      properties: {
        eventLimit: { type: 'integer', minimum: 1 },
        eventCount: { type: 'integer', minimum: 0 },
        firstSeenAt: { anyOf: [isoDateTimeSchema, { type: 'null' }] },
        lastSeenAt: { anyOf: [isoDateTimeSchema, { type: 'null' }] }
      }
    },
    devices: {
      type: 'array',
      items: {
        type: 'object',
        required: ['deviceId', 'roomId', 'deviceType', 'metrics'],
        properties: {
          deviceId: stringSchema,
          roomId: stringSchema,
          deviceType: stringSchema,
          metrics: {
            type: 'object',
            additionalProperties: {
              type: 'object',
              required: ['count', 'min', 'max', 'avg', 'latest'],
              properties: {
                count: { type: 'integer', minimum: 1 },
                min: { type: 'number' },
                max: { type: 'number' },
                avg: { type: 'number' },
                latest: {
                  anyOf: [{ type: 'number' }, { type: 'boolean' }]
                }
              }
            }
          }
        }
      }
    }
  }
};

export function buildOpenApiDocument(): Record<string, unknown> {
  return {
    openapi: '3.1.0',
    info: {
      title: 'VirtualHome Twin API',
      version: '0.1.0',
      description: 'REST and WebSocket protocol for the VirtualHome smart-home digital twin demo.'
    },
    servers: [{ url: '/' }],
    paths: {
      '/api/openapi.json': {
        get: {
          summary: 'Get the OpenAPI document',
          responses: okResponse({ type: 'object', additionalProperties: true })
        }
      },
      '/api/scenarios': {
        get: {
          summary: 'List built-in scenario ids',
          responses: okResponse({
            type: 'array',
            items: {
              type: 'object',
              required: ['id'],
              properties: { id: stringSchema }
            }
          })
        }
      },
      '/api/home-definition': {
        get: {
          summary: 'Get the default model-driven home definition',
          responses: okResponse({ $ref: '#/components/schemas/HomeDefinition' })
        }
      },
      '/api/state': {
        get: {
          summary: 'Get the current twin state',
          parameters: [privacyParameter()],
          responses: okResponse({ $ref: '#/components/schemas/TwinSnapshot' }, true)
        }
      },
      '/api/events': {
        get: {
          summary: 'Get recent twin events',
          parameters: [limitParameter(), runIdParameter(), privacyParameter()],
          responses: okResponse({
            type: 'array',
            items: { $ref: '#/components/schemas/TwinEvent' }
          }, true)
        }
      },
      '/api/telemetry': {
        get: {
          summary: 'Get recent device telemetry events',
          parameters: [limitParameter(), runIdParameter(), privacyParameter()],
          responses: okResponse({
            type: 'array',
            items: { $ref: '#/components/schemas/TwinEvent' }
          }, true)
        }
      },
      '/api/telemetry/summary': {
        get: {
          summary: 'Get aggregated telemetry metrics',
          parameters: [{
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 1, maximum: 1000, default: 500 }
          }, runIdParameter()],
          responses: okResponse({ $ref: '#/components/schemas/TelemetrySummary' }, true)
        }
      },
      '/api/device-twins': {
        get: {
          summary: 'Get simulated device access records',
          description: 'Projects devices into a bidirectional adapter-facing view with desired state, reported state, connectivity, freshness, and command acknowledgement metadata.',
          parameters: [privacyParameter()],
          responses: okResponse({
            type: 'array',
            items: { $ref: '#/components/schemas/DeviceAccessRecord' }
          }, true)
        }
      },
      '/api/device-capabilities': {
        get: {
          summary: 'Get device capability metadata',
          description: 'Returns the serializable device capability registry used by simulation, adapters, and clients.',
          responses: okResponse({
            type: 'object',
            additionalProperties: { $ref: '#/components/schemas/DeviceCapability' }
          })
        }
      },
      '/api/audit/access': {
        get: {
          summary: 'Get recent read-access audit records',
          parameters: [limitParameter()],
          responses: okResponse({
            type: 'array',
            items: { $ref: '#/components/schemas/AccessAuditRecord' }
          }, true)
        }
      },
      '/api/scenarios/{id}/start': {
        post: {
          summary: 'Start a built-in scenario run',
          parameters: [{
            name: 'id',
            in: 'path',
            required: true,
            schema: { type: 'string', enum: ['weekday_normal', 'away_day', 'night_water_leak'] }
          }],
          requestBody: jsonBody(idempotencyRequestSchema()),
          responses: updateResponses(true)
        }
      },
      '/api/daily/start': {
        post: {
          summary: 'Start a generated daily routine',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              date: { type: 'string', format: 'date' },
              seed: { type: 'integer', minimum: 0, maximum: 0xffffffff },
              idempotencyKey: idempotencyKeySchema
            }
          }),
          responses: updateResponses()
        }
      },
      '/api/control/advance': {
        post: {
          summary: 'Advance the simulation clock',
          requestBody: jsonBody({
            type: 'object',
            properties: {
              minutes: { type: 'integer', minimum: 1, maximum: 1440, default: 1 },
              idempotencyKey: idempotencyKeySchema
            }
          }),
          responses: updateResponses()
        }
      },
      '/api/control/pause': {
        post: {
          summary: 'Pause the simulation clock',
          requestBody: jsonBody(idempotencyRequestSchema()),
          responses: updateResponses()
        }
      },
      '/api/control/resume': {
        post: {
          summary: 'Resume the simulation clock',
          requestBody: jsonBody(idempotencyRequestSchema()),
          responses: updateResponses()
        }
      },
      '/api/control/inject': {
        post: {
          summary: 'Inject an abnormality source fact',
          requestBody: jsonBody(abnormalityRequestSchema()),
          responses: updateResponses()
        }
      },
      '/api/control/resolve': {
        post: {
          summary: 'Resolve an injected abnormality fact',
          requestBody: jsonBody(abnormalityRequestSchema()),
          responses: updateResponses()
        }
      },
      '/api/devices/{deviceId}/command': {
        post: {
          summary: 'Execute a supported simulated device command',
          parameters: [{
            name: 'deviceId',
            in: 'path',
            required: true,
            schema: stringSchema
          }],
          requestBody: jsonBody(deviceCommandRequestSchema()),
          responses: updateResponses(true)
        }
      },
      '/api/alerts/{alertId}/status': {
        post: {
          summary: 'Change an alert lifecycle status',
          parameters: [{
            name: 'alertId',
            in: 'path',
            required: true,
            schema: stringSchema
          }],
          requestBody: jsonBody(alertStatusRequestSchema()),
          responses: updateResponses(true)
        }
      },
      '/ws': {
        get: {
          summary: 'Open the twin update WebSocket stream',
          description: 'Clients receive twin.update and twin.heartbeat messages. Reconnect with runId and afterSequence to replay missed events.',
          parameters: [privacyParameter(), runIdParameter(), {
            name: 'afterSequence',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0 }
          }],
          responses: {
            '101': {
              description: 'WebSocket protocol upgrade. Messages are TwinSocketUpdateMessage or TwinSocketHeartbeatMessage.'
            }
          }
        }
      }
    },
    components: {
      schemas: {
        TwinSnapshot: twinSnapshotSchema,
        TwinEvent: twinEventSchema,
        AbnormalityInjectedEvent: abnormalityInjectedEventSchema,
        AlertStatusChangedEvent: alertStatusChangedEventSchema,
        ObjectMovedEvent: objectMovedEventSchema,
        HomeDefinition: homeDefinitionSchema,
        DeviceAccessRecord: deviceAccessRecordSchema,
        DeviceCapability: deviceCapabilitySchema,
        TelemetrySummary: telemetrySummarySchema,
        AccessAuditRecord: accessAuditRecordSchema,
        UpdateResponse: updateResponseSchema,
        TwinSocketUpdateMessage: twinSocketUpdateMessageSchema,
        TwinSocketHeartbeatMessage: twinSocketHeartbeatMessageSchema,
        ValidationError: validationErrorSchema,
        NotFoundError: notFoundErrorSchema,
        IdempotencyConflict: idempotencyConflictSchema
      }
    }
  };
}

function okResponse(schema: JsonSchema, includeValidationError = false): Record<string, unknown> {
  return {
    '200': {
      description: 'OK',
      content: {
        'application/json': { schema }
      }
    },
    ...(includeValidationError ? validationErrorResponse() : {})
  };
}

function updateResponses(includeNotFound = false): Record<string, unknown> {
  return {
    ...okResponse({ $ref: '#/components/schemas/UpdateResponse' }, true),
    '409': {
      description: 'Idempotency key conflict',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/IdempotencyConflict' } }
      }
    },
    ...(includeNotFound ? {
      '404': {
        description: 'Resource not found',
        content: {
          'application/json': {
            schema: { $ref: '#/components/schemas/NotFoundError' }
          }
        }
      }
    } : {})
  };
}

function validationErrorResponse(): Record<string, unknown> {
  return {
    '400': {
      description: 'Validation failed',
      content: {
        'application/json': { schema: { $ref: '#/components/schemas/ValidationError' } }
      }
    }
  };
}

function jsonBody(schema: JsonSchema): Record<string, unknown> {
  return {
    required: false,
    content: {
      'application/json': { schema }
    }
  };
}

function idempotencyRequestSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      idempotencyKey: idempotencyKeySchema
    }
  };
}

function abnormalityRequestSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['kind'],
    properties: {
      kind: {
        type: 'string',
        enum: ['door_left_open', 'fridge_left_open', 'network_offline', 'senior_no_activity']
      },
      idempotencyKey: idempotencyKeySchema
    }
  };
}

function alertStatusRequestSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['status'],
    properties: {
      status: {
        type: 'string',
        enum: ['active', 'acknowledged', 'resolved', 'ignored']
      },
      idempotencyKey: idempotencyKeySchema
    }
  };
}

function deviceCommandRequestSchema(): JsonSchema {
  return {
    type: 'object',
    required: ['command'],
    properties: {
      command: stringSchema,
      value: {
        anyOf: [
          stringSchema,
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' }
        ]
      },
      idempotencyKey: idempotencyKeySchema
    }
  };
}

function alertLifecycleStatusSchema(): JsonSchema {
  return {
    type: 'string',
    enum: ['active', 'acknowledged', 'resolved', 'ignored']
  };
}

function limitParameter(): Record<string, unknown> {
  return {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: 500, default: 100 }
  };
}

function privacyParameter(): Record<string, unknown> {
  return {
    name: 'privacy',
    in: 'query',
    required: false,
    schema: { type: 'string', enum: ['admin', 'public', 'ml-observation'], default: 'admin' }
  };
}

function runIdParameter(): Record<string, unknown> {
  return {
    name: 'runId',
    in: 'query',
    required: false,
    schema: stringSchema
  };
}
