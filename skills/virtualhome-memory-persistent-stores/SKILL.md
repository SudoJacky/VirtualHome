---
name: virtualhome-memory-persistent-stores
description: Operate VirtualHome's persistent Device Event DB, Home Memory DB, Agent Profile DB, rebuild pipeline, query APIs, and read-only DB Viewer. Use when an agent needs to rebuild stores from data/home-memory-days.json, inspect raw device events, cite device_event_query evidence, write Agent Profile conclusions, or browse the SQLite stores.
---

# VirtualHome Memory Persistent Stores

Persistent memory flow:

```text
data/home-memory-days.json
  -> data/device-events.db
  -> data/home-memory.db
  -> agent writes data/agent-profile.db through CRUD APIs
```

Ownership rule: rebuild owns Device Event DB and Home Memory DB. The agent owns Agent Profile DB. Rebuild only ensures Agent Profile schema.

## Commands

Rebuild generated stores:

```bash
npm run memory:rebuild
```

Open the read-only viewer:

```bash
npm run db:viewer -- \
  --device-events-db data/device-events.db \
  --home-memory-db data/home-memory.db \
  --agent-profile-db data/agent-profile.db \
  --port 4329
```

Use another `--port` if 4329 is occupied. Use explicit `--input`, `--device-events-db`, `--home-memory-db`, and `--agent-profile-db` paths when working outside defaults.

## Rebuild Contract

1. Validate input JSON before clearing any DB.
2. Clear and rewrite Device Event DB.
3. Recompute and rewrite Home Memory DB from Device Event DB rows.
4. Ensure Agent Profile DB schema only.
5. Do not generate, update, archive, or delete Agent Profile entries.
6. Fail loudly on invalid input, duplicate event ids, DB write failure, or Home Memory materialization failure.

## Server

The main server defaults to `data/device-events.db`, `data/home-memory.db`, and `data/agent-profile.db`. Override paths with `VIRTUALHOME_DEVICE_EVENTS_DATABASE_PATH`, `VIRTUALHOME_HOME_MEMORY_DATABASE_PATH`, and `VIRTUALHOME_AGENT_PROFILE_DATABASE_PATH`.

## Agent Reasoning Workflow

1. Query Agent Profile first for existing conclusions.
2. Query Home Memory for hypotheses, portrait sections, and evidence.
3. Follow `sourceEventId` from Home Memory evidence into Device Event DB when raw detail is needed.
4. Query raw event windows or aggregates.
5. Record a Device Event query audit when using raw events as evidence.
6. Write or update Agent Profile entries with explicit sources.

Strong Agent Profile sources are `home_memory_evidence`, `home_memory_hypothesis`, `home_memory_portrait_section`, `device_event_query`, and `manual_review`. For `device_event_query`, `sourceId` must be an existing `device_event_queries.id`.

## APIs

- Device events: `/api/device-events`, `/api/device-events/source/:sourceEventId`, `/api/device-events/around-source`, `/api/device-events/aggregate`, `/api/device-event-queries/:id`.
- Agent Profile: `/api/agent-profile/entries`, `/api/agent-profile/entries/:id/sources`, `/api/agent-profile/entries/:id/status`, `/api/agent-profile/query`, `/api/agent-profile/search`.
- DB Viewer: `/api/db-viewer/health`, `/api/db-viewer/device-events`, `/api/db-viewer/device-event-queries`, `/api/db-viewer/home-memory/runs`, `/api/db-viewer/agent-profile/entries`.

## Constraints

- Validate input before destructive rebuilds.
- Do not write Agent Profile entries from pipeline code.
- Cite provenance for executable profile conclusions.
- Use `device_event_query` to cite raw-event query audits rather than long raw event lists.
- Keep DB Viewer read-only.

See [EXAMPLES.md](EXAMPLES.md) for curl commands, payloads, viewer APIs, and troubleshooting.
