type JsonSchema = Record<string, unknown>;

const stringSchema = { type: 'string' };
const isoDateTimeSchema = { type: 'string', format: 'date-time' };
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

const twinEventSchema: JsonSchema = {
  anyOf: [
    { $ref: '#/components/schemas/AbnormalityInjectedEvent' },
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

const accessAuditRecordSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'ts', 'method', 'endpoint', 'privacy', 'runId', 'sequence', 'details'],
  properties: {
    id: { type: 'integer', minimum: 1 },
    ts: isoDateTimeSchema,
    method: stringSchema,
    endpoint: stringSchema,
    privacy: { type: 'string', enum: ['admin', 'public'] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    sequence: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
    details: { type: 'object', additionalProperties: true }
  }
};

const deviceAccessRecordSchema: JsonSchema = {
  type: 'object',
  required: ['deviceId', 'roomId', 'deviceType', 'displayName', 'protocol', 'desiredState', 'reportedState', 'connectivity', 'lastSeenAt', 'dataQuality'],
  properties: {
    deviceId: stringSchema,
    roomId: stringSchema,
    deviceType: stringSchema,
    displayName: stringSchema,
    protocol: { type: 'string', enum: ['simulated'] },
    desiredState: {
      anyOf: [
        { type: 'object', additionalProperties: true },
        { type: 'null' }
      ]
    },
    reportedState: { type: 'object', additionalProperties: true },
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
          required: ['commandId', 'status', 'requestedAt', 'acknowledgedAt', 'reason'],
          properties: {
            commandId: stringSchema,
            status: { type: 'string', enum: ['requested', 'sent', 'acknowledged', 'failed', 'timed-out', 'none'] },
            requestedAt: isoDateTimeSchema,
            acknowledgedAt: {
              anyOf: [isoDateTimeSchema, { type: 'null' }]
            },
            reason: {
              anyOf: [stringSchema, { type: 'null' }]
            }
          }
        },
        { type: 'null' }
      ]
    }
  }
};

const deviceCapabilitySchema: JsonSchema = {
  type: 'object',
  required: ['displayName', 'shortLabel', 'icon', 'markerKind', 'animationHint', 'defaultState', 'stateFields', 'telemetry', 'supportedCommands'],
  properties: {
    displayName: stringSchema,
    shortLabel: stringSchema,
    icon: stringSchema,
    markerKind: { type: 'string', enum: ['sensor', 'actuator', 'appliance', 'security', 'mobile'] },
    animationHint: { type: 'string', enum: ['airflow', 'curtain', 'glow', 'none', 'pulse', 'rotate', 'scan', 'vibrate'] },
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
          parameters: [limitParameter(), runIdParameter()],
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
          responses: okResponse({
            type: 'array',
            items: { $ref: '#/components/schemas/DeviceAccessRecord' }
          })
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
            '101': { description: 'WebSocket protocol upgrade' }
          }
        }
      }
    },
    components: {
      schemas: {
        TwinSnapshot: twinSnapshotSchema,
        TwinEvent: twinEventSchema,
        AbnormalityInjectedEvent: abnormalityInjectedEventSchema,
        HomeDefinition: homeDefinitionSchema,
        DeviceAccessRecord: deviceAccessRecordSchema,
        DeviceCapability: deviceCapabilitySchema,
        TelemetrySummary: telemetrySummarySchema,
        AccessAuditRecord: accessAuditRecordSchema,
        UpdateResponse: updateResponseSchema,
        ValidationError: validationErrorSchema,
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
        description: 'Unknown scenario',
        content: {
          'application/json': {
            schema: {
              type: 'object',
              properties: { error: stringSchema }
            }
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
    schema: { type: 'string', enum: ['admin', 'public'], default: 'admin' }
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
