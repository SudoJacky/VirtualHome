# 家庭 Memory 处理流程

本文面向第一次阅读 VirtualHome 的人，说明家庭 memory 如何从 device-events 中的设备值事件，逐步形成事实记忆、语义信号、行为片段、家庭画像结论、3D 图谱和查询接口响应。

![家庭 Memory 架构](./assets/home-memory-architecture.png)

## 一句话总览

家庭 memory 不读取模拟内部的人员真值，也不读取场景控制原因。它只消费设备值事件：哪个家庭、哪个房间、哪个设备、哪个字段，在什么时间变成了什么值。系统先把这些低层事实聚合成房间、设备、字段和 episode，再从中提取 semantic signal，最后生成可解释的家庭画像假设。

## 输入从哪里来

家庭 memory 有两个入口，但输入数据模型相同。

| 入口 | 数据来源 | 使用场景 |
| --- | --- | --- |
| 浏览器实时视图 | 订阅 device-events WebSocket | Memory UI 实时更新 3D 图谱、事件列表、画像结论 |
| 服务端查询接口 | 从事件历史重放并投影出设备值事件 | 外部 agent 查询 memory summary、entities、episodes、evidence 和 hypotheses |

两条路径都会把设备值事件交给同一套 reducer，所以实时 UI 和服务端查询看到的是同一种 memory 逻辑。

## device-events 消息类型

| 消息 | 含义 | memory 如何使用 |
| --- | --- | --- |
| device.update | 一批设备值事件，以及当前 run 和 sequence 游标 | 把 events reduce 到当前 HomeMemory |
| device.heartbeat | 当前连接仍然活着 | 只用于 UI 连接状态，不进入 memory reducer |
| device.run_changed | 服务端 run 已切换 | 清空当前 memory，重新从新 run 接收数据 |

device.update 中 replayComplete 表示重连补放是否完整。若不完整，UI 会保留已经处理的部分，显示提示，并继续重连追赶。

## 设备值事件字段和用途

| 字段 | 含义 | 如何生成 | memory 如何使用 |
| --- | --- | --- | --- |
| id | 单个字段事件的唯一 ID | 原始设备事件 ID 加字段名 | 作为 evidence ID，连接 semantic signal、图谱高亮和详情证据 |
| sourceEventId | 原始设备事件 ID | 来自设备遥测或设备状态变化事件 | 用于溯源，不参与画像判断 |
| sourceEventType | 原始事件类型 | 设备遥测或设备状态变化 | 保存到 evidence；UI 可展示来源类型 |
| runId | 模拟运行 ID | 原始事件继承 | run 切换时重置 memory；写入各层 memory |
| sequence | 原始事件序号 | 原始事件继承 | 排序、断线续传、寻找最新事件 |
| ts | 真实时间 | 原始事件创建时生成 | first seen、last seen、episode 起止时间 |
| simTime | 模拟时间 | 模拟时钟生成 | 时间段归类、日/周摘要、画像节律 |
| homeId | 家庭 ID | 家庭模板继承 | 标识 memory 所属家庭 |
| roomId | 房间 ID | 设备所在房间 | 建 room memory、推断活动区域和房间功能 |
| deviceId | 设备 ID | 设备注册信息 | 建 device memory、field memory、episode 和图谱节点 |
| deviceType | 设备类型 | 设备注册信息 | 判断证据类别、semantic 类型和设备角色 |
| field | 状态或遥测字段名 | measurements 或 state 展开得到 | 建字段 memory，识别 episode、semantic 和当前状态 |
| value | 字段的新值 | 设备状态或遥测读数 | 判断变化、当前值、数值范围、布尔统计和语义强度 |

这些字段基本都会被使用。区别是：roomId、deviceType、field、value、simTime 直接影响推断；id、sourceEventId、sourceEventType、sequence 更多用于追踪、排序和解释。

## 处理管线

一条设备值事件进入后，memory 会按固定顺序处理：

1. 检查 runId。如果 run 变了，清空旧 memory，避免不同 run 混在一起。
2. 根据 simTime 把事件归入 morning、daytime、evening 或 night。
3. 用 deviceId 和 field 形成字段身份，定位同一个设备字段的历史。
4. 根据 deviceType、field 和 value 判断证据类别、证据强度和基础画像权重。
5. 判断这次值变化是否有意义。重复值仍会保存为事实，但画像权重为零。
6. 生成 MemoryEvidence，作为之后所有解释的底层证据。
7. 更新 field memory：当前值、上一值、变化次数、遥测次数、数值范围、布尔统计和近期事件。
8. 更新 device memory：最新字段值、字段列表、事件计数、时间段分布和证据权重。
9. 更新 room memory：活跃设备、活跃字段、事件计数、时间段分布和证据权重。
10. 更新 episode：把连续的低层活动压缩成占用、接触活动、设备使用或家电使用片段。
11. 更新每日和每周摘要：记录长窗口内活跃房间、设备、字段、时间段和有意义房间。
12. 生成 semantic signal：把低层字段变化解释成生活语义。
13. 更新根 HomeMemory：总事件数、近期证据、画像证据权重、semantic 计数和摘要计数。

## Memory 层级

| 层级 | 保存什么 | 由哪些数据生成 | 如何使用 |
| --- | --- | --- | --- |
| HomeMemory | homeId、runId、总事件数、近期 evidence、semantic signals、日/周摘要、画像权重 | 所有设备值事件累积 | 作为画像、图谱、查询接口和 UI 的根对象 |
| Room memory | 房间内设备、活跃字段、事件计数、时间段分布、证据权重 | roomId 聚合 | 判断房间活跃度、房间习惯、房间功能 |
| Device memory | 设备最新字段值、字段列表、事件计数、时间段分布、证据权重 | deviceId 聚合 | 判断设备例程、设备贡献、图谱设备节点 |
| Field memory | 当前值、上一值、变化次数、遥测次数、数值 min/max、布尔 true/false、近期 evidence | deviceId 加 field 聚合 | 表示最低层事实记忆，也是 semantic 和 episode 的主要来源 |
| MemoryEvidence | 单条设备值事件加分类、强度、权重、变化判断和解释 | 每条设备值事件转换得到 | 作为所有画像结论的可追溯证据 |
| Semantic signal | 设备字段变化对应的生活语义 | meaningful evidence 加规则识别 | 连接低层事实和高层 hypothesis |
| Episode | 连续活动片段，如 occupancy、contact activity、device usage、appliance usage | 字段状态的开关、功率或占用信号 | 减少高频事件噪声，辅助 presence 和 household size |
| Daily/weekly summary | 长窗口活跃房间、设备、字段、时间段和有意义房间 | 按 simTime 日期和周聚合 | 支撑长期习惯和 household size，不只看最近几十条事件 |
| Profile hypothesis | 可解释的家庭画像假设 | 事实 memory、semantic、episode、日/周摘要 | 展示家庭习惯、房间功能、人数估计等高层结论 |

近期事件有上限：根、房间和设备保留最近 50 条；字段保留最近 20 条；semantic signal 保留最近 80 条。长期趋势依靠日/周摘要保留。

## Evidence 分类和权重

每条设备值事件都会先变成 MemoryEvidence。它的分类决定这条事件对画像有多强。

| 分类 | 典型数据 | 含义 | 对画像的影响 |
| --- | --- | --- | --- |
| human_activity | 门锁打开、运动、占用、门磁打开 | 更像人在家中活动 | 较强证据 |
| device_usage | 电源打开、功率上升、设备运行 | 设备被使用或家电活动 | 中到强证据 |
| environment_context | 温度、湿度、CO2、PM2.5、通用环境读数 | 环境状态变化 | 弱证据，主要提供背景 |
| system_status | 电池、在线状态、固件、信号强度 | 设备健康或系统状态 | 保存为事实，但通常不参与画像推断 |

有意义变化的判断规则：

| 情况 | 处理 |
| --- | --- |
| 字段第一次出现 | 记为有意义变化 |
| 值完全重复 | 保存事实和计数，但画像权重为零 |
| 数值字段变化 | 非零变化通常有意义 |
| 环境数值变化 | 变化至少达到阈值才算画像证据 |
| system_status | 可以生成系统语义，但画像权重为零 |

这个设计让高频传感器不会因为重复上报而过度影响画像。

## Semantic signal 是什么

Semantic signal 是“事件含义的中间解释”，不是最终结论。它回答的是：这条设备字段变化像什么生活信号。

| 类型 | 来源数据 | 含义 | 下游用途 |
| --- | --- | --- | --- |
| presence_signal | 运动、占用、门磁、部分人类活动设备 | 可能有人活动或在场 | presence、活动聚类、人数估计 |
| access_signal | 门锁、入口门磁、门窗打开 | 入户、离家或访问活动 | entry/return flow、resident slot、presence |
| sleep_signal | 睡眠传感器、inBed、asleep | 睡眠或在床上下文 | 睡眠区、常住人数估计 |
| water_signal | 水流、阀门、用水设备 | 用水活动 | 卫生间/厨房活动、routine cluster |
| cooking_signal | 厨房、炉灶、微波炉、咖啡机、正向功率 | 做饭、备餐或厨房活动 | meal routine、room function |
| media_signal | 电视、音箱、游戏机、媒体设备 | 娱乐或共享媒体活动 | living evening routine |
| work_study_signal | 书房、电脑、桌面设备、工作字段 | 工作或学习活动 | study/work routine、家庭功能区域 |
| lighting_signal | 灯、亮度、照明字段 | 活动背景照明 | 辅助 presence 和房间活动 |
| environment_signal | 温湿度、空气质量等环境上下文 | 环境变化 | 弱背景，不单独强推画像 |
| system_signal | 电池、在线、固件、信号强度 | 设备健康或系统状态 | 诊断和事实记忆，不参与画像 |

Semantic 与 hypothesis 的区别：

| 层级 | 粒度 | 例子 | 稳定性 |
| --- | --- | --- | --- |
| Field memory | 单个设备字段事实 | 客厅电视 power 变为 on | 单次事实 |
| Semantic signal | 单次或聚合事件含义 | media_signal | 中间证据 |
| Profile hypothesis | 跨时间、跨房间、跨设备的画像结论 | 客厅晚间有媒体娱乐习惯 | 聚合推断 |

## Episode 如何降低噪声

Episode 把连续的低层事件压缩成行为片段。它关注“某个活动从开始到结束”，而不是每次遥测上报。

| 触发信号 | Episode 类型 | 例子 |
| --- | --- | --- |
| motion、occupancy、occupied | occupancy | 某房间一段时间有人活动 |
| contact、doorOpen、open、windowOpen | contact_activity | 门窗或接触传感器打开到关闭 |
| power 或 state 的 on/off | device_usage | 电视或灯从打开到关闭 |
| powerW、wattage、current 的正向读数 | appliance_usage | 咖啡机、洗衣机、洗碗机运行片段 |

Episode 会保存开始时间、更新时间、结束时间、持续时长、房间、设备、字段、证据 ID、最新值、峰值和累计画像权重。它主要用于 presence、routine 和 household size。

## Profile hypothesis 有哪些结论

Profile hypothesis 是家庭画像结论。每个结论都包含标签、摘要、置信度、更新时间、关联主体和证据。下面说明每类结论如何得出。

| 结论类型 | 使用的数据 | 推断逻辑 | 含义 |
| --- | --- | --- | --- |
| daily_rhythm | evidence 的 timeBucket、涉及房间、日/周摘要、画像权重 | 找出 morning、daytime、evening、night 中出现过活动的时间段，并按样本量和权重计算置信度 | 家在某个时间段有活动节律 |
| room_habit | 房间事件数、时间段分布、设备数、episode 数、房间画像权重 | 每个活跃房间选择最强时间段，并按该房间在全屋信号中的占比给置信度 | 某个房间通常在什么时间活跃 |
| device_routine | 房间内设备数、房间事件数、最强时间段、房间画像权重 | 只有多设备且事件足够的房间才生成 | 某房间存在稳定的多设备使用模式 |
| activity_cluster | semantic signal 的类型、房间、时间段和来源 evidence | 把厨房用餐、客厅娱乐、书房工作、睡眠等语义聚成生活模式 | 某类生活活动在特定房间和时间出现 |
| routine_window | cooking、sleep、work_study、media 等重复语义信号 | 按类型和时间窗口聚合 | 某类活动有稳定时间窗口 |
| behavior_flow | access_signal 后接其它活动信号 | 查找入户或离家附近的后续活动 | 回家后可能进入厨房、客厅等流程 |
| room_function | 一个房间内的 semantic signal 组合 | 根据语义类型判断房间功能 | 厨房、睡眠区、工作区、娱乐区等功能画像 |
| resident_slot | 睡眠、入口、长期房间使用等语义 | 识别可能代表常住成员的生活槽位 | 用于辅助家庭人数和生活结构推断 |
| device_contribution | 设备产生的非环境、非系统 semantic 权重 | 找出对画像贡献高的设备 | 哪些设备最能解释家庭活动 |
| state_anomaly | 环境 signal 与行为 signal 的对比 | 环境事件多但行为信号少时降低画像确定性 | 防止传感器噪声被误认为生活模式 |
| presence_signal | 有意义的人类活动、设备使用、episode 和活跃房间 | 结合近期 evidence 和 episode 判断是否存在活动 | 最近可能有人在家或有行为活动 |
| household_size | 并发活动、睡眠区、routine cluster、长期摘要、弱环境占比、episode | 估计 1 到 5 人概率分布、下界和置信度 | 家庭常住人数的概率画像 |

## household_size 更细的推断逻辑

家庭人数不会从单条事件直接得出，而是综合多个特征。

| 特征 | 数据来源 | 作用 |
| --- | --- | --- |
| 并发活动窗口 | 最近 evidence 按 10 分钟窗口聚合，统计同窗口强活动房间数 | 给人数提供最低下界 |
| 睡眠区 | sleep_sensor、inBed、夜间卧室 occupancy episode | 识别稳定睡眠位置 |
| 共享睡眠区候选 | 主卧睡眠区、同房间多个睡眠设备、数值型占用人数、儿童睡眠区和家庭共享活动 | 识别主卧可能由两名成人共享；弱/中等证据只调整概率，强证据才可能提高下界 |
| routine cluster | 厨房用餐、书房工作、客厅娱乐、卫生间用水、入口活动、睡眠等语义组合 | 判断不同生活模式是否共存 |
| 有意义房间数 | human_activity、device_usage 或 episode 支持的房间 | 衡量活动覆盖范围 |
| 长窗口房间数 | daily/weekly summary 中的 meaningfulRooms | 避免只看最近几十条事件 |
| 弱环境上下文占比 | environment_context 在画像事件中的占比 | 防止温湿度等高频背景误推人数 |
| episode 数量 | occupancy、contact、device、appliance 片段 | 把重复低层事件压缩成行为证据 |

共享睡眠区候选分为三档。强证据来自同一主卧的多个睡眠设备、床侧信号，或 occupancyCount、personCount 等数值字段达到 2；它可以作为更高人数下界的依据。中等证据来自主卧稳定睡眠、儿童房睡眠、晚间客厅活动、用餐或入口回家等家庭 routine 的组合；它会提高 3 人及以上的概率，但不会把下界硬提到 3。弱证据只有主卧睡眠区本身，只能说明“可能存在共享主卧”，不能单独推断夫妻同住。

输出不是绝对人数，而是概率分布。例如：最可能是 3 人，下界 2 人，1 到 5 人各自有不同概率，并附带置信度和解释特征。

## 3D 图谱如何表达 memory

Memory UI 会把 HomeMemory 转成 3D 图谱。图谱是展示模型，不改变底层 memory。

| 节点 | 来源数据 | 表达含义 |
| --- | --- | --- |
| Home | HomeMemory 根统计 | 整个家庭记忆 |
| Room | Room memory | 房间级事实和活动 |
| Device | Device memory | 设备级事实和活动 |
| Field | Field memory | 设备字段当前状态和历史 |
| Semantic | 聚合后的 semantic signal | 设备事件的生活含义 |
| Hypothesis | Profile hypothesis | 高层家庭画像结论 |

主要边关系：

| 边 | 含义 |
| --- | --- |
| Home 包含 Room | 家庭由房间组成 |
| Room 包含 Device | 设备属于房间 |
| Device 观察 Field | 设备产生某个字段事实 |
| Field 解释为 Semantic | 字段变化被解释成生活语义 |
| Hypothesis 支持到主体 | 某个画像结论由房间、设备、字段或 semantic 支撑 |

当新事件进入时，UI 会高亮 Home 到 Room 到 Device 到 Field，再到 Semantic 和相关 Hypothesis 的链路，让读者看到“事件如何进入事实记忆，又如何影响画像结论”。

## 查询接口如何使用 memory

服务端 memory 查询不会读取浏览器状态。它会从持久化事件历史重建目标 run 的 HomeMemory，再返回不同视图。

| 接口 | 返回内容 | 典型用途 |
| --- | --- | --- |
| memory summary | 家庭、房间、设备、字段、episode、画像的紧凑摘要 | 外部 agent 快速获得上下文 |
| memory entities | 房间、设备或字段 memory，可按条件过滤 | 检查某个实体的状态和证据 |
| memory episodes | 行为片段 | 理解一段持续活动 |
| memory evidence | 最近底层证据，可筛 meaningfulOnly | 在行动前查看支撑数据 |
| memory profile hypotheses | 家庭画像结论，可选择包含 evidence | 获取高层推断和解释 |

这些查询会记录为 ml-observation 访问审计。

## 持久化边界

当前系统不会把 HomeMemory 作为独立数据库表持久化。数据库保存的是原始事件、遥测、快照、幂等记录和访问审计。每次服务端 memory 查询都会从事件历史重新投影并 reduce。

这样做的好处是：reducer 或画像逻辑改进后，可以用同一份事件历史重新计算 memory。代价是：run 很长时，重建查询会随着历史增长变慢。未来可以增加物化缓存，缓存到某个 covered sequence，再从该位置继续增量计算。

## 阅读这两个文档时的逻辑顺序

先读事件生成流程，理解模拟如何产生完整事件，以及为什么最终只把设备值事件交给 memory。再读本文，理解 memory 如何把设备值事件变成事实、语义、行为片段和家庭画像。

最终链路可以概括为：

家庭模板和场景计划产生模拟状态变化；状态变化生成原始事件；设备相关原始事件被压平成设备值事件；设备值事件进入 memory；memory 形成事实记忆、语义信号和画像假设；UI 和查询接口把这些内容展示给人或外部 agent。
