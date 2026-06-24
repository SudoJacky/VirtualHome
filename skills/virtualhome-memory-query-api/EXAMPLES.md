# VirtualHome Memory Query API Curl Examples

## Summary

```bash
BASE_URL="http://127.0.0.1:5173"
curl -s "$BASE_URL/api/memory/summary"
```

## Entities

Query rooms:

```bash
curl -s "$BASE_URL/api/memory/entities?kind=room"
```

Query devices in a room:

```bash
curl -s "$BASE_URL/api/memory/entities?kind=device&roomId=kitchen"
```

Query fields for a device:

```bash
curl -s "$BASE_URL/api/memory/entities?kind=field&deviceId=fridge_01"
```

Query only behavior-relevant fields:

```bash
curl -s "$BASE_URL/api/memory/entities?kind=field&meaningfulOnly=true"
```

## Episodes

Query recent episodes:

```bash
curl -s "$BASE_URL/api/memory/episodes?limit=20"
```

Query closed kitchen episodes:

```bash
curl -s "$BASE_URL/api/memory/episodes?roomId=kitchen&status=closed&limit=10"
```

Query appliance usage:

```bash
curl -s "$BASE_URL/api/memory/episodes?kind=appliance_usage"
```

## Evidence

Query recent meaningful evidence:

```bash
curl -s "$BASE_URL/api/memory/evidence?meaningfulOnly=true&limit=20"
```

Query kitchen evidence:

```bash
curl -s "$BASE_URL/api/memory/evidence?roomId=kitchen&meaningfulOnly=true&limit=10"
```

Query strong human activity signals:

```bash
curl -s "$BASE_URL/api/memory/evidence?category=human_activity&strength=strong"
```

## Profile Hypotheses

Query inferred household/profile hypotheses:

```bash
curl -s "$BASE_URL/api/memory/profile/hypotheses"
```

Query presence signal with evidence:

```bash
curl -s "$BASE_URL/api/memory/profile/hypotheses?type=presence_signal&includeEvidence=true"
```
