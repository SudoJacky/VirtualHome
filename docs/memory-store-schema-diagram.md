# Memory Store Schema Diagram

This document contains deterministic Mermaid diagrams for the three persistent memory stores:

- `data/device-events.db`
- `data/home-memory.db`
- `data/agent-profile.db`

Generated overview image:

![Memory store schema and relations](assets/memory-store-schema-and-relations.png)

## Database Boundary

```mermaid
flowchart LR
  dataset["data/home-memory-days.json"]

  subgraph device["Device Event Store\n设备事件库"]
    imports["device_event_imports"]
    events["device_value_events"]
    eventFts["device_event_fts"]
    eventQueries["device_event_queries"]
  end

  subgraph home["Home Memory Store\n家庭记忆库"]
    runs["home_memory_runs"]
    evidence["home_memory_evidence"]
    entities["fields / devices / rooms"]
    episodes["episodes / summaries / semantic_signals"]
    hypotheses["home_memory_profile_hypotheses"]
    portraits["home_memory_portrait_sections"]
  end

  subgraph profile["Agent Profile Store\nAgent 画像库"]
    entries["agent_profile_entries"]
    sources["agent_profile_sources"]
    claimIndex["agent_profile_claim_index"]
    timeWindows["agent_profile_time_windows"]
    profileFts["agent_profile_fts"]
    profileEvents["agent_profile_entry_events"]
  end

  dataset -->|"memory:rebuild imports raw observations"| imports
  imports --> events
  events --> eventFts
  events -->|"reduceDeviceEvents + materialize"| runs
  runs --> evidence
  runs --> entities
  runs --> episodes
  runs --> hypotheses
  runs --> portraits

  evidence -. "sourceEventId" .-> events
  sources -. "sourceType = home_memory_*" .-> evidence
  sources -. "sourceType = home_memory_hypothesis" .-> hypotheses
  sources -. "sourceType = home_memory_portrait_section" .-> portraits
  sources -. "sourceType = device_event_query" .-> eventQueries

  entries --> sources
  entries --> claimIndex
  entries --> timeWindows
  entries --> profileFts
  entries --> profileEvents
```

## Device Event Store

```mermaid
erDiagram
  device_event_imports ||--o{ device_value_events : import_id
  device_value_events ||--|| device_event_fts : event_id

  device_event_imports {
    TEXT id PK
    TEXT input_path
    TEXT input_sha256
    TEXT home_id
    TEXT run_id
    INTEGER event_count
    TEXT imported_at
    INTEGER schema_version
  }

  device_value_events {
    TEXT id PK
    TEXT import_id FK
    TEXT source_event_id
    TEXT source_event_type
    TEXT run_id
    INTEGER sequence
    TEXT ts
    TEXT sim_time
    TEXT home_id
    TEXT room_id
    TEXT device_id
    TEXT device_type
    TEXT field
    TEXT value_json
    TEXT search_text
    TEXT payload_json
  }

  device_event_fts {
    TEXT event_id
    TEXT home_id
    TEXT run_id
    TEXT search_text
  }

  device_event_queries {
    TEXT id PK
    TEXT home_id
    TEXT run_id
    TEXT query_json
    INTEGER result_count
    TEXT summary
    TEXT created_by
    TEXT created_at
  }
```

## Home Memory Store

```mermaid
erDiagram
  home_memory_runs ||--o{ home_memory_evidence : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_fields : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_devices : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_rooms : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_episodes : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_activity_episodes : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_daily_summaries : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_weekly_summaries : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_semantic_signals : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_profile_hypotheses : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_portrait_sections : "home_id, run_id"
  home_memory_runs ||--o{ home_memory_materializations : "home_id, run_id"

  home_memory_runs {
    TEXT home_id PK
    TEXT run_id PK
    INTEGER covered_sequence
    TEXT reducer_version
    INTEGER schema_version
    TEXT materialized_at
    TEXT payload_json
  }

  home_memory_evidence {
    TEXT id PK
    TEXT home_id
    TEXT run_id
    INTEGER sequence
    TEXT sim_time
    TEXT room_id
    TEXT device_id
    TEXT field
    TEXT evidence_category
    REAL profile_weight
    TEXT payload_json
  }

  home_memory_fields {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT room_id
    TEXT device_id
    TEXT field
    TEXT payload_json
  }

  home_memory_devices {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT room_id
    TEXT payload_json
  }

  home_memory_rooms {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT payload_json
  }

  home_memory_profile_hypotheses {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT type
    TEXT summary
    REAL confidence
    TEXT updated_at
    TEXT evidence_ids_json
    TEXT payload_json
  }

  home_memory_portrait_sections {
    TEXT id PK
    TEXT home_id
    TEXT run_id
    TEXT section_id
    TEXT summary
    REAL confidence
    TEXT evidence_ids_json
    TEXT payload_json
  }

  home_memory_episodes {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT kind
    TEXT status
    TEXT updated_sim_time
    TEXT payload_json
  }

  home_memory_activity_episodes {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT kind
    TEXT updated_sim_time
    TEXT payload_json
  }

  home_memory_daily_summaries {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT payload_json
  }

  home_memory_weekly_summaries {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT payload_json
  }

  home_memory_semantic_signals {
    TEXT id PK
    TEXT home_id PK
    TEXT run_id PK
    TEXT type
    TEXT updated_at
    TEXT payload_json
  }

  home_memory_materializations {
    INTEGER id PK
    TEXT home_id
    TEXT run_id
    INTEGER covered_sequence
    TEXT reducer_version
    INTEGER schema_version
    TEXT materialized_at
  }
```

## Agent Profile Store

```mermaid
erDiagram
  agent_profile_entries ||--o{ agent_profile_sources : entry_id
  agent_profile_entries ||--o| agent_profile_claim_index : entry_id
  agent_profile_entries ||--o{ agent_profile_time_windows : entry_id
  agent_profile_entries ||--|| agent_profile_fts : entry_id
  agent_profile_entries ||--o{ agent_profile_entry_events : entry_id

  agent_profile_entries {
    TEXT id PK
    TEXT home_id
    TEXT subject_type
    TEXT subject_id
    TEXT entry_type
    TEXT title
    TEXT summary
    TEXT content_json
    TEXT status
    REAL confidence
    TEXT stability
    TEXT created_by
    TEXT created_at
    TEXT updated_at
    TEXT supersedes_entry_id
    INTEGER schema_version
  }

  agent_profile_sources {
    TEXT id PK
    TEXT entry_id FK
    TEXT source_type
    TEXT source_id
    TEXT home_id
    TEXT run_id
    INTEGER sequence
    TEXT quote_or_observation
    REAL weight
    TEXT created_at
  }

  agent_profile_claim_index {
    TEXT entry_id PK
    TEXT home_id
    TEXT claim_type
    TEXT predicate
    TEXT object_type
    TEXT object_id
    TEXT object_value_json
    TEXT status
    REAL confidence
    TEXT stability
    TEXT updated_at
  }

  agent_profile_time_windows {
    TEXT id PK
    TEXT entry_id FK
    TEXT home_id
    TEXT day_type
    TEXT days_of_week_json
    TEXT time_start
    TEXT time_end
    TEXT timezone
    TEXT recurrence
    TEXT valid_from
    TEXT valid_to
  }

  agent_profile_fts {
    TEXT entry_id
    TEXT home_id
    TEXT title
    TEXT summary
    TEXT content_text
    TEXT source_text
  }

  agent_profile_entry_events {
    TEXT id PK
    TEXT entry_id FK
    TEXT event_type
    TEXT actor
    TEXT before_json
    TEXT after_json
    TEXT reason
    TEXT created_at
  }
```

## Cross-Store References

```mermaid
flowchart TD
  dve["device_value_events\nsource_event_id"]
  hme["home_memory_evidence\npayload.sourceEventId"]
  hmh["home_memory_profile_hypotheses\nid"]
  hmp["home_memory_portrait_sections\nid"]
  deq["device_event_queries\nid"]
  aps["agent_profile_sources\nsource_type + source_id"]

  hme -. "sourceEventId resolves raw event window" .-> dve
  aps -. "home_memory_evidence" .-> hme
  aps -. "home_memory_hypothesis" .-> hmh
  aps -. "home_memory_portrait_section" .-> hmp
  aps -. "device_event_query" .-> deq
```
