# Home Memory 数据集演进记录

最后更新：2026-07-23

## 当前结论

`home-memory-benchmark-v4` 是当前冻结的正式数据集。

从现在开始，Home Memory 推理、特征和置信度算法发生变化时，直接在 v4 上重新运行 evaluator，不再生成 v5。只有观测数据协议、Household Template、模拟器行为、数据划分或隐藏真值定义发生破坏性变化时，才允许升级正式数据集版本。

当前无后缀目录 `home-memory-benchmark` 实际是最早的 v1，并不是当前版本，使用时需要特别注意。

## 正式版本概览

| 目录 | 数据 Schema | 样本数 | 家庭组 | 观测数 | 每样本时长 | 干预样本 | 状态 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| `home-memory-benchmark`（v1） | 1 | 28 | 8 | 206,735 | 14 天 | 12 | 废弃 |
| `home-memory-benchmark-v2` | 2 | 28 | 8 | 206,735 | 14 天 | 12 | 废弃 |
| `home-memory-benchmark-v3` | 2 | 28 | 8 | 212,921 | 14 天 | 12 | 过渡版本 |
| `home-memory-benchmark-v4` | 2 | 28 | 8 | 213,596 | 14 天 | 12 | 当前冻结版本 |

所有正式版本都按 Household Template 家庭组划分：

- train：3 个家庭组，10 个样本；
- validation：2 个家庭组，8 个样本；
- blind：3 个家庭组，10 个样本；
- 同一个家庭组不会跨 split；
- 每个 split 都包含一组 baseline 与儿童、宠物、远程办公、自动化移除干预；
- public 目录只包含可观测数据，private 目录保存模板、故障账本和隐藏真值。

## Train、Validation 和 Blind 的含义

当前 Home Memory 是规则系统、增量统计和手工评分公式的组合。仓库中还没有在 train 上拟合参数、在 validation 上选择模型的自动训练流程。因此，这三个 split 当前首先代表不同的 Household Template 家庭组，而不是三个已经执行过机器学习训练的阶段。

| Split | 家庭组 | 样本数 | 当前作用 | 未来存在训练流程时的作用 |
| --- | --- | ---: | --- | --- |
| train | `group_01`–`group_03` | 10 | 日常开发、定位规则错误、观察证据链 | 拟合参数或供开发者调整规则 |
| validation | `group_04`–`group_05` | 8 | 检查规则是否只适合 train 家庭 | 选择模型、阈值和校准方式 |
| blind | `group_06`–`group_08` | 10 | 检查完全不同家庭模板上的泛化 | 参数冻结后的最终一次性评估 |

划分单位是完整家庭组，不是单条事件或随机时间窗口。同一家庭组的所有日期、seed、天气、故障和干预样本只能属于一个 split。例如，不能把同一家庭的前 10 天放入 train，再把后 4 天放入 validation 或 blind。

这种划分主要防止模型记住具体家庭布局、设备 ID 或房间 ID 后得到虚高指标。blind 中的家庭模板与 train 不同，因此更容易发现对 `stove_01`、`child_bedroom` 等具体名称的隐式依赖。

当前 evaluator 对三个 split 使用完全相同的 Home Memory reducer：

```text
public observations
        ↓
同一个 reducer / Feature Store
        ↓
episode / pattern / feature
        ↓
分别与各 split 的 private truth 比较
```

目前没有任何参数只在 train 上拟合。split 只用于隔离家庭模板和分别汇总指标。

现有 evaluator 会一次读取 train、validation 和 blind，并将三者结果都写入评估报告。因此 v4 的 blind 已经被读取并汇总进 overall 指标，严格来说它目前是 held-out regression set，而不是从未揭盲的最终考试集。当前没有根据 blind 的单独结果进行专门调参，但后续不应反复查看 blind 后继续修改规则或权重。

在增加代码门禁前，约定使用顺序为：

1. 日常开发只看 train；
2. 方案准备冻结时看 validation；
3. 发布候选版本才看 blind；
4. 查看 blind 后，不再根据其结果调整参数；
5. 如果未来需要严格密封的最终盲测，应单独准备一次性 sealed test set，而不是每次修改算法都生成新的 blind。

## v1：初始严格隔离数据集

目录：`home-memory-benchmark`

v1 首次建立了多 Household Template、多 seed、季节、天气和日期的数据集，并加入丢包、延迟、数值噪声和设备离线故障。训练、验证和盲测已经按家庭组隔离。

这一版的主要不足：

- 使用 schema 1；
- private truth 主要记录模板和预期语义特征；
- 没有可直接计算的 episode 边界；
- 没有 canonical pattern occurrence；
- 没有 feature-level quantitative labels；
- 无法计算 episode F1、边界误差、Brier、ECE 等完整指标。

因此 v1 只能用于早期数据管线和隔离性验证，不能作为当前模型基线。

## v2：首次加入量化隐藏真值

目录：`home-memory-benchmark-v2`

v2 将数据升级为 schema 2，新增：

- simulator world state 产生的 episode 边界；
- truth activity 产生的 point episode；
- canonical pattern 和 positive feature labels；
- episode F1、边界误差、pattern precision/recall；
- Brier score、ECE；
- 每家庭每月误报数；
- time-to-detection；
- 相邻窗口稳定性；
- 删除关键证据后的 counterfactual sensitivity。

这一版暴露了两个重要问题：

- 通用 Household Template 的 meal 行为没有实际驱动模板中的 stove/range hood；
- 远程办公行为没有提供足够的通用设备/房间上下文。

v2 的历史评估结果：

| 指标 | 结果 |
| --- | ---: |
| Episode F1 | 0.7969 |
| Pattern F1 | 0.5854 |
| Brier score | 0.1966 |
| ECE | 0.1949 |

v2 的较低指标是发现模拟器与推理语义没有对齐的重要证据，不应再作为当前性能基线。

## v3：补齐通用 cooking 行为

目录：`home-memory-benchmark-v3`

v3 对 Household Template 通用行为做了进一步落地：

- meal 行为会驱动模板中的 cooktop/stove；
- 同房间的 range hood 会与 cooking episode 联动；
- 增加 `stove-range-hood-paired` 隐藏真值；
- 增加 `feature:stove_range_hood_coupling` 正例；
- 验证不依赖 `stove_01`、`range_hood_01` 等固定 ID。

相对于 v2，观测数从 206,735 增加到 212,921。

v3 仍是过渡版本：

- 尚未加入通用远程办公 room-role 上下文；
- episode 在样本开始前已经激活时，没有 left-censored 标注；
- episode 在样本结束时仍未关闭时，没有完整的 right-censored 处理；
- 没有保存最终全量评估报告。

## v4：当前冻结版本

目录：`home-memory-benchmark-v4`

v4 在 v3 基础上完成了当前需要的语义闭环：

- 远程办公会驱动模板中的工作照明；
- router lifecycle 只用于建立通用 work room-role，不直接充当行为证据；
- 支持 `world_state`、`truth_activity`、`left_censored` 和 `right_censored` 四种边界来源；
- 初始已经在床的睡眠状态不再被错误计算为模型假阳性；
- `confidence`、`sample_dropped` 和 `ts - simTime` 延迟进入 Observation quality；
- `remainingMin`、`lifecyclePhase`、`openMinutes` 等字段只更新 episode lifecycle；
- evaluator 使用完整 episode fact 和 pattern candidate，不依赖 50/80 条内存窗口；
- pattern 以 supportDays/opportunityDays 为样本，不以遥测行数为样本。

v4 校验结果：

| 项目 | 结果 |
| --- | ---: |
| 样本数 | 28 |
| 观测数 | 213,596 |
| Household Template 家庭组 | 8 |
| 干预样本 | 12 |
| public/private 真值泄漏 | 0 |
| 单样本时长 | 14 天 |

v4 当前评估基线：

| 指标 | 结果 |
| --- | ---: |
| Episode precision | 0.9945 |
| Episode recall | 0.9809 |
| Episode F1 | 0.9877 |
| 平均边界误差 | 0.0005 分钟 |
| Pattern precision | 0.9451 |
| Pattern recall | 1.0000 |
| Pattern F1 | 0.9718 |
| Brier score | 0.0463 |
| ECE | 0.0470 |
| 每家庭每月误报 | 0.7653 |
| Feature detection rate | 1.0000 |
| Feature 检测延迟中位数 | 5.4333 小时 |
| 相邻窗口稳定性 | 1.0000 |
| Counterfactual disappearance rate | 0.7692 |

完整报告位于：

`home-memory-benchmark-v4/private/evaluation/home-memory-metrics.json`

## Smoke 数据集

Smoke 数据集只用于在生成完整数据前快速检查一条端到端路径，不得用于训练、模型选型或正式指标比较。

| 目录 | 样本数 | 时长 | 观测数 | 用途 |
| --- | ---: | ---: | ---: | --- |
| `home-memory-benchmark-smoke` | 1 | 1 天 | 635 | 检查 cooking/work 模拟器改动 |
| `home-memory-benchmark-smoke2` | 1 | 1 天 | 635 | 检查 right-censored truth 和 evaluator 修复 |

`smoke2` 的历史 Episode F1 为 0.8889、Pattern F1 为 1.0。它的样本规模太小，而且生成时间早于最终 left-censored 修复，因此这些值只用于调试。

## 冻结规则

### 只重跑评估，不生成新数据

以下变化应继续使用 v4：

- Home Memory reducer 或 Feature Store 实现变化；
- episode 聚合或 pattern candidate 算法变化；
- feature confidence、校准或阈值变化；
- household size estimator 变化；
- evaluator 的报表格式或新指标变化；
- 性能优化、持久化方式和查询接口变化。

运行：

```text
npm run memory:benchmark:evaluate -- --root data/home-memory-benchmark-v4
```

评估结果继续写入 v4 的 `private/evaluation/`，public observations 保持不变。

### 必须升级正式数据版本

只有以下变化才允许创建后续版本：

- `DeviceValueEvent` 公共观测字段发生不兼容变化；
- Household Template catalog、家庭组或 split 发生变化；
- seed、日期、季节、天气或故障注入配置发生变化；
- 模拟器的居民行为或设备驱动逻辑发生实质变化；
- private ground truth 的 episode/pattern/feature 定义发生不兼容变化；
- 样本天数或 intervention 设计发生变化；
- 修复的问题只能通过重新模拟 public observations 才能生效。

升级时必须在本文件中增加新版本记录，说明：

1. 为什么旧数据不能复用；
2. public observations 是否变化；
3. private truth 是否变化；
4. 样本数、观测数和 split 是否变化；
5. 新旧评估指标的差异；
6. 新版本是否成为冻结版本。

## 使用约定

- 当前正式训练、验证和盲测统一使用 v4。
- 生产 reducer、Feature Store 和运行时推理只能读取 `public/`。
- 当前没有自动训练代码；如果未来增加监督学习，受控 trainer 可以连接 train public observations 与 train private labels。
- validation private labels 只能用于模型、阈值和校准方式的选择。
- evaluator 可以读取允许评估的 split 对应的 `public/` 和 `private/`。
- blind truth 不得进入训练、特征工程或阈值调参。
- 不使用 v1、v2、v3 的指标与当前模型进行横向比较。
- 不以 smoke 数据集的结果作为模型质量结论。
- 在确认不需要复现历史问题前，不删除旧版本。
