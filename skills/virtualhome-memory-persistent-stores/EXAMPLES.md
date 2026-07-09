# VirtualHome Memory Persistent Stores Examples

Set a base URL for the main server:

```bash
BASE_URL="http://127.0.0.1:4317"
```

## Query Device Events

Structured query by run, room, device, field, sequence, time, and FTS:

```bash
curl -s "$BASE_URL/api/device-events?homeId=default_home&runId=RUN_ID&roomId=kitchen&deviceType=coffee_maker&q=coffee%20850&limit=20"
```

Resolve a Home Memory evidence `sourceEventId`:

```bash
curl -s "$BASE_URL/api/device-events/source/SOURCE_EVENT_ID?homeId=default_home&runId=RUN_ID"
```

Get nearby raw events around that source:

```bash
curl -s "$BASE_URL/api/device-events/around-source?sourceEventId=SOURCE_EVENT_ID&windowMinutes=30"
```

Aggregate raw observations:

```bash
curl -s "$BASE_URL/api/device-events/aggregate?homeId=default_home&runId=RUN_ID&groupBy=deviceType"
```

Get a query audit record:

```bash
curl -s "$BASE_URL/api/device-event-queries/QUERY_ID"
```

## Write Agent Profile With Device Event Evidence

Use `device_event_query` only after the query audit exists:

```bash
curl -s -X POST "$BASE_URL/api/agent-profile/entries" \
  -H "Content-Type: application/json" \
  -d '{
    "homeId": "default_home",
    "subjectType": "household",
    "subjectId": "household",
    "entryType": "conclusion",
    "title": "Weekday breakfast routine",
    "summary": "The household usually shows kitchen breakfast activity around 08:00 on weekdays.",
    "content": {
      "claim": "The household usually shows kitchen breakfast activity around 08:00 on weekdays.",
      "reasoning": "Kitchen motion, appliance power, and related raw events co-occurred in the queried windows."
    },
    "index": {
      "claimType": "routine",
      "predicate": "weekday_breakfast_window",
      "objectType": "activity",
      "objectId": "breakfast"
    },
    "timeWindows": [{
      "dayType": "weekday",
      "daysOfWeek": [1, 2, 3, 4, 5],
      "timeStart": "07:30",
      "timeEnd": "08:30",
      "timezone": "Asia/Singapore",
      "recurrence": "weekly"
    }],
    "sources": [{
      "sourceType": "device_event_query",
      "sourceId": "QUERY_ID",
      "homeId": "default_home",
      "runId": "RUN_ID",
      "quoteOrObservation": "Queried weekday kitchen events between 07:30 and 08:30.",
      "weight": 0.8
    }],
    "confidence": 0.72,
    "stability": "working",
    "createdBy": "agent"
  }'
```

## Query Agent Profile

Structured plus FTS query:

```bash
curl -s -X POST "$BASE_URL/api/agent-profile/query" \
  -H "Content-Type: application/json" \
  -d '{
    "homeId": "default_home",
    "structured": {
      "claimTypes": ["routine"],
      "predicates": ["weekday_breakfast_window"],
      "dayType": "weekday",
      "time": "08:05",
      "statuses": ["candidate", "active"]
    },
    "text": "breakfast kitchen",
    "includeSources": true
  }'
```

FTS search:

```bash
curl -s "$BASE_URL/api/agent-profile/search?homeId=default_home&q=breakfast%20kitchen&includeSources=true"
```

## DB Viewer

Start viewer:

```bash
npm run db:viewer -- \
  --device-events-db data/device-events.db \
  --home-memory-db data/home-memory.db \
  --agent-profile-db data/agent-profile.db \
  --port 4329
```

Useful viewer APIs:

```bash
curl -s "http://127.0.0.1:4329/api/db-viewer/health"
curl -s "http://127.0.0.1:4329/api/db-viewer/device-events?homeId=default_home&limit=5"
curl -s "http://127.0.0.1:4329/api/db-viewer/device-event-queries"
curl -s "http://127.0.0.1:4329/api/db-viewer/home-memory/runs"
curl -s "http://127.0.0.1:4329/api/db-viewer/agent-profile/entries"
```

## Troubleshooting

- If rebuild fails, fix the dataset first. The command validates before clearing generated DBs.
- If Agent Profile write returns source validation errors, verify the cited Home Memory source or `device_event_query` exists.
- If a routine conclusion is rejected, include a structured `index` and at least one `timeWindows` entry.
- If DB Viewer startup fails with `EADDRINUSE`, rerun with another `--port`.
- DB Viewer is read-only. Use Agent Profile API for profile writes.
