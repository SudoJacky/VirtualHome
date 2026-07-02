# Home Memory 演示讲稿

## 30 秒总览

Home Memory 不直接读取模拟里的人员真值，也不直接把设备事件跳成画像结论。每条设备事件进入后，系统会先归一成 capability，再形成可审计的 evidence，随后更新 field、device、room 和 home memory。只有有意义的变化才增加画像权重，semantic signal 只是中间解释，最终 hypothesis 是基于证据、权重、样本量上限和规则计算出来的概率结论。

## 单条事件讲解模板

1. 我们先选中一条设备事件，例如某个门锁、运动传感器或家电功率变化。
2. 页面第一步展示原始事件：哪个房间、哪个设备、哪个字段、变成什么值。
3. 接着看分类：系统把 `deviceType + field + value` 归一成 capability，再决定 evidence category、strength 和基础权重。
4. 然后看 change analysis：如果是重复遥测或环境小波动，`profileWeight` 会变成 0；如果是有意义变化，才会进入画像权重。
5. evidence 生成后，系统逐层更新 field、device、room、daily/weekly summary 和 HomeMemory root。
6. 如果这条 evidence 能解释生活语义，会生成 semantic signal，例如 access、presence、cooking、sleep。
7. 最后页面展示它影响了哪些 hypothesis，以及 confidence 为什么是这个数。

## 关键话术

- evidence 是事实账本，semantic signal 是中间解释，hypothesis 是概率画像。
- 系统不会因为一条事件直接确认某个人在家，只会增加或降低某些画像假设的证据权重。
- 重复遥测会被保存为事实，但不会反复增加画像权重。
- 环境数据是弱上下文，不能单独推出人员行为。
- household size 输出的是概率分布和下界，不是绝对人数。

## 领导可能问的问题

### 为什么这条事件不是直接变成“有人回家”？

因为系统先生成 evidence，再生成 semantic signal，最后才影响 hypothesis。这样每一步都可追溯，也能避免单条设备噪声直接变成结论。

### 为什么有的事件权重是 0？

重复遥测或环境小幅波动会保存为事实，但不会增加画像权重。这样高频传感器不会把画像置信度刷高。

### 为什么 household size 是概率？

设备事件只能间接观察家庭活动，不能直接读取真实人数。所以系统输出 1 到 5 人的概率分布、下界和置信度，并保留 score ledger 解释每个候选人数为什么得分。
