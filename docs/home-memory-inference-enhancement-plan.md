# Home Memory 推断增强规划

本文记录 Home Memory 后续可以更丰富、更精细的推断方向。目标是在只使用设备状态变化、传感器遥测、房间信息等可观测数据的前提下，构建可解释、可审计、可逐步扩展的家庭画像。

## 当前基线

当前 memory 已经具备以下能力：

- 将 `DeviceTelemetry` 和 `DeviceStateChanged` 投影为 `DeviceValueEvent`。
- 将设备事件 reduce 成房间、设备、字段、episode、每日摘要和每周摘要。
- 将 evidence 分为 `human_activity`、`device_usage`、`environment_context`、`system_status`。
- 生成画像假设：`daily_rhythm`、`room_habit`、`device_routine`、`presence_signal`、`household_size`。
- 对家庭人数做概率分布推断，而不是给出单一确定值。

当前不足也比较明确：

- 推断结果偏粗，很多结论停留在“哪个房间活跃”和“哪个时间桶活跃”。
- 设备能力和画像逻辑耦合较强，新设备接入后容易需要在多个推断规则中补逻辑。
- 还没有显式表达“行为链路”，例如回家、起床、做饭、睡前等过程。
- 置信度主要由样本量和 evidence weight 控制，缺少反证、新鲜度、稳定性等解释维度。

## 设计原则

后续增强应遵守以下原则：

- 不读取模拟真值，只使用实际可获得的设备事件、房间信息和设备能力信息。
- 每个结论必须可解释，保留支撑 evidence、反向 evidence、subjectIds 和 confidence。
- 普通环境遥测只能作为弱上下文，不单独形成强用户画像。
- 新设备接入时优先映射到语义信号，尽量避免在每个画像规则中手写设备分支。
- 推断结果保持概率性，避免把设备事件误读成真实身份或真实人口确认。

## 语义信号层

建议在 `MemoryEvidence` 和 `ProfileHypothesis` 中间增加一层 `SemanticSignal`。它把不同设备、字段、状态统一成可复用的家庭行为语义。

示例类型：

| 语义信号 | 典型来源 | 含义 | 强度 |
| --- | --- | --- | --- |
| `presence_signal` | motion、occupancy、door unlock、sleep sensor | 有人在某处活动或存在 | 中到强 |
| `access_signal` | door lock、entry contact、door open | 出入户或房间进入 | 强 |
| `sleep_signal` | sleep sensor、inBed、bedroom night occupancy | 睡眠或卧床上下文 | 中到强 |
| `water_signal` | flow、valve、water meter | 用水行为 | 中 |
| `cooking_signal` | kitchen appliance power、stove、oven、fridge interaction | 做饭或厨房使用 | 中 |
| `media_signal` | TV、speaker、console、media power | 娱乐或共处活动 | 中 |
| `work_study_signal` | study room device usage、desk lamp、computer plug | 工作或学习活动 | 中 |
| `lighting_signal` | light power、brightness | 环境辅助行为 | 弱到中 |
| `environment_signal` | temperature、humidity、CO2、PM2.5、illuminance | 环境上下文 | 弱 |
| `system_signal` | battery、online、firmware、rssi | 系统状态 | 忽略画像 |

语义信号应至少包含：

- `id`
- `type`
- `roomId`
- `deviceId`
- `field`
- `value`
- `startedAt` / `updatedAt`
- `timeBucket`
- `strength`
- `profileWeight`
- `sourceEvidenceIds`
- `reason`

这样，画像推断可以依赖语义信号，而不是直接判断设备类型和字段名。

## 可增强的推断维度

### 1. 活动类型

当前 `room_habit` 只描述房间活跃时间。后续可以生成更贴近日常生活的活动结论。

候选结论：

- `meal_activity`：厨房早晚活动、厨房电器、用水、照明组合。
- `sleep_activity`：卧室夜间 occupancy、sleep sensor、早晨离床。
- `hygiene_activity`：浴室用水、人体存在、持续时间。
- `work_study_activity`：书房白天或晚间设备使用、桌灯或插座活动。
- `media_activity`：客厅晚间 TV、音箱、游戏设备活动。
- `entry_return_activity`：入口门锁或门磁后，其他房间短时间内活跃。

每个活动结论应输出：

- 活动类型。
- 最相关房间。
- 常见时间段。
- 典型设备组合。
- 最近 evidence。
- 稳定性和置信度。

### 2. 时间规律

当前只使用 `morning`、`daytime`、`evening`、`night` 四个时间桶。可以进一步挖掘：

- 起床窗口。
- 入睡窗口。
- 离家窗口。
- 回家窗口。
- 做饭/用餐窗口。
- 工作日与周末差异。
- 最近趋势，例如更晚睡、更少在家、厨房活动减少。

建议新增 `routine_window` 类结论：

```text
Kitchen meal activity usually appears around evening on observed weekdays.
Evidence: kitchen water flow, appliance power, and motion co-occurred in 4 observed days.
```

### 3. 空间流转和行为链

单点事件对画像的解释力有限，事件序列更接近日常行为。

可推断的行为链：

- `return_home_flow`：入口访问后，客厅、厨房或卧室短时间内活跃。
- `wake_up_flow`：卧室夜间结束后，浴室或厨房早晨活跃。
- `meal_flow`：厨房活动后，餐厅或客厅持续活跃。
- `sleep_prepare_flow`：客厅或浴室晚间活动后，卧室进入夜间状态。
- `leave_home_flow`：入口访问后，全屋 presence 降低。

实现时可以使用短窗口序列，例如 5-30 分钟内的语义信号顺序。结论应说明它是“可能的行为链”，不是确认用户路径。

### 4. 匿名居民角色槽位

不建议直接推断真实身份，但可以建立匿名角色槽位，用于描述家庭结构。

候选槽位：

- `main_sleep_slot`：主卧稳定睡眠相关信号。
- `child_room_sleep_slot`：儿童房稳定睡眠相关信号。
- `daytime_home_slot`：白天在家活动较多的匿名成员。
- `remote_work_slot`：书房白天规律活动成员。
- `late_night_slot`：夜间活动明显成员。
- `shared_evening_slot`：晚间客厅共处相关活动。

这些槽位可以服务于家庭人数推断，也可以解释“这个家大概有什么样的作息结构”。

### 5. 房间功能画像

房间名称并不一定可靠，实际接入环境中可能只有房间标签或设备清单。可以根据设备和事件反推房间功能。

候选结论：

- `sleeping_room_likelihood`
- `cooking_room_likelihood`
- `hygiene_room_likelihood`
- `work_study_room_likelihood`
- `shared_living_room_likelihood`
- `entry_area_likelihood`

这能降低对固定 roomId 的依赖，让系统面对新房型或不同命名时更稳。

### 6. 设备重要性和画像贡献

不是所有设备都应该同等影响画像。可以为设备建立画像贡献评分：

- 核心行为设备：门锁、人体、睡眠、厨房电器、水流、电视。
- 辅助行为设备：灯、窗帘、插座。
- 环境上下文设备：温度、湿度、空气质量、照度。
- 系统状态设备：电量、在线状态、信号强度。

输出示例：

```text
Kitchen Motion and Stove Power are high-contribution devices for meal activity inference.
Temperature Sensor contributes weak environmental context only.
```

这个维度有助于解释为什么某些事件会影响画像，而某些不会。

### 7. 当前状态和异常偏离

家庭画像不只包括长期模式，也包括当前状态是否偏离常态。

候选结论：

- `home_occupied_now`：当前是否可能有人在家。
- `quiet_home_state`：长时间无强 presence。
- `night_activity_anomaly`：夜间活动明显高于日常。
- `environment_without_response`：CO2 或 PM2.5 升高但没有窗户、新风或 presence 响应。
- `routine_missing_today`：通常出现的厨房、睡眠或回家活动今天缺失。

异常类结论必须依赖长期基线，否则容易误报。

## 置信度与反证

建议把画像结论的解释拆成三组证据：

- `supportingEvidence`：直接支持该结论的事件或语义信号。
- `contradictingEvidence`：削弱该结论的事件或缺失模式。
- `missingEvidence`：当前还缺少哪些证据才能更确定。

置信度可以综合：

- 样本量。
- 证据强度。
- 跨天稳定性。
- 最近性。
- 是否存在反证。
- 是否主要依赖环境上下文。
- 是否有多个独立设备共同支持。

这会让 UI 和 API 能明确表达：

```text
The home may have 3 residents, but confidence is capped because only one sleep zone is observed and most activity comes from weak environmental context.
```

## 新设备和新能力接入方式

推荐流程：

1. 先把新设备字段映射到 evidence category。
2. 再把设备能力映射到 semantic signal。
3. 画像推断只消费 semantic signal。
4. 如果新能力代表全新的生活语义，再新增 activity/routine/role 规则。

例如新增空气净化器：

- `pm25`、`co2` 仍是 `environment_signal`。
- `purifier.state=on` 是弱到中等的 `environment_response_signal`。
- 只有当它和空气质量变化、presence 或窗户状态结合时，才进入“环境响应习惯”推断。

例如新增扫地机器人：

- 单独运行不应强推有人在家。
- 可以作为 `maintenance_activity` 或 `automation_activity`。
- 如果它总是在离家后运行，反而可以作为“离家 routine”的辅助 evidence。

## 分阶段落地建议

### Phase 1：语义信号层

- 新增 `SemanticSignal` 类型和 reducer 派生逻辑。
- 把现有 evidence classifier 的结果映射到语义信号。
- 保持现有 profiler 输出不变，先让 reasoning/UI 能展示语义信号。

### Phase 2：活动类型推断

- 新增 `activity_cluster` 的实际生成逻辑。
- 覆盖 meal、sleep、hygiene、work/study、media、entry/return。
- 为每类活动增加单元测试，验证弱环境传感器不会单独触发强活动结论。

### Phase 3：时间规律与行为链

- 从语义信号中提取 routine window。
- 提取短窗口行为链，例如 return home、wake up、sleep prepare。
- 在 reasoning 面板中展示事件进入后如何推动链路和画像结论。

### Phase 4：匿名角色槽位和更精细家庭结构

- 建立 resident slot，不做真实身份识别。
- 用 sleep zone、routine cluster、行为链、并发活动共同更新槽位。
- 让 `household_size` 使用这些槽位作为更强中间证据。

### Phase 5：异常和趋势

- 基于每日/每周摘要建立长期基线。
- 增加当前状态、异常偏离、routine missing 等结论。
- 需要更长历史窗口和更严格置信度控制。

## 推荐优先级

最高优先级是 Phase 1 和 Phase 2。原因是语义信号层能降低后续新设备接入成本，活动类型推断能最快提升 memory 的可读性和画像质量。

Phase 3 适合紧随其后，因为行为链能让 3D 图谱更直观地展示“事件进入 -> 事实 memory -> 语义信号 -> 活动推断 -> 家庭画像”的流程。

Phase 4 和 Phase 5 更依赖长窗口数据，应在事件生成质量和语义信号稳定后再做。
