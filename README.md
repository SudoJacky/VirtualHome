# VirtualHome Twin Demo

Standalone virtual home digital twin demo based on `MVP.md`.

## Run

Install dependencies:

```bash
npm install
```

Start the API server:

```bash
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

- TypeScript simulation core for one virtual family home.
- Nine rooms, four human family members, one pet, and 20 virtual devices.
- Three scenarios: normal weekday, away day, and night water leak.
- Internal twin events for people movement, device state, telemetry, rules, alerts, and scenario control.
- SQLite-backed event, telemetry, and state snapshot persistence.
- Fastify REST API and WebSocket updates.
- React demo console with floorplan, device state, alerts, timeline, scenario controls, manual advance, pause/resume, and abnormality injection.

## Verification

```bash
npm test
npm run typecheck
npm run build
```
