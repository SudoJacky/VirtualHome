type JsonSchema = Record<string, unknown>;

const stringSchema = { type: 'string' };
const isoDateTimeSchema = { type: 'string', format: 'date-time' };
const roomIdSchema = {
  type: 'string',
  enum: ['entrance', 'living_room', 'kitchen', 'dining_room', 'master_bedroom', 'child_bedroom', 'study', 'bathroom', 'garden']
};
const roomOrAwaySchema = {
  type: 'string',
  enum: ['entrance', 'living_room', 'kitchen', 'dining_room', 'master_bedroom', 'child_bedroom', 'study', 'bathroom', 'garden', 'away']
};
const alertSeveritySchema = {
  type: 'string',
  enum: ['info', 'warning', 'high']
};
const eventSourceLayerSchema = {
  type: 'string',
  enum: ['truth', 'world', 'sensor', 'inference', 'control']
};
const eventObservabilitySchema = {
  type: 'string',
  enum: ['private', 'admin', 'ml_observation', 'public']
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

const eventLineageSchema: JsonSchema = {
  type: 'object',
  required: ['eventTime', 'ingestTime', 'sourceLayer', 'causeEventIds', 'episodeId', 'observability', 'quality', 'schemaVersion', 'behaviorModelVersion'],
  properties: {
    eventTime: isoDateTimeSchema,
    ingestTime: isoDateTimeSchema,
    sourceLayer: eventSourceLayerSchema,
    causeEventIds: {
      type: 'array',
      items: stringSchema
    },
    episodeId: stringSchema,
    parentEpisodeId: stringSchema,
    observability: eventObservabilitySchema,
    quality: {
      type: 'object',
      properties: {
        delayedMs: { type: 'number', minimum: 0 },
        dropped: { type: 'boolean' },
        duplicated: { type: 'boolean' },
        outOfOrder: { type: 'boolean' },
        noisy: { type: 'boolean' },
        confidence: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    schemaVersion: { type: 'integer', minimum: 1 },
    behaviorModelVersion: stringSchema
  }
};

const eventExplanationSchema: JsonSchema = {
  type: 'object',
  required: ['why', 'actorIds', 'affectedDeviceIds', 'affectedRoomIds', 'expectedOutcome'],
  properties: {
    why: stringSchema,
    actorIds: {
      type: 'array',
      items: stringSchema
    },
    affectedDeviceIds: {
      type: 'array',
      items: stringSchema
    },
    affectedRoomIds: {
      type: 'array',
      items: roomIdSchema
    },
    relatedIntent: stringSchema,
    expectedOutcome: stringSchema
  }
};

const twinEventBaseSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: stringSchema,
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: eventSourceLayerSchema,
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    eventExplanation: { $ref: '#/components/schemas/EventExplanation' }
  },
  additionalProperties: true
};

const deviceTelemetryEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'roomId', 'deviceId', 'deviceType', 'measurements'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['DeviceTelemetry'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['sensor'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    roomId: roomIdSchema,
    deviceId: stringSchema,
    deviceType: stringSchema,
    measurements: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          { type: 'number' },
          { type: 'boolean' }
        ]
      }
    }
  }
};

const deviceStateChangedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'roomId', 'deviceId', 'deviceType', 'state'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['DeviceStateChanged'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['world'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    roomId: roomIdSchema,
    deviceId: stringSchema,
    deviceType: stringSchema,
    state: {
      type: 'object',
      additionalProperties: {
        anyOf: [
          stringSchema,
          { type: 'number' },
          { type: 'boolean' },
          { type: 'null' }
        ]
      }
    }
  }
};

const personMovedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'personId', 'from', 'to', 'activity'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['PersonMoved'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['truth'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    personId: stringSchema,
    from: roomOrAwaySchema,
    to: roomOrAwaySchema,
    activity: stringSchema,
    travelMinutes: { type: 'number', minimum: 0 }
  }
};

const activityStartedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'activityId', 'participants', 'roomId'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['ActivityStarted'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['truth'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    activityId: stringSchema,
    participants: {
      type: 'array',
      items: stringSchema
    },
    roomId: roomIdSchema
  }
};

const activityEndedEventSchema: JsonSchema = {
  ...activityStartedEventSchema,
  properties: {
    ...(activityStartedEventSchema.properties as Record<string, unknown>),
    type: { type: 'string', enum: ['ActivityEnded'] }
  }
};

const conversationOccurredEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'conversationId', 'speakerId', 'listenerIds', 'topic', 'intent', 'roomId', 'summary'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['ConversationOccurred'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['truth'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    conversationId: stringSchema,
    speakerId: stringSchema,
    listenerIds: {
      type: 'array',
      items: stringSchema
    },
    topic: stringSchema,
    intent: stringSchema,
    roomId: roomIdSchema,
    summary: stringSchema
  }
};

const abnormalityInjectedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'kind', 'affectedEntities'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['AbnormalityInjected'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['control'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
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
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'alertId', 'previousStatus', 'status'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['AlertStatusChanged'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['control'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    alertId: stringSchema,
    previousStatus: alertLifecycleStatusSchema(),
    status: alertLifecycleStatusSchema()
  }
};

const objectMovedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'objectId', 'from', 'to'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['ObjectMoved'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['world'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    objectId: stringSchema,
    from: roomIdSchema,
    to: roomIdSchema,
    carriedByPersonId: stringSchema
  }
};

const externalInteractionOccurredEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'interactionId', 'actorKind', 'purpose', 'roomId', 'status', 'relatedDeviceIds'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['ExternalInteractionOccurred'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['truth'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    interactionId: stringSchema,
    actorKind: { type: 'string', enum: ['courier', 'visitor', 'repair'] },
    purpose: stringSchema,
    roomId: roomIdSchema,
    status: { type: 'string', enum: ['detected', 'acknowledged', 'completed', 'scheduled'] },
    relatedDeviceIds: {
      type: 'array',
      items: stringSchema
    }
  }
};

const automationTriggeredEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'ruleId', 'explanation', 'actions'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['AutomationTriggered'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['inference'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    ruleId: stringSchema,
    explanation: stringSchema,
    eventExplanation: { $ref: '#/components/schemas/EventExplanation' },
    actions: {
      type: 'array',
      items: stringSchema
    }
  }
};

const ruleRecoveredEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'ruleId', 'recoveredFacts', 'cooldownUntil'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['RuleRecovered'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['inference'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    ruleId: stringSchema,
    recoveredFacts: {
      type: 'array',
      items: stringSchema
    },
    cooldownUntil: isoDateTimeSchema
  }
};

const alertCreatedEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'alertId', 'severity', 'roomId', 'message', 'recommendedAction'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['AlertCreated'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['inference'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    alertId: stringSchema,
    severity: alertSeveritySchema,
    roomId: roomIdSchema,
    message: stringSchema,
    recommendedAction: stringSchema,
    eventExplanation: { $ref: '#/components/schemas/EventExplanation' },
    sourceRuleId: stringSchema,
    sourceEntityIds: {
      type: 'array',
      items: stringSchema
    }
  }
};

const scenarioControlEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'runId', 'type', 'simTime', 'homeId', 'scenarioId', 'sequence', 'sourceLayer', 'lineage', 'command', 'value'],
  properties: {
    id: stringSchema,
    runId: stringSchema,
    type: { type: 'string', enum: ['ScenarioControl'] },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    scenarioId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    sourceLayer: { type: 'string', enum: ['control'] },
    lineage: { $ref: '#/components/schemas/EventLineage' },
    reason: stringSchema,
    command: { type: 'string', enum: ['start', 'pause', 'resume', 'speed', 'inject'] },
    value: {
      anyOf: [
        stringSchema,
        { type: 'number' },
        { type: 'boolean' }
      ]
    }
  }
};

const twinEventSchema: JsonSchema = {
  anyOf: [
    { $ref: '#/components/schemas/DeviceTelemetryEvent' },
    { $ref: '#/components/schemas/DeviceStateChangedEvent' },
    { $ref: '#/components/schemas/PersonMovedEvent' },
    { $ref: '#/components/schemas/ActivityStartedEvent' },
    { $ref: '#/components/schemas/ActivityEndedEvent' },
    { $ref: '#/components/schemas/ConversationOccurredEvent' },
    { $ref: '#/components/schemas/AbnormalityInjectedEvent' },
    { $ref: '#/components/schemas/AlertCreatedEvent' },
    { $ref: '#/components/schemas/AlertStatusChangedEvent' },
    { $ref: '#/components/schemas/AutomationTriggeredEvent' },
    { $ref: '#/components/schemas/RuleRecoveredEvent' },
    { $ref: '#/components/schemas/ScenarioControlEvent' },
    { $ref: '#/components/schemas/ObjectMovedEvent' },
    { $ref: '#/components/schemas/ExternalInteractionOccurredEvent' },
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

const deviceValueEventSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'sourceEventId', 'sourceEventType', 'runId', 'sequence', 'ts', 'simTime', 'homeId', 'roomId', 'deviceId', 'deviceType', 'field', 'value'],
  properties: {
    id: stringSchema,
    sourceEventId: stringSchema,
    sourceEventType: { type: 'string', enum: ['DeviceTelemetry', 'DeviceStateChanged'] },
    runId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    roomId: roomIdSchema,
    deviceId: stringSchema,
    deviceType: stringSchema,
    field: stringSchema,
    value: {
      anyOf: [
        stringSchema,
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' }
      ]
    }
  }
};

const deviceSocketUpdateMessageSchema: JsonSchema = {
  type: 'object',
  required: ['type', 'runId', 'sequence', 'replayComplete', 'events'],
  properties: {
    type: { type: 'string', enum: ['device.update'] },
    runId: stringSchema,
    sequence: { type: 'integer', minimum: 0 },
    replayComplete: {
      type: 'boolean',
      description: 'False when reconnect replay was truncated and the client should reconnect from an earlier cursor or refresh.'
    },
    events: {
      type: 'array',
      items: { $ref: '#/components/schemas/DeviceValueEvent' }
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

const memoryEvidenceSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'sourceEventId', 'runId', 'sequence', 'simTime', 'homeId', 'roomId', 'deviceId', 'deviceType', 'field', 'value', 'evidenceCategory', 'evidenceStrength', 'capability', 'profileWeight', 'evidenceReason'],
  properties: {
    id: stringSchema,
    sourceEventId: stringSchema,
    sourceEventType: { type: 'string', enum: ['DeviceTelemetry', 'DeviceStateChanged'] },
    runId: stringSchema,
    sequence: { type: 'integer', minimum: 1 },
    ts: isoDateTimeSchema,
    simTime: isoDateTimeSchema,
    homeId: stringSchema,
    roomId: roomIdSchema,
    deviceId: stringSchema,
    deviceType: stringSchema,
    field: stringSchema,
    value: {
      anyOf: [
        stringSchema,
        { type: 'number' },
        { type: 'boolean' },
        { type: 'null' }
      ]
    },
    timeBucket: { type: 'string', enum: ['morning', 'daytime', 'evening', 'night'] },
    evidenceCategory: { type: 'string', enum: ['human_activity', 'device_usage', 'environment_context', 'system_status'] },
    evidenceStrength: { type: 'string', enum: ['strong', 'medium', 'weak', 'ignored'] },
    capability: {
      type: 'object',
      required: ['type', 'active', 'reason'],
      properties: {
        type: {
          type: 'string',
          enum: [
            'access_control',
            'presence_detection',
            'sleep_context',
            'water_flow',
            'climate_control',
            'environment_air_quality',
            'environment_humidity',
            'environment_temperature',
            'system_health',
            'power_usage',
            'generic_device_state'
          ]
        },
        active: { type: 'boolean' },
        reason: stringSchema
      }
    },
    meaningfulChange: { type: 'boolean' },
    valueDelta: { type: 'number' },
    profileWeight: { type: 'number' },
    evidenceReason: stringSchema
  }
};

const memoryLlmEnrichmentSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'purpose', 'claim', 'type', 'confidence', 'supportingEvidenceIds', 'contradictingEvidenceIds', 'missingEvidence', 'alternatives', 'metadata'],
  properties: {
    id: stringSchema,
    purpose: { type: 'string', enum: ['unknown_schema_mapping', 'semantic_candidate', 'hypothesis_explanation', 'reliability_review', 'query_planning', 'daily_portrait_summary'] },
    claim: stringSchema,
    type: { type: 'string', enum: ['semantic_candidate', 'hypothesis_explanation', 'reliability_review', 'query_plan', 'portrait_summary'] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    supportingEvidenceIds: {
      type: 'array',
      items: stringSchema
    },
    contradictingEvidenceIds: {
      type: 'array',
      items: stringSchema
    },
    missingEvidence: {
      type: 'array',
      items: stringSchema
    },
    alternatives: {
      type: 'array',
      items: {
        type: 'object',
        required: ['claim', 'confidence', 'evidenceIds'],
        properties: {
          claim: stringSchema,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidenceIds: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    },
    metadata: {
      type: 'object',
      required: ['model', 'baseUrlHash', 'promptVersion', 'schemaVersion', 'inputHash', 'outputHash', 'createdAt'],
      properties: {
        model: stringSchema,
        baseUrlHash: stringSchema,
        promptVersion: { type: 'integer', minimum: 1 },
        schemaVersion: { type: 'integer', minimum: 1 },
        inputHash: stringSchema,
        outputHash: stringSchema,
        createdAt: isoDateTimeSchema
      }
    }
  }
};

const memoryHypothesisReliabilitySchema: JsonSchema = {
  type: 'object',
  required: ['evidenceCount', 'supportingEvidenceCount', 'contradictingEvidenceCount', 'missingEvidence', 'unsupportedClaimCount', 'explanationSource'],
  properties: {
    evidenceCount: { type: 'integer', minimum: 0 },
    supportingEvidenceCount: { type: 'integer', minimum: 0 },
    contradictingEvidenceCount: { type: 'integer', minimum: 0 },
    missingEvidence: {
      type: 'array',
      items: stringSchema
    },
    unsupportedClaimCount: { type: 'integer', minimum: 0 },
    explanationSource: { type: 'string', enum: ['rule_template', 'llm_enrichment', 'mixed'] }
  }
};

const memoryHypothesisSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'type', 'label', 'summary', 'confidence', 'updatedAt', 'evidenceCount', 'subjectIds'],
  properties: {
    id: stringSchema,
    type: { type: 'string', enum: ['household_size', 'daily_rhythm', 'room_habit', 'device_routine', 'presence_signal', 'activity_cluster', 'routine_window', 'behavior_flow', 'resident_slot', 'room_function', 'device_contribution', 'state_anomaly'] },
    label: stringSchema,
    summary: stringSchema,
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    updatedAt: isoDateTimeSchema,
    evidenceCount: { type: 'integer', minimum: 0 },
    subjectIds: {
      type: 'array',
      items: stringSchema
    },
    evidence: {
      type: 'array',
      items: { $ref: '#/components/schemas/MemoryEvidence' }
    },
    reliability: memoryHypothesisReliabilitySchema,
    llmEnrichment: memoryLlmEnrichmentSchema,
    llmEnrichmentSource: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback'] },
    llmEnrichmentErrors: {
      type: 'array',
      items: stringSchema
    },
    llmReliabilityReview: memoryLlmEnrichmentSchema,
    llmReliabilityReviewSource: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback'] },
    llmReliabilityReviewErrors: {
      type: 'array',
      items: stringSchema
    }
  }
};

const memorySummarySchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'totalEvents', 'profileEventCount', 'profileEvidenceWeight', 'activeRooms', 'activeDevices', 'activeEpisodes', 'activityEpisodes', 'topPatterns', 'recentHighlights', 'updatedAt'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    totalEvents: { type: 'integer', minimum: 0 },
    profileEventCount: { type: 'integer', minimum: 0 },
    profileEvidenceWeight: { type: 'number', minimum: 0 },
    activeRooms: {
      type: 'array',
      items: stringSchema
    },
    activeDevices: {
      type: 'array',
      items: stringSchema
    },
    activeEpisodes: {
      type: 'array',
      items: { type: 'object', additionalProperties: true }
    },
    activityEpisodes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'kind', 'roomIds', 'deviceIds', 'updatedSimTime', 'evidenceIds', 'summary'],
        properties: {
          id: stringSchema,
          kind: { type: 'string', enum: ['return_home', 'meal_preparation', 'bedtime', 'climate_response'] },
          roomIds: {
            type: 'array',
            items: stringSchema
          },
          deviceIds: {
            type: 'array',
            items: stringSchema
          },
          updatedSimTime: isoDateTimeSchema,
          evidenceIds: {
            type: 'array',
            items: stringSchema
          },
          summary: stringSchema
        }
      }
    },
    topPatterns: {
      type: 'array',
      items: { $ref: '#/components/schemas/MemoryHypothesis' }
    },
    recentHighlights: {
      type: 'array',
      items: { $ref: '#/components/schemas/MemoryEvidence' }
    },
    updatedAt: { anyOf: [isoDateTimeSchema, { type: 'null' }] }
  }
};

const householdPortraitSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'updatedAt', 'confidence', 'sections', 'evidenceQuality'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    updatedAt: { anyOf: [isoDateTimeSchema, { type: 'null' }] },
    confidence: { type: 'number', minimum: 0, maximum: 1 },
    sections: {
      type: 'array',
      items: {
        type: 'object',
        required: ['id', 'label', 'summary', 'confidence', 'evidenceIds', 'missingEvidence', 'contradictingEvidenceIds', 'updatedAt', 'explanationSource', 'hypothesisIds'],
        properties: {
          id: { type: 'string', enum: ['household_composition', 'daily_rhythm', 'room_functions', 'routine_patterns', 'behavior_flows', 'device_contribution', 'current_presence', 'anomalies_and_uncertainty', 'evidence_quality'] },
          label: stringSchema,
          summary: stringSchema,
          confidence: { type: 'number', minimum: 0, maximum: 1 },
          evidenceIds: {
            type: 'array',
            items: stringSchema
          },
          missingEvidence: {
            type: 'array',
            items: stringSchema
          },
          contradictingEvidenceIds: {
            type: 'array',
            items: stringSchema
          },
          updatedAt: { anyOf: [isoDateTimeSchema, { type: 'null' }] },
          explanationSource: { type: 'string', enum: ['rule_template', 'llm_enrichment', 'mixed'] },
          hypothesisIds: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    },
    evidenceQuality: {
      type: 'object',
      required: ['evidenceCount', 'independentDeviceCount', 'distinctRoomCount', 'observedDayCount', 'observedWeekCount', 'environmentContextRatio', 'unsupportedClaimCount', 'missingEvidence'],
      properties: {
        evidenceCount: { type: 'integer', minimum: 0 },
        independentDeviceCount: { type: 'integer', minimum: 0 },
        distinctRoomCount: { type: 'integer', minimum: 0 },
        observedDayCount: { type: 'integer', minimum: 0 },
        observedWeekCount: { type: 'integer', minimum: 0 },
        environmentContextRatio: { type: 'number', minimum: 0, maximum: 1 },
        unsupportedClaimCount: { type: 'integer', minimum: 0 },
        missingEvidence: {
          type: 'array',
          items: stringSchema
        }
      }
    },
    llmSummary: {
      type: 'object',
      additionalProperties: true
    },
    llmSummarySource: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback'] },
    llmSummaryErrors: {
      type: 'array',
      items: stringSchema
    }
  }
};

const memoryQueryPlanSchema: JsonSchema = {
  type: 'object',
  required: ['question', 'plan', 'planSource', 'execution'],
  properties: {
    question: stringSchema,
    plan: {
      type: 'object',
      additionalProperties: true
    },
    planSource: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback'] },
    planErrors: {
      type: 'array',
      items: stringSchema
    },
    execution: {
      type: 'object',
      required: ['target', 'query', 'evidenceIds', 'items'],
      properties: {
        target: { type: 'string', enum: ['evidence', 'hypotheses', 'summary'] },
        query: {
          type: 'object',
          additionalProperties: true
        },
        evidenceIds: {
          type: 'array',
          items: stringSchema
        },
        items: {
          type: 'array',
          items: { type: 'object', additionalProperties: true }
        }
      }
    }
  }
};

const unknownSchemaMappingResultSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'items'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['candidate'],
        properties: {
          candidate: {
            type: 'object',
            required: ['id', 'homeId', 'runId', 'deviceType', 'field', 'deviceIds', 'roomIds', 'evidenceIds', 'observedValues'],
            properties: {
              id: stringSchema,
              homeId: stringSchema,
              runId: stringSchema,
              deviceType: stringSchema,
              field: stringSchema,
              deviceIds: {
                type: 'array',
                items: stringSchema
              },
              roomIds: {
                type: 'array',
                items: stringSchema
              },
              evidenceIds: {
                type: 'array',
                items: stringSchema
              },
              observedValues: {
                type: 'array',
                items: {
                  anyOf: [
                    stringSchema,
                    { type: 'number' },
                    { type: 'boolean' },
                    { type: 'null' }
                  ]
                }
              }
            }
          },
          mapping: memoryLlmEnrichmentSchema,
          mappingSource: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback'] },
          mappingErrors: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    }
  }
};

const semanticCandidateResultSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'items'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['window'],
        properties: {
          window: {
            type: 'object',
            required: ['id', 'homeId', 'runId', 'roomId', 'timeBucket', 'evidenceIds', 'deviceIds', 'deterministicSignalTypes'],
            properties: {
              id: stringSchema,
              homeId: stringSchema,
              runId: stringSchema,
              roomId: stringSchema,
              timeBucket: { type: 'string', enum: ['morning', 'daytime', 'evening', 'night'] },
              evidenceIds: {
                type: 'array',
                items: stringSchema
              },
              deviceIds: {
                type: 'array',
                items: stringSchema
              },
              deterministicSignalTypes: {
                type: 'array',
                items: stringSchema
              }
            }
          },
          candidate: memoryLlmEnrichmentSchema,
          candidateSource: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback'] },
          candidateErrors: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    }
  }
};

const memoryReliabilityReportSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'updatedAt', 'factLayer', 'semanticLayer', 'portraitLayer', 'graphLayer'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    updatedAt: { anyOf: [isoDateTimeSchema, { type: 'null' }] },
    factLayer: {
      type: 'object',
      required: ['eventCount', 'evidenceCount', 'eventCoverage', 'sequenceConsistency', 'runIsolation'],
      properties: {
        eventCount: { type: 'integer', minimum: 0 },
        evidenceCount: { type: 'integer', minimum: 0 },
        eventCoverage: { type: 'number', minimum: 0, maximum: 1 },
        sequenceConsistency: { type: 'number', minimum: 0, maximum: 1 },
        runIsolation: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    semanticLayer: {
      type: 'object',
      required: ['semanticSignalCount', 'evidenceLinkCorrectness', 'orphanSemanticCount'],
      properties: {
        semanticSignalCount: { type: 'integer', minimum: 0 },
        evidenceLinkCorrectness: { type: 'number', minimum: 0, maximum: 1 },
        orphanSemanticCount: { type: 'integer', minimum: 0 }
      }
    },
    portraitLayer: {
      type: 'object',
      required: ['hypothesisCount', 'evidenceLinkedHypothesisCount', 'unsupportedClaimCount', 'contradictionRate'],
      properties: {
        hypothesisCount: { type: 'integer', minimum: 0 },
        evidenceLinkedHypothesisCount: { type: 'integer', minimum: 0 },
        unsupportedClaimCount: { type: 'integer', minimum: 0 },
        contradictionRate: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    graphLayer: {
      type: 'object',
      required: ['nodeCount', 'edgeCount', 'edgeEndpointIntegrity', 'orphanHypothesisCount', 'missingEvidenceReferenceCount', 'confidenceMonotonicityViolations', 'environmentOnlyCapViolations'],
      properties: {
        nodeCount: { type: 'integer', minimum: 0 },
        edgeCount: { type: 'integer', minimum: 0 },
        edgeEndpointIntegrity: { type: 'number', minimum: 0, maximum: 1 },
        orphanHypothesisCount: { type: 'integer', minimum: 0 },
        missingEvidenceReferenceCount: { type: 'integer', minimum: 0 },
        confidenceMonotonicityViolations: { type: 'integer', minimum: 0 },
        environmentOnlyCapViolations: { type: 'integer', minimum: 0 }
      }
    }
  }
};

const homeMemoryLlmBatchPlanSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'realtimeDeviceEventCallsAllowed', 'maxBatchSize', 'candidateCount', 'allowedCount', 'skippedCount', 'estimatedMaxTokens', 'items'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    realtimeDeviceEventCallsAllowed: { type: 'boolean' },
    maxBatchSize: { type: 'integer', minimum: 1 },
    candidateCount: { type: 'integer', minimum: 0 },
    allowedCount: { type: 'integer', minimum: 0 },
    skippedCount: { type: 'integer', minimum: 0 },
    estimatedMaxTokens: { type: 'integer', minimum: 0 },
    items: {
      type: 'array',
      items: {
        type: 'object',
        required: ['purpose', 'trigger', 'targetId', 'evidenceIds', 'cacheKey', 'shouldCall', 'reason', 'maxTokens', 'priority', 'cached'],
        properties: {
          purpose: { type: 'string', enum: ['unknown_schema_mapping', 'semantic_candidate', 'hypothesis_explanation', 'reliability_review', 'query_planning', 'daily_portrait_summary'] },
          trigger: { type: 'string', enum: ['batch'] },
          targetId: stringSchema,
          evidenceIds: {
            type: 'array',
            items: stringSchema
          },
          cacheKey: stringSchema,
          shouldCall: { type: 'boolean' },
          reason: stringSchema,
          maxTokens: { type: 'integer', minimum: 0 },
          priority: { type: 'string', enum: ['low', 'normal', 'high'] },
          cached: { type: 'boolean' }
        }
      }
    }
  }
};

const homeMemoryLlmBatchExecutionSchema: JsonSchema = {
  type: 'object',
  required: ['homeId', 'runId', 'plan', 'results'],
  properties: {
    homeId: { anyOf: [stringSchema, { type: 'null' }] },
    runId: { anyOf: [stringSchema, { type: 'null' }] },
    plan: { $ref: '#/components/schemas/HomeMemoryLlmBatchPlan' },
    results: {
      type: 'array',
      items: {
        type: 'object',
        required: ['purpose', 'targetId', 'source', 'cacheKey', 'errors'],
        properties: {
          purpose: { type: 'string', enum: ['unknown_schema_mapping', 'semantic_candidate', 'hypothesis_explanation', 'reliability_review', 'query_planning', 'daily_portrait_summary'] },
          targetId: stringSchema,
          source: { type: 'string', enum: ['cache', 'llm', 'deterministic-fallback', 'skipped'] },
          cacheKey: stringSchema,
          enrichment: { $ref: '#/components/schemas/HomeMemoryLlmEnrichment' },
          errors: {
            type: 'array',
            items: stringSchema
          }
        }
      }
    }
  }
};

const homeMemoryLlmConfigSchema: JsonSchema = {
  type: 'object',
  required: ['provider', 'budget', 'gates'],
  properties: {
    provider: {
      type: 'object',
      required: ['enabled', 'provider', 'baseUrl', 'model', 'timeoutMs', 'maxRetries', 'apiKeyConfigured'],
      properties: {
        enabled: { type: 'boolean' },
        provider: { type: 'string', enum: ['openai-compatible'] },
        baseUrl: stringSchema,
        model: stringSchema,
        timeoutMs: { type: 'integer', minimum: 1000 },
        maxRetries: { type: 'integer', minimum: 0 },
        apiKeyConfigured: { type: 'boolean' }
      }
    },
    budget: {
      type: 'object',
      required: ['maxCallsPerHomePerHour', 'maxCallsPerHomePerDay', 'maxBatchSize'],
      properties: {
        maxCallsPerHomePerHour: { type: 'integer', minimum: 1 },
        maxCallsPerHomePerDay: { type: 'integer', minimum: 1 },
        maxBatchSize: { type: 'integer', minimum: 1 }
      }
    },
    gates: {
      type: 'object',
      required: ['minEvidenceCountForUnknownSchema', 'minConfidenceForReview', 'maxConfidenceForReview'],
      properties: {
        minEvidenceCountForUnknownSchema: { type: 'integer', minimum: 1 },
        minConfidenceForReview: { type: 'number', minimum: 0, maximum: 1 },
        maxConfidenceForReview: { type: 'number', minimum: 0, maximum: 1 }
      }
    }
  }
};

const memoryLlmMetricsSchema: JsonSchema = {
  type: 'object',
  required: ['enabled', 'provider', 'model', 'cacheSize', 'unsupportedClaimRate', 'totalRequests', 'sourceCounts', 'rates', 'callsByPurpose', 'requestsByPurpose', 'estimatedTokensByPurpose', 'validationRejectionCount', 'budgets'],
  properties: {
    enabled: { type: 'boolean' },
    provider: { type: 'string', enum: ['openai-compatible'] },
    model: stringSchema,
    cacheSize: { type: 'integer', minimum: 0 },
    unsupportedClaimRate: { type: 'number', minimum: 0, maximum: 1 },
    totalRequests: { type: 'integer', minimum: 0 },
    sourceCounts: {
      type: 'object',
      required: ['llm', 'cache', 'deterministicFallback'],
      properties: {
        llm: { type: 'integer', minimum: 0 },
        cache: { type: 'integer', minimum: 0 },
        deterministicFallback: { type: 'integer', minimum: 0 }
      }
    },
    rates: {
      type: 'object',
      required: ['cacheHitRate', 'fallbackRate', 'validationRejectionRate', 'userTriggeredCallRatio'],
      properties: {
        cacheHitRate: { type: 'number', minimum: 0, maximum: 1 },
        fallbackRate: { type: 'number', minimum: 0, maximum: 1 },
        validationRejectionRate: { type: 'number', minimum: 0, maximum: 1 },
        userTriggeredCallRatio: { type: 'number', minimum: 0, maximum: 1 }
      }
    },
    callsByPurpose: {
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 0 }
    },
    requestsByPurpose: {
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 0 }
    },
    estimatedTokensByPurpose: {
      type: 'object',
      additionalProperties: { type: 'integer', minimum: 0 }
    },
    validationRejectionCount: { type: 'integer', minimum: 0 },
    budgets: {
      type: 'object',
      required: ['maxCallsPerHomePerHour', 'maxCallsPerHomePerDay', 'callsThisHour', 'callsToday'],
      properties: {
        maxCallsPerHomePerHour: { type: 'integer', minimum: 0 },
        maxCallsPerHomePerDay: { type: 'integer', minimum: 0 },
        callsThisHour: { type: 'integer', minimum: 0 },
        callsToday: { type: 'integer', minimum: 0 }
      }
    }
  }
};

const memoryListResponseSchema = (itemSchema: JsonSchema): JsonSchema => ({
  type: 'object',
  required: ['runId', 'items'],
  properties: {
    runId: stringSchema,
    kind: stringSchema,
    items: {
      type: 'array',
      items: itemSchema
    }
  }
});

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
      '/api/memory/summary': {
        get: {
          summary: 'Get compact home memory context for external agents',
          parameters: [runIdParameter()],
          responses: okResponse({ $ref: '#/components/schemas/MemorySummary' }, true)
        }
      },
      '/api/memory/entities': {
        get: {
          summary: 'Query room, device, or field memory entities',
          parameters: [
            runIdParameter(),
            {
              name: 'kind',
              in: 'query',
              required: true,
              schema: { type: 'string', enum: ['room', 'device', 'field'] }
            },
            optionalStringParameter('roomId'),
            optionalStringParameter('deviceId'),
            optionalStringParameter('field'),
            optionalBooleanParameter('meaningfulOnly')
          ],
          responses: okResponse(memoryListResponseSchema({ type: 'object', additionalProperties: true }), true)
        }
      },
      '/api/memory/episodes': {
        get: {
          summary: 'Query behavior episodes recorded in home memory',
          parameters: [
            runIdParameter(),
            {
              name: 'kind',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['occupancy', 'contact_activity', 'device_usage', 'appliance_usage'] }
            },
            {
              name: 'status',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['open', 'closed'] }
            },
            optionalStringParameter('roomId'),
            optionalStringParameter('deviceId'),
            optionalStringParameter('field'),
            limitParameter(200)
          ],
          responses: okResponse(memoryListResponseSchema({ type: 'object', additionalProperties: true }), true)
        }
      },
      '/api/memory/evidence': {
        get: {
          summary: 'Query recent memory evidence with deterministic filters',
          parameters: [
            runIdParameter(),
            {
              name: 'category',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['human_activity', 'device_usage', 'environment_context', 'system_status'] }
            },
            {
              name: 'strength',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['strong', 'medium', 'weak', 'ignored'] }
            },
            optionalStringParameter('roomId'),
            optionalStringParameter('deviceId'),
            optionalStringParameter('field'),
            optionalBooleanParameter('meaningfulOnly'),
            limitParameter(200)
          ],
          responses: okResponse(memoryListResponseSchema({ $ref: '#/components/schemas/MemoryEvidence' }), true)
        }
      },
      '/api/memory/profile/hypotheses': {
        get: {
          summary: 'Query profile hypotheses inferred from home memory',
          parameters: [
            runIdParameter(),
            {
              name: 'type',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['household_size', 'daily_rhythm', 'room_habit', 'device_routine', 'presence_signal', 'activity_cluster'] }
            },
            optionalBooleanParameter('includeEvidence')
          ],
          responses: okResponse(memoryListResponseSchema({ $ref: '#/components/schemas/MemoryHypothesis' }), true)
        }
      },
      '/api/memory/schema-mappings': {
        get: {
          summary: 'Return stable unknown device schema mapping candidates',
          parameters: [
            runIdParameter(),
            optionalBooleanParameter('includeLlmEnrichment'),
            {
              name: 'minEvidenceCount',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100 }
            },
            limitParameter(100)
          ],
          responses: okResponse({ $ref: '#/components/schemas/UnknownSchemaMappingResult' }, true)
        }
      },
      '/api/memory/semantic-candidates': {
        get: {
          summary: 'Return candidate semantic interpretations for stable evidence windows',
          parameters: [
            runIdParameter(),
            optionalBooleanParameter('includeLlmEnrichment'),
            {
              name: 'minEvidenceCount',
              in: 'query',
              required: false,
              schema: { type: 'integer', minimum: 1, maximum: 100 }
            },
            limitParameter(100)
          ],
          responses: okResponse({ $ref: '#/components/schemas/SemanticCandidateResult' }, true)
        }
      },
      '/api/memory/reliability': {
        get: {
          summary: 'Get memory reliability metrics and graph invariants',
          parameters: [runIdParameter()],
          responses: okResponse({ $ref: '#/components/schemas/MemoryReliabilityReport' }, true)
        }
      },
      '/api/memory/portrait': {
        get: {
          summary: 'Get layered household portrait inferred from home memory',
          parameters: [
            runIdParameter(),
            optionalBooleanParameter('includeLlmEnrichment'),
            {
              name: 'summaryPeriod',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['daily', 'weekly'] }
            }
          ],
          responses: okResponse({ $ref: '#/components/schemas/HouseholdPortrait' }, true)
        }
      },
      '/api/memory/query-plan': {
        get: {
          summary: 'Plan and execute an evidence-locked natural-language memory query',
          parameters: [
            runIdParameter(),
            {
              name: 'question',
              in: 'query',
              required: true,
              schema: { type: 'string', minLength: 1, maxLength: 500 }
            }
          ],
          responses: okResponse({ $ref: '#/components/schemas/MemoryQueryPlan' }, true)
        }
      },
      '/api/memory/llm/batch-plan': {
        get: {
          summary: 'Plan eligible Home Memory LLM batch work without calling the provider',
          parameters: [
            runIdParameter(),
            optionalBooleanParameter('includePortraitSummary'),
            {
              name: 'summaryPeriod',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['daily', 'weekly'] }
            },
            limitParameter(100)
          ],
          responses: okResponse({ $ref: '#/components/schemas/HomeMemoryLlmBatchPlan' }, true)
        }
      },
      '/api/memory/llm/batch': {
        post: {
          summary: 'Execute eligible Home Memory LLM batch work with item-level validation',
          requestBody: {
            required: false,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    runId: stringSchema,
                    includePortraitSummary: { type: 'boolean' },
                    summaryPeriod: { type: 'string', enum: ['daily', 'weekly'] },
                    limit: { type: 'integer', minimum: 1, maximum: 100 }
                  }
                }
              }
            }
          },
          responses: okResponse({ $ref: '#/components/schemas/HomeMemoryLlmBatchExecution' }, true)
        }
      },
      '/api/memory/llm/config': {
        get: {
          summary: 'Get masked Home Memory LLM runtime provider configuration',
          responses: okResponse({ $ref: '#/components/schemas/HomeMemoryLlmConfig' }, true)
        },
        put: {
          summary: 'Update Home Memory LLM runtime provider configuration',
          requestBody: {
            required: true,
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  properties: {
                    provider: {
                      type: 'object',
                      properties: {
                        enabled: { type: 'boolean' },
                        baseUrl: stringSchema,
                        model: stringSchema,
                        apiKey: stringSchema,
                        clearApiKey: { type: 'boolean' },
                        timeoutMs: { type: 'integer', minimum: 1000, maximum: 120000 },
                        maxRetries: { type: 'integer', minimum: 0, maximum: 5 }
                      }
                    },
                    budget: {
                      type: 'object',
                      properties: {
                        maxCallsPerHomePerHour: { type: 'integer', minimum: 1, maximum: 1000 },
                        maxCallsPerHomePerDay: { type: 'integer', minimum: 1, maximum: 10000 },
                        maxBatchSize: { type: 'integer', minimum: 1, maximum: 100 }
                      }
                    },
                    gates: {
                      type: 'object',
                      properties: {
                        minEvidenceCountForUnknownSchema: { type: 'integer', minimum: 1, maximum: 100 },
                        minConfidenceForReview: { type: 'number', minimum: 0, maximum: 1 },
                        maxConfidenceForReview: { type: 'number', minimum: 0, maximum: 1 }
                      }
                    }
                  }
                }
              }
            }
          },
          responses: okResponse({ $ref: '#/components/schemas/HomeMemoryLlmConfig' }, true)
        }
      },
      '/api/memory/llm/stream': {
        get: {
          summary: 'Stream a user-triggered Home Memory LLM enrichment attempt',
          parameters: [
            runIdParameter(),
            {
              name: 'purpose',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['hypothesis_explanation', 'reliability_review'] }
            },
            {
              name: 'type',
              in: 'query',
              required: false,
              schema: { type: 'string', enum: ['household_size', 'daily_rhythm', 'room_habit', 'device_routine', 'presence_signal', 'activity_cluster', 'routine_window', 'behavior_flow', 'resident_slot', 'room_function', 'device_contribution', 'state_anomaly'] }
            }
          ],
          responses: {
            '200': {
              description: 'Server-sent events for gatekeeper, provider deltas, validator, and final result',
              content: {
                'text/event-stream': {
                  schema: { type: 'string' }
                }
              }
            },
            '400': validationErrorResponse()
          }
        }
      },
      '/api/memory/llm/metrics': {
        get: {
          summary: 'Get Home Memory LLM cache, budget, fallback, and token metrics',
          responses: okResponse({ $ref: '#/components/schemas/MemoryLlmMetrics' }, true)
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
      },
      '/ws/device-events': {
        get: {
          summary: 'Open the device-only value event WebSocket stream',
          description: 'Clients receive device.update messages containing only flattened device telemetry/state values: device, room, field, value, time, and sequence. Household truth, control causes, activities, and explanations are not included.',
          parameters: [runIdParameter(), {
            name: 'afterSequence',
            in: 'query',
            required: false,
            schema: { type: 'integer', minimum: 0 }
          }],
          responses: {
            '101': {
              description: 'WebSocket protocol upgrade. Messages are DeviceSocketUpdateMessage or device heartbeat/run-change messages.'
            }
          }
        }
      }
    },
    components: {
      schemas: {
        TwinSnapshot: twinSnapshotSchema,
        TwinEvent: twinEventSchema,
        EventLineage: eventLineageSchema,
        EventExplanation: eventExplanationSchema,
        DeviceTelemetryEvent: deviceTelemetryEventSchema,
        DeviceStateChangedEvent: deviceStateChangedEventSchema,
        PersonMovedEvent: personMovedEventSchema,
        ActivityStartedEvent: activityStartedEventSchema,
        ActivityEndedEvent: activityEndedEventSchema,
        ConversationOccurredEvent: conversationOccurredEventSchema,
        AbnormalityInjectedEvent: abnormalityInjectedEventSchema,
        AlertCreatedEvent: alertCreatedEventSchema,
        AlertStatusChangedEvent: alertStatusChangedEventSchema,
        AutomationTriggeredEvent: automationTriggeredEventSchema,
        RuleRecoveredEvent: ruleRecoveredEventSchema,
        ScenarioControlEvent: scenarioControlEventSchema,
        ObjectMovedEvent: objectMovedEventSchema,
        ExternalInteractionOccurredEvent: externalInteractionOccurredEventSchema,
        HomeDefinition: homeDefinitionSchema,
        DeviceAccessRecord: deviceAccessRecordSchema,
        DeviceCapability: deviceCapabilitySchema,
        TelemetrySummary: telemetrySummarySchema,
        MemoryEvidence: memoryEvidenceSchema,
        MemoryHypothesis: memoryHypothesisSchema,
        MemorySummary: memorySummarySchema,
        HouseholdPortrait: householdPortraitSchema,
        MemoryQueryPlan: memoryQueryPlanSchema,
        UnknownSchemaMappingResult: unknownSchemaMappingResultSchema,
        SemanticCandidateResult: semanticCandidateResultSchema,
        MemoryReliabilityReport: memoryReliabilityReportSchema,
        HomeMemoryLlmBatchPlan: homeMemoryLlmBatchPlanSchema,
        HomeMemoryLlmBatchExecution: homeMemoryLlmBatchExecutionSchema,
        HomeMemoryLlmConfig: homeMemoryLlmConfigSchema,
        MemoryLlmMetrics: memoryLlmMetricsSchema,
        AccessAuditRecord: accessAuditRecordSchema,
        UpdateResponse: updateResponseSchema,
        TwinSocketUpdateMessage: twinSocketUpdateMessageSchema,
        TwinSocketHeartbeatMessage: twinSocketHeartbeatMessageSchema,
        DeviceValueEvent: deviceValueEventSchema,
        DeviceSocketUpdateMessage: deviceSocketUpdateMessageSchema,
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

function limitParameter(maximum = 500): Record<string, unknown> {
  return {
    name: 'limit',
    in: 'query',
    required: false,
    schema: { type: 'integer', minimum: 1, maximum: maximum, default: 100 }
  };
}

function optionalStringParameter(name: string): Record<string, unknown> {
  return {
    name,
    in: 'query',
    required: false,
    schema: stringSchema
  };
}

function optionalBooleanParameter(name: string): Record<string, unknown> {
  return {
    name,
    in: 'query',
    required: false,
    schema: { type: 'boolean' }
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
