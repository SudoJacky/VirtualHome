# VirtualHome Twin Demo

Standalone smart-home simulation and digital-twin demo.

## Run

Install dependencies:

```bash
npm install
```

Start the API server:

```bash
npm run server
```

To run the server with a different compatible home template in PowerShell:

```powershell
$env:VIRTUALHOME_HOME_DEFINITION = ".\my-home-definition.json"
npm run server
```

Start the web console in another terminal:

```bash
npm run dev
```

Open:

```text
http://127.0.0.1:5173
```

## What is implemented

- TypeScript simulation core for one default model-driven virtual family home.
- Nine rooms, four human family members, one pet, and 30 virtual devices loaded from `src/sim/defaultHomeDefinition.json`.
- Three static scenarios plus generated daily routines from date and seed.
- Internal twin events for people movement, device state, telemetry, rules, alerts, scenario control, and recovery.
- SQLite-backed append-only events, telemetry, idempotency records, and checkpointed state snapshots.
- Startup recovery from persisted snapshots with event replay.
- Fastify REST API, OpenAPI document at `/api/openapi.json`, and WebSocket event-delta updates with heartbeat/reconnect cursors.
- Adapter-facing device twin view at `/api/device-twins` with desired state, reported state, connectivity, freshness, and command acknowledgement metadata.
- Telemetry summary endpoint at `/api/telemetry/summary` for aggregated metrics over recent event windows.
- Server-side privacy projection for public state/events.
- React demo console with floorplan, device state, alerts, timeline, scenario controls, daily routine generation, manual advance, pause/resume, abnormality injection, retryable commands, and recovery actions.

## Boundary

This repository is still a single-home simulation sandbox. It now exposes protocol and adapter seams that a real digital twin would need, but it does not yet connect to MQTT, Matter, Home Assistant, authentication, RBAC, or multiple persisted homes. The simulated home definition is externalized as a default template so future work can load other homes without rewriting the simulator.

## API Surface

- `GET /api/openapi.json` describes the REST and WebSocket protocol.
- `GET /api/state`, `/api/events`, and `/api/telemetry` expose current state and recent history.
- `GET /api/home-definition` exposes the default model-driven home template.
- `GET /api/device-twins` exposes adapter-facing device access records.
- `GET /api/device-capabilities` exposes the serializable device capability registry.
- `GET /api/telemetry/summary` returns aggregated telemetry metrics.
- `POST /api/daily/start`, `/api/scenarios/:id/start`, and `/api/control/*` mutate the simulation. Control requests accept `idempotencyKey` for safe retries.
- `GET /ws` streams `twin.update` event deltas and `twin.heartbeat` messages. Clients reconnect with `runId` and `afterSequence`.

## Verification

```bash
npm ci
npm test
npm run typecheck
npm run build
```
