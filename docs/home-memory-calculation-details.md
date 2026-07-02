# Home Memory 计算细节

本文记录 VirtualHome 中 Home Memory 抽取链路里的主要计算方式：每一步算什么、公式是什么、为什么这样算、参数来自哪里。本文以当前实现为准，主要对应这些文件：

- `src/web/homeMemoryModel.ts`
- `src/web/homeEvidenceClassifier.ts`
- `src/web/homeProfiler.ts`
- `src/web/homeHouseholdSizeEstimator.ts`
- `src/web/homeMemoryGraphModel.ts`
- `src/server/memoryQuery.ts`

## 0. 通用约定

### 0.1 输入边界

Home Memory 只消费 `DeviceValueEvent`。单条事件记为 `e`，核心字段是：

```text
e = {
  id, sourceEventId, sourceEventType,
  runId, sequence, ts, simTime,
  homeId, roomId, deviceId, deviceType,
  field, value
}
```

为什么只用这个输入：这样 memory 只能看到设备状态和遥测，不读取模拟内部的人员真值、场景原因或控制者身份。所有画像结论必须能回溯到设备证据。

### 0.2 标准工具函数

多个计算都会用下面几个约定：

| 名称 | 公式 | 为什么这样算 | 参数来源 |
| --- | --- | --- | --- |
| `normalize(s)` | 去掉 `_`、空格、`-` 后转小写 | 让 `door_open`、`door open`、`door-open` 能匹配同一规则 | 字段名、设备类型、字符串值 |
| `round3(x)` | `Number(x.toFixed(3))` | 避免浮点累积误差在 UI 和测试里产生噪声 | 权重、分数、分钟、坐标 |
| `clamp01(x)` | `min(1, max(0.01, round3(x)))` | 置信度不超过 1，也不显示为绝对 0 | profile hypothesis 置信度 |
| `unique(xs)` | 按 `Set` 去重，部分地方再排序 | 防止同一房间、设备、证据重复放大影响 | 聚合列表 |
| `appendBounded(list, item, limit)` | `[item, ...list].slice(0, limit)` | 保留最近证据，限制浏览器内存和 UI 噪声 | 根、房间、设备、字段 recentEvents |

当前保留上限：

| 列表 | 上限 | 原因 |
| --- | --- | --- |
| Home / Room / Device `recentEvents` | 50 | 画像和 UI 需要最近上下文，但不应无限增长 |
| Field `recentEvents` | 20 | 字段层是最低层事实，数量最多，保留更短窗口 |
| `semanticSignals` | 80 | semantic 是画像输入，需要比字段更长的近期窗口 |
| `activityEpisodes` | 50 | 与根 recentEvents 保持同一近期窗口尺度 |

这些参数是实现里的固定常量，不是从配置读取。

## 1. 单条事件进入 reducer

### 1.1 run 隔离

公式：

```text
baseMemory = memory.runId != null && memory.runId != e.runId
  ? createHomeMemory()
  : memory
```

为什么这样算：不同 run 的设备证据不能混在一份 memory 里，否则画像会把两次模拟运行误认为同一个家庭的连续行为。

参数来源：`memory.runId` 来自当前 memory；`e.runId` 来自设备值事件。

### 1.2 时间段归类

从 `simTime` 文本里读取小时 `h`：

```text
h = Number(/^YYYY-MM-DDT(HH):/.exec(simTime)?.[1])

if h invalid      => night
if 5 <= h <= 10   => morning
if 11 <= h <= 16  => daytime
if 17 <= h <= 21  => evening
else              => night
```

为什么这样算：画像只需要稳定的生活节律窗口，不需要分钟级精度。`night` 作为无效时间兜底可以避免坏时间戳中断 reducer。

参数来源：`simTime` 是模拟时间。

### 1.3 字段身份

公式：

```text
fieldId = `${deviceId}:${field}`
```

为什么这样算：同一个设备的不同字段要分别维护事实记忆，例如 `tv:power` 和 `tv:powerW` 是不同事实。

参数来源：事件里的 `deviceId` 和 `field`。

## 2. Capability 与 Evidence 分类

### 2.1 active 值判断

公式：

```text
active(value) =
  value                     if boolean
  value > 0                 if number
  normalize(value) in {
    on, open, unlocked, active, running, true,
    cooling, heating, heat, cool
  }                         if string-like
```

为什么这样算：不同设备用 boolean、数值或字符串表达“正在发生”。统一成 active 后，后续规则能用同一套逻辑判断行为信号。

参数来源：事件里的 `value`。

### 2.2 Capability 归一

先根据 `deviceType`、`field`、`value` 得到 capability：

| 条件 | capability | active 计算 | 为什么 |
| --- | --- | --- | --- |
| `field` 属于 `battery/batterylevel/firmware/health/lastseen/online/rssi/signal` | `system_health` | false | 系统健康是事实，不代表家庭行为 |
| `deviceType` 含 `lock` 或 `field == lock` | `access_control` | `active(value)` | 门锁/门禁是入户活动强信号 |
| `deviceType` 含 `motion/presence`，或 `field` 是 `motion/occupancy/occupied/presence`，或包含 `peoplecount/personcount/occupancycount` | `presence_detection` | `active(value)` | 表示有人或占用 |
| `deviceType` 含 `sleep`，或 `field` 是 `inbed/asleep/sleeping` | `sleep_context` | `active(value)` | 表示睡眠或在床上下文 |
| `deviceType` 含 `water`，或 `field` 含 `flow/valve` | `water_flow` | `active(value)` | 用水活动 |
| `deviceType` 是空调/恒温/HVAC/加热/制冷，或 `field == mode` 且值含冷/热 | `climate_control` | `active(value)` | 主动调节室内环境 |
| `field == temperature` | `environment_temperature` | true | 环境温度上下文 |
| `field == humidity` | `environment_humidity` | true | 环境湿度上下文 |
| `field` 是 `airquality/airqualityindex/co2/pm25/noise/illuminance/lightlevel` | `environment_air_quality` | true | 空气质量/光照/噪声上下文 |
| `field` 是 `power/state/powerw/wattage/current` | `power_usage` | `active(value)` | 设备使用或功耗 |
| 其它 | `generic_device_state` | `active(value)` | 保底设备状态 |

为什么先算 capability：它是设备字段到通用能力的中间层。下游 evidence、semantic、profile 不需要理解每个具体设备字段，只需要理解通用能力。

参数来源：固定规则来自 `homeEvidenceClassifier.ts`；字段集合是代码内常量。

### 2.3 Evidence 分类、强度和基础权重

分类公式是按优先级匹配，命中第一条就返回：

| 优先级 | 条件 | category | strength | baseWeight | 原因 |
| --- | --- | --- | --- | --- | --- |
| 1 | `capability == system_health` | `system_status` | `ignored` | 0 | 系统遥测只存事实，不参与画像 |
| 2 | `access_control && active && door unlock` | `human_activity` | `strong` | 1.00 | 门锁解锁是直接人类活动信号 |
| 3 | `climate_control && active` | `device_usage` | `medium` | 0.55 | 空调/暖通表示设备使用，但不一定是直接人类活动 |
| 4 | `power_usage && active && field in power/state && value on/true` | `device_usage` | `strong` | 0.90 | 电源打开是强设备使用证据 |
| 5 | `presence_detection && active` | `human_activity` | `medium` | 0.55 | 运动/占用是中等强度存在信号 |
| 6 | `field in contact/dooropen/open/windowopen && value open/true` | `device_usage` | `medium` | 0.45 | 门窗接触状态表示活动，但不一定等于身份 |
| 7 | `power_usage && active` | `device_usage` | `medium` | 0.50 | 正功率/电流说明设备正在工作 |
| 8 | 环境 capability 或 `deviceType` 含 `sensor` | `environment_context` | `weak` | 0.05 | 环境读数是背景上下文，避免强推行为 |
| 9 | 其它 | `device_usage` | `weak` | 0.20 | 未知设备状态保留为弱设备证据 |

为什么使用固定权重：这些权重表达“这类设备事件对家庭画像的最大贡献”。强人类活动最高，环境和系统最低，防止高频传感器主导画像。

参数来源：固定在 `classifyDeviceEvidence`。当前没有外部配置。

## 3. 有意义变化与最终证据权重

### 3.1 数值差值

公式：

```text
valueDelta =
  round3(abs(nextValue - previousValue))  if both are numbers
  undefined                              otherwise
```

为什么这样算：数值遥测需要知道变化幅度；非数值只判断是否相同。

### 3.2 meaningfulChange

公式：

```text
if field first seen:
  meaningfulChange = true
else if valueDelta is defined:
  if valueDelta == 0:
    meaningfulChange = false
  else if category == environment_context:
    meaningfulChange = valueDelta >= 0.5
  else:
    meaningfulChange = true
else:
  meaningfulChange = !Object.is(previousValue, nextValue)
```

为什么环境数值要 `0.5` 阈值：温湿度、空气质量、光照等读数会频繁小幅波动。阈值能减少噪声对画像权重的影响。非环境数值只要变化非零就保留，因为功耗、人数、开度等变化通常更直接。

参数来源：上一条字段值来自 `FieldMemory.currentValue`；分类来自 evidence classifier。`0.5` 是固定阈值。

### 3.3 最终 profileWeight

公式：

```text
profileWeight = meaningfulChange ? baseWeight : 0
```

为什么这样算：重复遥测仍会保存成事实，但不继续增加画像权重，避免同一个状态反复上报导致置信度虚高。

## 4. MemoryEvidence 生成

公式：

```text
MemoryEvidence = {
  ...event identity fields,
  timeBucket,
  evidenceCategory: classification.category,
  evidenceStrength: classification.strength,
  capability,
  meaningfulChange,
  valueDelta,
  profileWeight,
  evidenceReason
}
```

为什么这样算：`MemoryEvidence` 是所有后续 semantic、episode、hypothesis、graph 的可追溯底层证据。它不丢掉原始事件身份，也附带分类和权重。

参数来源：事件本身、时间段、分类结果、变化分析结果。

## 5. Field / Device / Room / Home 聚合

### 5.1 profile 计数

通用公式：

```text
profileEventCount += profileWeight > 0 ? 1 : 0
profileEvidenceWeight = round3(profileEvidenceWeight + profileWeight)
profileEvidenceByCategory[category] += profileWeight > 0 ? 1 : 0
```

为什么这样算：只有有画像贡献的证据才进入 profile 计数；权重保留强弱，category 计数用于判断证据结构。

### 5.2 FieldMemory

首条事件：

```text
eventCount = 1
changeCount = meaningfulChange ? 1 : 0
telemetryCount = meaningfulChange ? 0 : 1
currentValue = e.value
firstSeenAt = lastSeenAt = e.ts
lastMeaningfulChangeAt = meaningfulChange ? e.ts : undefined
recentEvents = [evidence]
```

后续事件：

```text
previousValue = current.currentValue
currentValue = e.value
eventCount += 1
changeCount += meaningfulChange ? 1 : 0
telemetryCount += meaningfulChange ? 0 : 1
lastSeenAt = e.ts
lastMeaningfulChangeAt = meaningfulChange ? e.ts : previous.lastMeaningfulChangeAt
recentEvents = appendBounded(recentEvents, evidence, 20)
```

数值统计：

```text
numericMin = min(previous.numericMin ?? value, value)
numericMax = max(previous.numericMax ?? value, value)
```

布尔统计：

```text
trueCount += value === true ? 1 : 0
falseCount += value === false ? 1 : 0
```

为什么这样算：字段层是事实账本。它同时保存最新值、变化次数、重复遥测次数、数值范围和布尔分布，为 semantic 和 household size 提供可解释输入。

### 5.3 DeviceMemory

公式：

```text
latestValues[field] = e.value
fields = unique(fields + fieldId)
eventCount += 1
timeBuckets[timeBucket] += 1
recentEvents = appendBounded(recentEvents, evidence, 50)
```

为什么这样算：设备层需要回答“这个设备最近有哪些字段、在哪些时间段活跃、贡献多少画像权重”。

### 5.4 RoomMemory

公式：

```text
devices = unique(devices + deviceId)
activeFields = unique(activeFields + fieldId)
eventCount += 1
timeBuckets[timeBucket] += 1
recentEvents = appendBounded(recentEvents, evidence, 50)
```

为什么这样算：房间层用于判断活动区域、房间习惯和房间功能。它按房间聚合所有设备字段。

### 5.5 HomeMemory 根对象

公式：

```text
totalEvents += 1
recentEvents = appendBounded(recentEvents, evidence, 50)
semanticSignals = appendManyBounded(semanticSignals, newSignals, 80)
semanticSignalCount += newSignals.length
semanticSignalCountsByType[type] += count(newSignals[type])
activityEpisodes = updateActivityEpisodes(...).slice(0, 50)
```

为什么这样算：根对象保存全屋最近证据和跨实体索引，是图谱、查询接口和画像入口。

## 6. Daily / Weekly Summary

### 6.1 日期

公式：

```text
date = /^YYYY-MM-DDT/.exec(e.simTime)?.[1] ?? e.ts.slice(0, 10)
```

为什么这样算：优先使用模拟日期；如果模拟时间格式异常，再退回真实时间。

### 6.2 ISO 周

公式使用 ISO week 近似：

```text
utcDate = date at UTC midnight
day = utcDate.getUTCDay() || 7
utcDate += 4 - day
week = ceil((((utcDate - yearStart) / 86400000) + 1) / 7)
weekId = `${utcYear}-W${pad2(week)}`
```

为什么这样算：周摘要需要跨天聚合，并和常见 ISO 周语义一致。

### 6.3 summary 累积

每日和每周都使用同类公式：

```text
eventCount += 1
profileEventCount += profileWeight > 0 ? 1 : 0
profileEvidenceWeight = round3(profileEvidenceWeight + profileWeight)
episodeCount += startedEpisode ? 1 : 0
activeRooms = unique(activeRooms + roomId).sort()
activeDevices = unique(activeDevices + deviceId).sort()
activeFields = unique(activeFields + fieldId).sort()
timeBuckets[timeBucket] += 1
lastSeenAt = e.ts
```

`meaningfulRooms` 的公式：

```text
meaningfulRooms += roomId
  if startedEpisode
  or (profileWeight > 0 and category in {human_activity, device_usage})
```

为什么这样算：长期画像不能只看最近 50 条事件。日/周摘要保留长窗口活动覆盖，尤其用于人数估计和日常节律。

## 7. 低层 Episode

### 7.1 事件到 episode 信号

公式：

| 条件 | kind | active | peakValue |
| --- | --- | --- | --- |
| motion / occupancy / occupied | `occupancy` | boolean 值 | 无 |
| contact / doorOpen / open / windowOpen | `contact_activity` | boolean，或字符串 `open/closed` | 无 |
| powerW / wattage / current 数值 | `appliance_usage` | `value > 0` | active 时为该数值 |
| power / state | `device_usage` | boolean，或字符串 `on/off` | 无 |

为什么这样算：低层 episode 把高频开关、占用、功率事件压缩成“一个持续片段”，减少画像噪声。

### 7.2 episode 开启、更新、关闭

`activeKey`：

```text
activeKey = `${fieldId}:${kind}`
```

active 为 true：

```text
if active episode exists:
  eventCount += 1
  evidenceIds += evidence.id
  latestValue = e.value
  peakValue = max(previous.peakValue, signal.peakValue)
  profileWeight = round3(previous.profileWeight + evidence.profileWeight)
else:
  create episode id = `episode:${fieldId}:${kind}:${sequence}`
  episodeCount += 1
  activeEpisodeIds[activeKey] = episode.id
```

active 为 false：

```text
if active episode exists:
  close episode
  status = closed
  endedAt = e.ts
  durationMinutes = round3(max(0, (endedAt - startedAt) / 60000))
  delete activeEpisodeIds[activeKey]
else:
  no-op
```

为什么这样算：只在状态从 inactive 到 active 时创建新片段；active 期间的后续事件合并；关闭时计算持续时长。

## 8. Semantic Signal

### 8.1 生成前提

公式：

```text
if !meaningfulChange:
  semanticSignals = []
```

为什么这样算：重复遥测不应生成新的生活语义。

### 8.2 语义规则与权重

一条 evidence 可以生成多个 semantic signal。核心规则：

| 条件 | signal | strength | weight | 说明 |
| --- | --- | --- | --- | --- |
| `category == system_status` | `system_signal` | `ignored` | 0 | 系统诊断，不参与画像；生成后直接返回 |
| access 信号 | `access_signal` | `strong` | `max(profileWeight, 0.8)` | 入户/门窗活动要足够强 |
| sleep capability active | `sleep_signal` | 原强度，若 ignored 则 medium | `max(profileWeight, 0.6)` | 睡眠上下文对人数和房间功能重要；生成后返回 |
| `category == environment_context` | `environment_signal` | `weak` | `profileWeight` | 环境上下文单独保留；生成后返回 |
| water active | `water_signal` | weak 提升到 medium | `max(profileWeight, 0.45)` | 用水对厨房/卫生间活动有解释力 |
| climate active | `climate_signal` | weak 提升到 medium | `max(profileWeight, 0.45)` | 主动环境调节 |
| cooking 规则命中 | `cooking_signal` | weak 提升到 medium | `max(profileWeight, 0.45)` | 厨房/烹饪上下文 |
| media 规则命中 | `media_signal` | weak 提升到 medium | `max(profileWeight, 0.45)` | 娱乐/共享客厅上下文 |
| work/study 规则命中 | `work_study_signal` | weak 提升到 medium | `max(profileWeight, 0.35)` | 工作/学习上下文较弱一些 |
| lighting active | `lighting_signal` | strong 降为 medium，否则保持 | `min(max(profileWeight, 0.2), 0.45)` | 照明是辅助信号，不让它过强 |
| `category == human_activity` 且没有 presence | `presence_signal` | evidence strength | `profileWeight` | 人类活动默认支持 presence |
| 没有其它 signal 且 `device_usage && active` | `presence_signal` | `weak` | `min(profileWeight, 0.25)` | 普通设备使用弱支持 presence |
| 有 access 但无 presence | `presence_signal` | `medium` | `min(max(profileWeight, 0.45), 0.7)` | 入户活动弱到中等支持最近 presence |

为什么这样算：semantic 是“设备事实像什么生活信号”的中间解释，不是最终结论。权重提升用于补足低层分类过弱但语义很明确的情况；权重上限用于防止辅助信号过度影响画像。

参数来源：语义规则固定在 `homeMemoryModel.ts`；输入来自 evidence、deviceType、field、value、roomId。

## 9. 高层 Activity Episode

### 9.1 return_home

公式：

```text
for behavior signal s where s.type not in {environment_signal, system_signal}:
  access = latest signal a where
    a.type == access_signal
    a.roomId != s.roomId
    a.simTime <= s.simTime
    absMinutes(a.simTime, s.simTime) <= 30

  if access exists:
    create return_home episode from [access, s]
```

为什么 30 分钟：回家后的第一段活动通常紧邻入户事件；30 分钟足够覆盖进门后去厨房、客厅、书房等路径，又不会把相隔太久的活动强行串联。

### 9.2 meal_preparation

公式：

```text
if s.type == cooking_signal:
  supporting = nearby signals where
    same room
    id != s.id
    type in {presence_signal, water_signal, lighting_signal, cooking_signal}
    absMinutes(candidate.simTime, s.simTime) <= 45

  create meal_preparation from supporting + s
```

为什么 45 分钟：备餐比回家流更长，厨房中的用水、照明、炉具和 presence 可以分散在一段时间里。

### 9.3 bedtime

公式：

```text
if s.type == sleep_signal:
  create bedtime from [s]
```

为什么这样算：睡眠传感器本身就是强上下文，不需要其它信号才能形成片段。

### 9.4 climate_response

公式：

```text
if s.type == climate_signal:
  env = latest signal where
    same room
    type == environment_signal
    env.simTime <= s.simTime
    absMinutes(env.simTime, s.simTime) <= 30

  if env exists:
    create climate_response from [env, s]
```

为什么这样算：把环境变化和随后主动空调/暖通控制连起来，但只在同房间、近时间窗口内成立。

### 9.5 activity episode 聚合

episode 生成公式：

```text
sortedSignals = sort by simTime then id
id = `activity:${kind}:${roomIds.join('+')}:${first.simTime}`
roomIds = unique by first seen
deviceIds = unique by first seen
evidenceIds = unique sourceEvidenceIds by first seen
profileWeight = round3(sum(signal.profileWeight))
started = first signal
updated = last signal
```

重复 ID 合并：

```text
if same id exists and kind != return_home:
  union roomIds/deviceIds/evidenceIds/semanticSignalIds by first seen
  updatedAt = max(updatedAt)
  updatedSimTime = max(updatedSimTime)
  profileWeight = round3(current.profileWeight + next.profileWeight)
```

为什么 `return_home` 不合并：同一个入户流路径可能重复出现，保留独立片段更容易解释。

## 10. Profile Hypothesis 通用置信度

### 10.1 样本量上限

公式：

```text
sampleSizeConfidenceCap(sampleSize) =
  0.45  if sampleSize <= 1
  0.55  if sampleSize <= 2
  0.65  if sampleSize <= 3
  0.80  if sampleSize <= 5
  1.00  otherwise
```

为什么这样算：小样本即使命中规则，也不能给高置信度。上限按阶梯增加，避免早期证据过度确定。

### 10.2 置信度裁剪

公式：

```text
confidenceWithSampleSize(value, sampleSize)
  = clamp01(min(value, sampleSizeConfidenceCap(sampleSize)))
```

### 10.3 比例型置信度

公式：

```text
confidenceFromCount(count, total, max, sampleSize = count) =
  if count <= 0 or total <= 0:
    0.1
  else:
    confidenceWithSampleSize(
      0.2 + min(max - 0.2, count / total),
      sampleSize
    )
```

为什么基础值是 0.2：只要有证据，给一个低基础置信度；再按占比提升。`max` 控制不同 hypothesis 类型的最高理论置信度。

## 11. 各类 Profile Hypothesis 计算

### 11.1 daily_rhythm

对每个在 recentEvents 出现过的 time bucket：

```text
evidence = recentEvents where event.timeBucket == bucket
evidenceWeight = sum(evidence.profileWeight)
matchingDayCount = count(dailySummary where timeBuckets[bucket] > 0)
observedDayCount = dailySummaries.length
observedWeekCount = weeklySummaries.length
multiWeekSignal = observedWeekCount > 1 ? observedWeekCount : 0

count = evidenceWeight + matchingDayCount + multiWeekSignal
total = memory.profileEvidenceWeight + observedDayCount + multiWeekSignal
sampleSize = max(evidenceWeight, matchingDayCount + multiWeekSignal)
confidence = confidenceFromCount(count, total, 0.9, sampleSize)
```

为什么这样算：近期证据、日级重复和跨周观察都能提高节律可信度；上限 0.9 表示日常节律仍是概率模式。

### 11.2 room_habit

```text
strongestBucket = argmax(room.timeBuckets[bucket]) with bucket order morning, daytime, evening, night
episodeCount = count(episodes where episode.roomId == room.roomId)
profileSignal = room.profileEvidenceWeight + episodeCount
totalSignal = memory.profileEvidenceWeight + memory.episodeCount
sampleSize = max(room.profileEvidenceWeight, episodeCount)
confidence = confidenceFromCount(profileSignal, totalSignal, 0.85, sampleSize)
```

为什么这样算：房间习惯由房间画像权重和行为片段共同支持；上限 0.85 防止单房间活动被解释得过度确定。

### 11.3 device_routine

生成条件：

```text
room.devices.length >= 2 && room.eventCount >= 3
```

置信度：

```text
confidence = confidenceFromCount(
  room.profileEvidenceWeight + room.devices.length,
  memory.totalEvents + room.devices.length,
  0.8,
  room.profileEvidenceWeight
)
```

为什么这样算：设备例程要求同一房间多设备且事件数足够，避免单设备误判为 routine。

### 11.4 activity_cluster

先按房间聚合非环境、非系统 semantic signals。不同 activity 的触发：

| 类型 | 条件 | baseConfidence |
| --- | --- | --- |
| meal | 有 `cooking_signal` 且有备餐支持 | 0.42 |
| hygiene | 有 `water_signal` 且房间像 bathroom/wash/toilet | 0.40 |
| media | 有 `media_signal` | 0.40 |
| work_study | 有 `work_study_signal` | 0.38 |
| sleep | 有 `sleep_signal` | 0.45 |
| entry_return | access 后 30 分钟内其它房间出现行为 semantic | 0.36 |

备餐支持：

```text
hasMealActivitySupport =
  distinctDevices >= 2
  or signalTypes has presence/water/lighting
  or deviceType contains stove/oven/microwave/coffee/kettle
```

置信度：

```text
weightedSignal = sum(signal.profileWeight)
distinctTypes = unique(signal.type).length
value = baseConfidence
      + min(0.30, weightedSignal / 6)
      + min(0.15, distinctTypes / 20)
sampleSize = signals.length + weightedSignal
confidence = confidenceWithSampleSize(value, sampleSize)
```

为什么这样算：activity cluster 同时看信号强度和信号类型多样性；不同语义有不同 baseConfidence，睡眠和备餐更直接，工作学习稍弱。

### 11.5 routine_window

分组 key：

```text
key = `${activity}:${roomId}:${timeBucket}`
activity =
  meal        for cooking_signal
  sleep       for sleep_signal
  work_study  for work_study_signal
  media       for media_signal
```

生成条件：

```text
signals.length >= 2 || distinctDates.length >= 2
```

置信度使用 typed signal 通用公式：

```text
value = baseConfidence
      + min(0.28, weightedSignal / 8)
      + min(0.12, signals.length / 20)
sampleSize = signals.length + weightedSignal
confidence = confidenceWithSampleSize(value, sampleSize)
```

其中 `baseConfidence = 0.36`。

为什么这样算：routine 要求重复信号或跨天出现；权重和次数都能提升置信度。

### 11.6 behavior_flow

生成条件：

```text
access_signal.roomId != nextSignal.roomId
nextSignal.simTime > accessSignal.simTime
minutesBetween(access, next) <= 30
nextSignal.type in {
  presence_signal, cooking_signal, media_signal,
  work_study_signal, water_signal
}
```

置信度：typed signal 通用公式，`baseConfidence = 0.40`。

为什么这样算：它表示“入口活动后进入某个房间活动”的概率流，不是身份确认。

### 11.7 room_function

按房间内 semantic 类型判断：

| function | 条件 | baseConfidence |
| --- | --- | --- |
| cooking room | 有 `cooking_signal` 且有备餐支持 | 0.34 |
| sleeping room | 有 `sleep_signal` | 0.34 |
| work or study room | 有 `work_study_signal` | 0.34 |
| shared living room | 有 `media_signal` | 0.34 |
| entry area | 有 `access_signal` | 0.34 |
| hygiene room | 有 `water_signal` 且房间像 bathroom/wash/toilet | 0.34 |

置信度：typed signal 通用公式。

为什么这样算：房间功能来自房间内语义组合，base 较低，因为房间功能需要长期观察才稳定。

### 11.8 resident_slot

生成规则：

| 条件 | slot | baseConfidence |
| --- | --- | --- |
| 房间有 `sleep_signal` 且 roomId 含 `child` | `child_sleep` | 0.42 |
| 房间有 `sleep_signal` 且不是 child | `main_sleep` | 0.42 |
| 房间有 `work_study_signal` | `remote_work` | 0.36 |

置信度：typed signal 通用公式。

为什么这样算：resident slot 是匿名生活槽位，不识别具体身份，只给 household size 和画像维度提供辅助证据。

### 11.9 device_contribution

按设备聚合非环境、非系统 semantic signal：

```text
score(device) = sum(signal.profileWeight for that device)
include if score >= 0.8 or signalCount >= 2
sort by score desc, then deviceId asc
take first 5
confidence = typed signal formula with baseConfidence = 0.36
```

为什么这样算：只展示最能解释画像的前 5 个设备，避免图谱和画像被低贡献设备淹没。

### 11.10 state_anomaly

候选环境异常：

```text
environmentSignal where
  type == environment_signal
  and (
    field == co2  and value >= 900
    or field == pm25 and value >= 35
  )
```

生成条件：

```text
no behavior signal in same room within 30 minutes
```

置信度：typed signal 通用公式，`baseConfidence = 0.24`。

为什么这样算：CO2 和 PM2.5 阈值用作弱异常候选；没有附近行为响应时才提示，且 base 较低，因为环境异常不能直接推断人员行为。

### 11.11 presence_signal

```text
presenceEvidence = recentEvents where category in {human_activity, device_usage}
episodes = all behavior episodes
meaningfulRoomCount = unique(presenceEvidence.roomId + episode.roomId).length
meaningfulWeight = sum(presenceEvidence.profileWeight)
behaviorSignal = meaningfulWeight + episodes.length

value =
  if behaviorSignal > 0:
    0.25 + min(0.45, behaviorSignal / 8) + min(0.15, meaningfulRoomCount / 20)
  else:
    0.20

sampleSize = max(meaningfulWeight, episodes.length)
confidence = confidenceWithSampleSize(value, sampleSize)
```

为什么这样算：presence 是最近活动可能性，不是确定有人在家。设备使用、人体活动和 episode 都能支持它；环境上下文不能单独强推 presence。

## 12. Household Size 概率估计

Household size 是最复杂的画像：输出不是确定人数，而是 1 到 5 人的概率分布、下界和置信度。

### 12.1 输入证据选择

`householdSizeEvidence` 选择：

```text
event included if:
  profileWeight > 0 and category in {human_activity, device_usage}
  or occupancy context event
```

occupancy context：

```text
sleep field true
or field == co2 and value >= 900
or field == pm25 and value >= 35
or field contains flow and numeric value > 0
```

为什么这样算：人数估计主要依赖人类活动和设备使用；睡眠、CO2、PM2.5、用水可以作为弱上下文补充。

### 12.2 meaningful room 和证据权重

房间有效权重：

```text
weakContextWeight = room.profileEvidenceByCategory.environment_context * 0.05
meaningfulWeightOfRoom = max(0, round3(room.profileEvidenceWeight - weakContextWeight))
```

为什么减去环境权重：环境读数虽然有权重，但不应把房间误认为有人活动。

长期房间：

```text
longWindowRooms = unique(dailySummaries.meaningfulRooms + weeklySummaries.meaningfulRooms)
episodeRooms = unique(episodes.roomId)
meaningfulRooms = rooms where
  meaningfulWeightOfRoom > 0
  or room in episodeRooms
  or room in longWindowRooms
```

### 12.3 并发活动下界

把事件按 10 分钟窗口分组：

```text
minute = hour * 60 + minute
windowStart = floor(minute / 10) * 10
windowKey = `${date}:${HH(windowStart)}:${MM(windowStart)}`
roomsInWindow = unique(roomId)
strongestWindow = window with max roomsInWindow.length, tie by earlier key

concurrentLowerBound = clampResidentCount(roomsInWindow.length)
```

为什么 10 分钟：同一 10 分钟内多房间强活动可以作为最低人数线索；窗口太短会漏掉设备上报延迟，太长会把连续单人活动误认为并发。

### 12.4 睡眠区域

```text
sleepRooms = unique(
  sleep field true event rooms
  + night bedroom occupancy episode rooms
  + fields where sleep field trueCount > 0
)
sleepZoneCount = sleepRooms.length
```

为什么这样算：稳定睡眠区域通常对应居住结构，比单次白天活动更能支持人数估计。

### 12.5 routine clusters

聚类规则：

| cluster | 条件 |
| --- | --- |
| `meal_activity` | kitchen 在 morning 或 evening 有 household size evidence |
| `study_or_work_activity` | study 在 daytime 或 evening 有 evidence；或 study 设备有 profile 权重 |
| `shared_evening_activity` | living_room/living 在 evening 有 evidence |
| `bathroom_hygiene_activity` | bathroom 有 flow、motion 或 motion 设备 |
| `entry_activity` | entrance/entry 有 evidence |
| `child_sleep_activity` | sleepRooms 中有 child |
| `main_sleep_activity` | sleepRooms 中有 master 或 bedroom |

为什么这样算：人数估计不是只看房间数，生活模式组合也能区分独居、伴侣、带孩子、居家办公等可能性。

### 12.6 resident slots

从 semantic signals 得到匿名槽位：

| 条件 | slot |
| --- | --- |
| `sleep_signal` in child room | `child_sleep_slot` |
| `sleep_signal` in other room | `main_sleep_slot` |
| `work_study_signal` | `remote_work_slot` |
| `media_signal` in evening | `shared_evening_slot` |
| `presence_signal` in daytime | `daytime_home_slot` |

### 12.7 shared sleep zone

主睡眠房间：

```text
mainSleepRooms = sleepRooms where normalize(roomId) contains
  masterbedroom or primarybedroom or mainbedroom
```

强共享证据：

```text
strong if any mainSleepRoom has:
  sleep devices count >= 2
  or shared occupancy field max >= 2
```

shared occupancy field 包含：

```text
occupancycount, personcount, peoplecount,
sleepercount, bedside, side
```

中等共享证据：

```text
medium if child_sleep_activity exists
  and at least 2 of {
    meal_activity,
    shared_evening_activity,
    entry_activity,
    study_or_work_activity
  } exist
```

否则有主睡眠房间就是 weak；没有则 none。

为什么这样算：主卧可能表示 1 或 2 个成人。只有多设备、人数数值等直接证据才能提高下界；家庭 routine 组合只能提高概率，不能硬提高下界。

### 12.8 resident lower bound

公式：

```text
lowerBound = clampResidentCount(max(
  concurrentActivity.lowerBound,
  recurringSleepZones.count,
  sharedSleepZones.strength == strong
    ? recurringSleepZones.count + sharedSleepZones.count
    : 1,
  1
))
```

为什么这样算：下界只接受较硬证据。中等/弱共享睡眠只影响分布，不直接提高下界。

### 12.9 候选人数评分

候选人数：

```text
counts = [1, 2, 3, 4, 5]
```

先计算几个估计值：

```text
routineEstimate = clampResidentCount(round((meaningfulRoomCount + routineClusterCount) / 3))
slotEstimate = residentSlotCount >= 3 ? clampResidentCount(ceil(residentSlotCount / 2)) : null
sleepEstimate = sleepZoneCount > 0 ? clampResidentCount(sleepZoneCount) : null
sharedSleepEstimate =
  sharedSleepZoneCount > 0 and sharedSleepStrength != none
    ? clampResidentCount(sleepZoneCount + sharedSleepZoneCount)
    : null
weakContextPenalty = environmentContextRatio >= 0.8 ? 1.4 : 0
```

对每个候选 `c`，初始：

```text
score(c) = 1
```

然后累加这些项：

| 项 | 公式 | 为什么 |
| --- | --- | --- |
| Below lower bound penalty | `c < lowerBound ? -4 : 0` | 低于硬下界的候选强惩罚 |
| Lower-bound distance | `c == lowerBound ? (lowerBound > 1 ? 1.8 : 0.4) : 0.4 / max(1, abs(c - lowerBound))` | 越接近下界越可信；下界大于 1 时支持更强 |
| Routine estimate distance | `1.2 / (abs(c - routineEstimate) + 1)` | 房间覆盖和 routine 数量给出软估计 |
| Sleep-zone estimate distance | `sleepEstimate ? 2.2 / (abs(c - sleepEstimate) + 1) : 0` | 睡眠区域是较强居住结构证据 |
| Concurrent-room support | `concurrentRoomCount >= 3 && c >= concurrentRoomCount ? 1.6 / (c - concurrentRoomCount + 1) : 0` | 多房间并发支持至少多人 |
| Large-routine support | `routineClusterCount >= 4 && c >= 3 ? 0.8 / (c - 2) : 0` | 多 routine 更支持 3+ |
| Two-resident routine support | `routineClusterCount >= 4 && c == 2 ? 0.45 : 0` | 多 routine 也可能是 2 人家庭 |
| Resident-slot estimate distance | `slotEstimate ? 1.5 / (abs(c - slotEstimate) + 1) : 0` | 匿名槽位给出软估计 |
| Resident-slot support | `residentSlotCount >= 3 && c >= 2 ? 0.65 / (c - 1) : 0` | 多槽位支持多人，但随人数增加衰减 |
| Strong shared sleep | `strong ? 2.8 / (abs(c - sharedSleepEstimate) + 1) : 0` | 直接共享睡眠证据强 |
| Medium shared sleep | `medium ? (c == sharedSleepEstimate ? 3.2 : 0.5 / (abs(c - sharedSleepEstimate) + 1)) : 0` | 中等共享证据更偏向特定候选，但不提高下界 |
| Weak shared sleep | `weak && c == sharedSleepEstimate ? 0.45 : 0` | 弱共享只轻微支持 |
| Sparse evidence penalty | `meaningfulEvidenceWeight + behaviorEpisodeCount < 3 && c > 1 ? -1.5 : 0` | 证据少时惩罚多人结论 |
| Weak context penalty | `environmentContextRatio >= 0.8 && c > 1 ? -1.4 : 0` | 大多是环境上下文时惩罚多人结论 |

最终：

```text
rawScore(c) = round3(sum(terms))
clampedScore(c) = max(0.01, rawScore(c))
probability(c) = round3(clampedScore(c) / sum(clampedScore(all)))
```

最后为了让概率和严格为 1：

```text
probability(1) += 1 - sum(probability(all))
```

为什么这样算：该估计器是启发式概率分布，不是监督学习模型。所有项都保留在 score ledger 中，方便审计“为什么某个人数更高”。

### 12.10 household size 置信度

公式：

```text
estimate = argmax(probability(c))
winningProbability = probability(estimate)
sampleSize =
  meaningfulEvidenceWeight
  + behaviorEpisodeCount
  + max(0, observedDayCount - 1)
  + max(0, observedWeekCount - 1)

sampleCap =
  sampleSize <= 1 ? 0.45
  : sampleSize <= 3 ? 0.62
  : sampleSize <= 6 ? 0.78
  : 0.90

lowerBoundBoost = lowerBound >= 2 ? 0.08 : 0
weakContextPenalty = environmentContextRatio >= 0.8 ? 0.18 : 0

confidence = clamp01(min(
  sampleCap,
  winningProbability + 0.28 + lowerBoundBoost - weakContextPenalty
))
```

为什么这样算：概率分布的最高值给出候选强度；样本量上限约束早期证据；硬下界给小幅加成；环境上下文占比过高时降置信度。

### 12.11 profile 层再次 cap

`household_size` hypothesis 最终置信度：

```text
mostlyWeakContext = activeRoomCount == 0
behaviorSignal =
  meaningfulWeight
  + episodes.length
  + (observedDayCount > 1 ? observedDayCount : 0)
  + (observedWeekCount > 1 ? observedWeekCount : 0)

raw = mostlyWeakContext ? 0.25 : estimator.confidence
sampleSize = max(meaningfulWeight, episodes.length)
confidence = confidenceWithSampleSize(raw, sampleSize)
```

为什么再 cap：估计器已经有自己的样本 cap，但 profile 层仍用统一小样本上限保护 UI 画像，避免 sparse evidence 时看起来过度确定。

## 13. Household Portrait

### 13.1 section 聚合

Portrait 把 hypotheses 按类型分到固定 section：

| section | hypothesis types |
| --- | --- |
| `household_composition` | `household_size`, `resident_slot` |
| `daily_rhythm` | `daily_rhythm` |
| `room_functions` | `room_function`, `room_habit` |
| `routine_patterns` | `routine_window`, `activity_cluster`, `device_routine` |
| `behavior_flows` | `behavior_flow` |
| `device_contribution` | `device_contribution` |
| `current_presence` | `presence_signal` |
| `anomalies_and_uncertainty` | `state_anomaly` |
| `evidence_quality` | 直接从 evidence 计算 |

普通 section：

```text
section.confidence = round3(average(hypothesis.confidence))
section.evidenceIds = unique(all hypothesis evidence ids)
section.missingEvidence = unique(all hypothesis missingEvidence)
section.contradictingEvidenceIds = unique(all contradicting evidence ids)
section.updatedAt = newest(hypothesis.updatedAt)
```

为什么用平均值：portrait section 是同类 hypothesis 的摘要，不是取最高置信度；平均能反映该 section 整体稳定度。

### 13.2 evidence_quality

```text
evidenceCount = recentEvents.length
independentDeviceCount = unique(recentEvents.deviceId).length
distinctRoomCount = unique(recentEvents.roomId).length
observedDayCount = memory.dailySummaryCount
observedWeekCount = memory.weeklySummaryCount
environmentContextRatio =
  evidenceCount > 0 ? round3(environmentContextCount / evidenceCount) : 0

confidence =
  evidenceCount > 0
    ? round3(min(0.95, 0.25 + evidenceCount / 20))
    : 0
```

为什么这样算：证据质量主要看证据数量、设备独立性、房间覆盖和环境上下文占比。置信度上限 0.95，避免“证据多”等于“完全可靠”。

### 13.3 portrait 总置信度

```text
portrait.confidence = round3(average(section.confidence))
```

为什么这样算：总画像置信度表示各 section 的整体稳定度。

## 14. 图谱计算

图谱只是 HomeMemory 的展示投影，不改变 memory。

### 14.1 节点 activity

| 节点 | activity |
| --- | --- |
| home | `memory.totalEvents` |
| room | `room.eventCount` |
| device | `device.eventCount` |
| field | `field.eventCount` |
| semantic | `group.totalWeight` |
| hypothesis | `hypothesis.confidence` |

为什么这样算：activity 决定图谱视觉强弱，低层实体用事件量，高层结论用置信度。

### 14.2 边 strength

| 边 | from -> to | strength |
| --- | --- | --- |
| contains | home -> room | `room.eventCount` |
| contains | room -> device | `device.eventCount` |
| observes | device -> field | `field.eventCount` |
| interprets | field -> semantic | `semanticGroup.totalWeight` |
| supports | hypothesis -> subject/semantic | `hypothesis.confidence` |

为什么这样算：边强度和边表达的关系一致。事实层用观测次数，语义层用权重，画像支持边用置信度。

### 14.3 semantic group

分组 ID：

```text
semantic:${type}:${roomId}:${deviceId}:${field}
```

累积：

```text
count += 1
totalWeight = round3(totalWeight + signal.profileWeight)
latestSimTime = max(latestSimTime, signal.simTime)
sourceEvidenceIds = unique(sourceEvidenceIds + signal.sourceEvidenceIds)
reasons = unique(reasons + signal.reason)
```

为什么这样算：图谱不需要每条 semantic 都是一个节点；同类同房间同设备字段聚合后更易读。

### 14.4 topology 布局

每类节点有固定半径和 z：

| kind | radius | z |
| --- | --- | --- |
| home | 0 | 0 |
| room | 5 | 0 |
| device | 9 | 1.5 |
| field | 13 | -1.5 |
| semantic | 17 | 2.2 |
| hypothesis | 22 | 3.4 |

当某类节点数 `count <= 12` 或 kind 是 home：

```text
angle = 2π * index / max(1, count)
radius = baseRadius
x = round3(cos(angle) * radius)
y = round3(sin(angle) * radius)
z = fixedZ
```

当 `count > 12`：

```text
ringCount = min(4, ceil(count / 12))
ringIndex = index % ringCount
itemIndex = floor(index / ringCount)
itemsInRing = ceil((count - ringIndex) / ringCount)
radiusStep = kind == hypothesis ? 2.7 : 2.2
angleOffset = ringIndex * (π / max(4, itemsInRing))

angle = angleOffset + 2π * itemIndex / max(1, itemsInRing)
radius = baseRadius + (ringIndex - (ringCount - 1) / 2) * radiusStep
```

为什么这样算：少量节点用单环；大量节点拆到最多 4 个环，减少重叠。hypothesis ring 更外扩，因为文本和边更多。

### 14.5 spatial 布局

空间布局按层锚定：

```text
home: (0, 0, 0)
rooms: radius = count <= 4 ? 8.5 : 10.5, angle = -π/2 + 2π*index/count
devices: around room, radius 2.8, angleOffset 0.35, z 1.25
fields: around device, radius 1.15, angleOffset -0.2, z -1.05
semantic: around field, radius 1.45, angleOffset 0.7, z 2.55
hypothesis: average related node position + outward vector * 3.2, z 3.65
```

fallback：

```text
hash = index + 1
for char in id:
  hash = (hash * 31 + charCode) % 9973
angle = hash / 9973 * 2π
x = cos(angle) * fallbackRadius
y = sin(angle) * fallbackRadius
```

为什么这样算：spatial 布局让设备围绕房间、字段围绕设备、语义围绕字段，hypothesis 放在相关节点平均位置外侧。hash fallback 保证没有锚点时也稳定可重放。

## 15. 查询接口计算

查询接口不改变 memory，只做过滤、排序和裁剪。

### 15.1 summary

```text
activeRooms = rooms sorted by eventCount desc, roomId asc
activeDevices = devices sorted by eventCount desc, deviceId asc
activeEpisodes = open episodes sorted by updatedSimTime desc, id asc
activityEpisodes = first 10 memory.activityEpisodes
topPatterns = hypotheses sorted by confidence desc, id asc, first 5
recentHighlights = recentEvents where profileWeight > 0, first 10
updatedAt = recentEvents[0]?.simTime ?? null
```

为什么这样算：summary 是紧凑视图，优先展示最活跃、最高置信、最近且有画像贡献的内容。

### 15.2 entities / episodes / evidence

entities：

```text
room: filter roomId, meaningfulOnly => profileEventCount > 0
device: filter roomId/deviceId, meaningfulOnly => profileEventCount > 0
field: filter roomId/deviceId/field, meaningfulOnly => profileEventCount > 0
```

排序：

```text
rooms/devices: eventCount desc, id asc
fields: lastSeenAt desc, id asc
```

episodes：

```text
filter kind/status/roomId/deviceId/field
sort updatedSimTime desc, id asc
limit default 50
```

evidence：

```text
filter category/strength/roomId/deviceId/field
meaningfulOnly => profileWeight > 0
sort sequence desc, id desc
limit default 50
```

为什么这样算：查询默认返回最近、最相关的事实；`meaningfulOnly` 用于排除无画像贡献的重复遥测和系统上下文。

## 16. 可靠性指标

### 16.1 事实层

```text
coveredEvents = count recentEvents where
  fields[deviceId:field] exists
  and devices[deviceId] exists
  and rooms[roomId] exists

eventCoverage = coveredEvents / recentEvents.length, denominator 0 => 1
sequenceConsistency = recentEvents sorted non-increasing by sequence ? 1 : 0
runIsolation = memory.runId exists and all recentEvents.runId == memory.runId ? 1 : 0
```

为什么这样算：事实层可靠性要证明 evidence 能回到 field/device/room，顺序合理，run 没混。

### 16.2 语义层

```text
semanticEvidenceReferences = flatMap(semanticSignals.sourceEvidenceIds)
orphanSemanticCount = count signal where
  sourceEvidenceIds empty
  or any evidenceId not found

evidenceLinkCorrectness =
  (semanticEvidenceReferences.length - orphanSemanticCount)
  / semanticEvidenceReferences.length
```

为什么这样算：semantic 不能脱离底层 evidence。

### 16.3 画像层

```text
linkedHypotheses = count hypothesis where
  evidence.length > 0
  and every evidence.id exists

contradictionRate =
  count(hypothesis.contradictingEvidence.length > 0)
  / hypotheses.length

unsupportedClaimCount = 0
```

为什么 `unsupportedClaimCount` 目前是 0：当前 deterministic hypothesis 都从已有 evidence 构造；LLM claim 另有 validator 和 enrichment 边界。

### 16.4 图谱层

```text
edgeEndpointIntegrity =
  count(edge where nodeIds has edge.from and edge.to)
  / graph.edges.length

orphanHypothesisCount = count hypothesis where
  evidence.length == 0
  or graph lacks `hypothesis:${id}`

missingEvidenceReferenceCount = count referenced evidence ids not found

confidenceMonotonicityViolations = count support edge where
  edge.strength > source hypothesis.confidence

environmentOnlyCapViolations = count hypothesis where
  confidence > 0.3
  and evidence non-empty
  and every evidence.category == environment_context
```

为什么这样算：图谱应该没有断边、孤立画像、丢失证据引用；环境-only 结论不能高置信。

## 17. 参数总表

| 参数 | 值 | 用途 | 设定理由 |
| --- | --- | --- | --- |
| field recent limit | 20 | 字段近期证据 | 字段数量多，保留短窗口 |
| root/room/device recent limit | 50 | 近期事实和 UI | 足够解释最近画像，限制内存 |
| semantic signal limit | 80 | semantic 近期窗口 | 语义比字段更稀疏，保留更长 |
| environment numeric meaningful delta | 0.5 | 环境读数去噪 | 避免小幅波动刷权重 |
| return_home window | 30 min | 入户后续活动 | 覆盖进门后短流程 |
| meal_preparation window | 45 min | 备餐上下文 | 备餐持续时间更长 |
| climate_response window | 30 min | 环境到空调响应 | 限制同房间近因关系 |
| household concurrent window | 10 min | 多房间并发 | 平衡上报延迟和误串联 |
| CO2 anomaly threshold | 900 | 环境异常候选 | 作为弱空气质量异常信号 |
| PM2.5 anomaly threshold | 35 | 环境异常候选 | 作为弱空气质量异常信号 |
| environment-only cap violation threshold | 0.3 | 可靠性检查 | 仅环境证据不应高置信 |
| device contribution display limit | 5 | 图谱/画像展示 | 只展示高贡献设备 |
| household resident candidates | 1..5 | 人数分布 | 当前单家庭 demo 的候选范围 |
| weak context ratio threshold | 0.8 | 人数估计降权 | 环境上下文占比过高时避免强推多人 |
| evidence quality max confidence | 0.95 | portrait evidence quality | 证据多也不等于绝对可靠 |

## 18. 设计原则总结

1. 事实层确定性：同一批设备值事件重放，得到同一份 HomeMemory。
2. 权重只表达画像贡献：重复遥测和系统状态保留事实，但不增加画像权重。
3. 环境上下文弱化：温湿度、CO2、PM2.5 等可以解释背景，但不能单独推出家庭行为。
4. 小样本强制降置信度：所有 profile hypothesis 都经过样本量上限。
5. household size 输出概率分布：人数估计保留下界、候选概率和 score ledger，不输出绝对真值。
6. 图谱是展示投影：节点、边、布局都从 memory 派生，不反向修改 memory。
