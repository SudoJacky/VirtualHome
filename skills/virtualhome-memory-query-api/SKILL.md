---
name: virtualhome-memory-query-api
description: Query VirtualHome home memory APIs with curl for external-agent context, evidence, episodes, entities, and profile hypotheses. Use when an agent needs to inspect VirtualHome memory, build household context, verify evidence, or decide what to do from device-observed memory.
---

# VirtualHome Memory Query API

Use this skill to query VirtualHome's deterministic home memory API from an external agent. The API reconstructs memory from persisted run events using device-observed data, not private truth labels.

## Quick Start

Set the server base URL:

```bash
BASE_URL="http://127.0.0.1:5173"
```

Get compact agent context first:

```bash
curl -s "$BASE_URL/api/memory/summary"
```

See [EXAMPLES.md](EXAMPLES.md) for endpoint-specific curl commands.

## Endpoints

`GET /api/memory/summary`

Returns compact context: `homeId`, `runId`, event counts, active rooms/devices, active episodes, top inferred patterns, recent evidence highlights, and `updatedAt`.

`GET /api/memory/entities`

Queries current room, device, or field memory. Supported filters: `runId`, `kind=room|device|field`, `roomId`, `deviceId`, `field`, `meaningfulOnly=true|false`.

`GET /api/memory/episodes`

Queries behavior episodes. Supported filters: `runId`, `kind=occupancy|contact_activity|device_usage|appliance_usage`, `status=open|closed`, `roomId`, `deviceId`, `field`, `limit=1..200`.

`GET /api/memory/evidence`

Queries recent memory evidence. Supported filters: `runId`, `category=human_activity|device_usage|environment_context|system_status`, `strength=strong|medium|weak|ignored`, `roomId`, `deviceId`, `field`, `meaningfulOnly=true|false`, `limit=1..200`.

`GET /api/memory/profile/hypotheses`

Queries inferred household/profile hypotheses. Supported filters: `runId`, `type=household_size|daily_rhythm|room_habit|device_routine|presence_signal|activity_cluster`, `includeEvidence=true|false`.

## Agent Workflow

1. Call `/api/memory/summary` to build compact context.
2. If action depends on a location or device, call `/api/memory/entities` with `roomId` or `deviceId`.
3. If action depends on recent activity, call `/api/memory/evidence?meaningfulOnly=true`.
4. If action depends on habits or inferred profile, call `/api/memory/profile/hypotheses?includeEvidence=true`.
5. Prefer evidence-backed decisions. Quote `evidenceReason`, `simTime`, `roomId`, `deviceId`, `field`, and `value` when explaining an action.

## Notes

- Boolean query parameters must be lowercase strings: `true` or `false`.
- If `runId` is omitted, the API uses the current simulator run.
- `field` can be a raw field name like `doorOpen` or a field id like `fridge_01:doorOpen`.
- The API records memory reads as `ml-observation` access audit entries.
