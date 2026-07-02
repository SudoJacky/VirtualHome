export type MemoryLocale = 'en' | 'zh';

export interface MemoryCopy {
  language: {
    label: string;
    english: string;
    chinese: string;
  };
  toolbar: {
    eyebrow: string;
    title: string;
    subtitle: string;
    pause: string;
    resume: string;
    reset: string;
  };
  status: Record<'connecting' | 'live' | 'reconnecting' | 'paused' | 'offline', string>;
  graph: {
    viewModeLabel: string;
    spatial: string;
    topology: string;
    spatialTitle: string;
    topologyTitle: string;
    canvasLabel: string;
    layerLabel: string;
    cursorLabel: string;
    waitingStream: string;
    sequence: string;
    noCursor: string;
    heartbeat: string;
    noHeartbeat: string;
    layers: {
      home: string;
      rooms: string;
      devices: string;
      fields: string;
      semantic: string;
      hypotheses: string;
    };
  };
  profileStats: {
    eyebrow: string;
    title: string;
    stats: Record<'events' | 'rooms' | 'devices' | 'fields' | 'episodes' | 'semanticSignals' | 'days' | 'weeks' | 'hypotheses' | 'graph', string>;
    home: string;
    run: string;
    latestUpdate: string;
    unknown: string;
    noObservedRun: string;
    waiting: string;
    confidence: string;
    emptyHypotheses: string;
  };
  semanticSignals: {
    eyebrow: string;
    title: string;
    empty: string;
  };
  reasoning: {
    eyebrow: string;
    title: string;
    waiting: string;
    ruleMatched: string;
  };
  stateLedger: {
    eyebrow: string;
    title: string;
    subtitle: string;
    eventSelector: string;
    narration: string;
    formula: string;
    changes: string;
    hypotheses: string;
    empty: string;
  };
  llmTrace: {
    purposeTitle: string;
    purposeSubtitle: string;
    streamEventSuffix: string;
    purposes: Array<{
      purpose: string;
      label: string;
      trigger: string;
      output: string;
      why: string;
    }>;
  };
  demoWalkthrough?: {
    eyebrow: string;
    title: string;
    subtitle: string;
    evidence: string;
    reference: string;
  };
  whiteBox: {
    eyebrow: string;
    ariaLabel: string;
    confidence: string;
    guidedTitle: string;
    guidedSubtitle: string;
    ledgerTitle: string;
    ledgerSubtitle: string;
  };
  selectedMemory: {
    eyebrow: string;
    emptyTitle: string;
    empty: string;
  };
  evidenceBreakdown: {
    supporting: string;
    contradicting: string;
    missing: string;
  };
  evidence: {
    title: string;
    empty: string;
  };
  recentEvents: {
    eyebrow: string;
    title: string;
    ariaLabel: string;
    empty: string;
  };
  rowLabels: Record<string, string>;
  whiteBoxStages: Record<string, { title: string; description?: string }>;
}

export const MEMORY_LOCALES: MemoryLocale[] = ['en', 'zh'];

export function memoryCopy(locale: MemoryLocale): MemoryCopy {
  return MEMORY_COPY[locale];
}

export function isMemoryLocale(value: string | null): value is MemoryLocale {
  return value === 'en' || value === 'zh';
}

const MEMORY_COPY: Record<MemoryLocale, MemoryCopy> = {
  en: {
    language: {
      label: 'Language',
      english: 'EN',
      chinese: '中文'
    },
    toolbar: {
      eyebrow: 'Home memory',
      title: 'Device-observed memory graph',
      subtitle: 'Built only from the device event socket stream.',
      pause: 'Pause',
      resume: 'Resume',
      reset: 'Reset'
    },
    status: {
      connecting: 'Memory connecting',
      live: 'Memory live',
      reconnecting: 'Memory reconnecting',
      paused: 'Memory paused',
      offline: 'Memory offline'
    },
    graph: {
      viewModeLabel: 'Memory graph view mode',
      spatial: 'Spatial',
      topology: 'Topology',
      spatialTitle: 'Show memory grouped around room context',
      topologyTitle: 'Show the raw memory graph layers',
      canvasLabel: 'Home memory 3D graph',
      layerLabel: 'Home memory graph layers',
      cursorLabel: 'Device event cursor',
      waitingStream: 'Waiting for device stream',
      sequence: 'Sequence',
      noCursor: 'No cursor yet',
      heartbeat: 'Heartbeat',
      noHeartbeat: 'No heartbeat',
      layers: {
        home: 'Home',
        rooms: 'Rooms',
        devices: 'Devices',
        fields: 'Fields',
        semantic: 'Semantic',
        hypotheses: 'Hypotheses'
      }
    },
    profileStats: {
      eyebrow: 'Profile stats',
      title: 'Observed shape',
      stats: {
        events: 'Events',
        rooms: 'Rooms',
        devices: 'Devices',
        fields: 'Fields',
        episodes: 'Episodes',
        semanticSignals: 'Semantic signals',
        days: 'Days',
        weeks: 'Weeks',
        hypotheses: 'Hypotheses',
        graph: 'Graph'
      },
      home: 'Home',
      run: 'Run',
      latestUpdate: 'Latest update',
      unknown: 'Unknown',
      noObservedRun: 'No observed run',
      waiting: 'Waiting',
      confidence: 'confidence',
      emptyHypotheses: 'No profile hypotheses yet.'
    },
    semanticSignals: {
      eyebrow: 'Semantic signals',
      title: 'Event meaning',
      empty: 'No semantic signals derived yet.'
    },
    reasoning: {
      eyebrow: 'Reasoning flow',
      title: 'Event to profile',
      waiting: 'Waiting for a device event to explain the flow.',
      ruleMatched: 'Rule matched'
    },
    stateLedger: {
      eyebrow: 'Event state ledger',
      title: 'State transitions',
      subtitle: 'Select one event to see the exact memory changes, formulas, and presenter narration.',
      eventSelector: 'Select a memory event',
      narration: 'Presenter narration',
      formula: 'Calculation detail',
      changes: 'State changes',
      hypotheses: 'hypotheses',
      empty: 'Waiting for device events before a state ledger can be built.'
    },
    llmTrace: {
      purposeTitle: 'Why LLM is called',
      purposeSubtitle: 'Provider calls are optional, gated, cached, and serialized through one lane.',
      streamEventSuffix: 'events; deltas are validated before adoption',
      purposes: [
        {
          purpose: 'hypothesis_explanation',
          label: 'Hypothesis explanation',
          trigger: 'Refresh or stream',
          output: 'Turns an existing hypothesis and its evidence IDs into a readable explanation.',
          why: 'Used for presentation: what we believe, which evidence supports it, and what is still missing.'
        },
        {
          purpose: 'reliability_review',
          label: 'Reliability review',
          trigger: 'Refresh with reliability',
          output: 'Reviews a mid-confidence hypothesis for missing evidence, contradictions, and alternatives.',
          why: 'Used to show that LLM does not blindly approve the rule result.'
        },
        {
          purpose: 'daily_portrait_summary',
          label: 'Portrait summary',
          trigger: 'Portrait enrichment',
          output: 'Summarizes the current household portrait from already computed sections and evidence.',
          why: 'Used to make the high-level home memory story easier to explain.'
        },
        {
          purpose: 'semantic_candidate',
          label: 'Semantic candidate',
          trigger: 'Candidate batch',
          output: 'Suggests a possible semantic meaning for a stable evidence window.',
          why: 'Used as a candidate only; it does not write facts back into memory.'
        },
        {
          purpose: 'unknown_schema_mapping',
          label: 'Unknown schema mapping',
          trigger: 'Unknown field threshold',
          output: 'Suggests how an unfamiliar device field might map to a capability or semantic signal.',
          why: 'Used to help extend rules without letting LLM mutate the rule library.'
        },
        {
          purpose: 'query_planning',
          label: 'Query planning',
          trigger: 'Natural-language query',
          output: 'Creates an evidence-locked query plan while deterministic code still executes the query.',
          why: 'Used to translate user intent without giving LLM direct control over memory.'
        }
      ]
    },
    demoWalkthrough: {
      eyebrow: 'Presenter walkthrough',
      title: 'Demo script',
      subtitle: 'Follow this order to explain how device events become home memory and profile conclusions.',
      evidence: 'What to point at',
      reference: 'Where to drill down'
    },
    whiteBox: {
      eyebrow: 'White-box reasoning',
      ariaLabel: 'White-box memory reasoning flow',
      confidence: 'confidence',
      guidedTitle: 'Guided explanation chain',
      guidedSubtitle: 'Use this path to explain the calculation from observed device facts to the final profile conclusion.',
      ledgerTitle: 'Complete calculation ledger',
      ledgerSubtitle: 'All evidence rows, semantic rows, feature rows, scoring terms, formulas, and uncertainty notes are listed here without truncation.'
    },
    selectedMemory: {
      eyebrow: 'Selected memory',
      emptyTitle: 'No node selected',
      empty: 'Select a sphere to inspect memory and evidence.'
    },
    evidenceBreakdown: {
      supporting: 'Supporting',
      contradicting: 'Contradicting',
      missing: 'Missing'
    },
    evidence: {
      title: 'Evidence',
      empty: 'No direct evidence attached.'
    },
    recentEvents: {
      eyebrow: 'Recent device events',
      title: 'Newest first',
      ariaLabel: 'Recent device events',
      empty: 'No device events observed yet.'
    },
    rowLabels: {},
    whiteBoxStages: {}
  },
  zh: {
    language: {
      label: '语言',
      english: 'EN',
      chinese: '中文'
    },
    toolbar: {
      eyebrow: '家庭记忆',
      title: '设备观测记忆图谱',
      subtitle: '只基于设备事件流构建，不读取模拟真值。',
      pause: '暂停',
      resume: '继续',
      reset: '重置'
    },
    status: {
      connecting: '记忆连接中',
      live: '记忆实时更新',
      reconnecting: '记忆重连中',
      paused: '记忆已暂停',
      offline: '记忆离线'
    },
    graph: {
      viewModeLabel: '记忆图谱视图模式',
      spatial: '空间',
      topology: '拓扑',
      spatialTitle: '按房间上下文组织记忆',
      topologyTitle: '显示原始记忆图谱层级',
      canvasLabel: '家庭记忆 3D 图谱',
      layerLabel: '家庭记忆图谱层级',
      cursorLabel: '设备事件游标',
      waitingStream: '等待设备事件流',
      sequence: '序列',
      noCursor: '暂无游标',
      heartbeat: '心跳',
      noHeartbeat: '暂无心跳',
      layers: {
        home: '家庭',
        rooms: '房间',
        devices: '设备',
        fields: '字段',
        semantic: '语义',
        hypotheses: '结论'
      }
    },
    profileStats: {
      eyebrow: '画像统计',
      title: '观测轮廓',
      stats: {
        events: '事件',
        rooms: '房间',
        devices: '设备',
        fields: '字段',
        episodes: '片段',
        semanticSignals: '语义信号',
        days: '天数',
        weeks: '周数',
        hypotheses: '结论',
        graph: '图谱'
      },
      home: '家庭',
      run: '运行',
      latestUpdate: '最近更新',
      unknown: '未知',
      noObservedRun: '暂无观测运行',
      waiting: '等待中',
      confidence: '置信度',
      emptyHypotheses: '暂无画像结论。'
    },
    semanticSignals: {
      eyebrow: '语义信号',
      title: '事件含义',
      empty: '还没有抽取到语义信号。'
    },
    reasoning: {
      eyebrow: '推理流程',
      title: '从事件到画像',
      waiting: '等待设备事件进入后展示推理流程。',
      ruleMatched: '命中的规则'
    },
    stateLedger: {
      eyebrow: '事件状态账本',
      title: '状态变化链路',
      subtitle: '选择一条事件，查看它造成的 memory 状态变化、公式和演示讲解词。',
      eventSelector: '选择一条 memory 事件',
      narration: '演示讲解',
      formula: '计算细节',
      changes: '状态变化',
      hypotheses: '条假设',
      empty: '还没有设备事件，暂时无法生成状态变化账本。'
    },
    llmTrace: {
      purposeTitle: '为什么调用 LLM',
      purposeSubtitle: 'Provider 调用是可选的，会经过开关、gate、缓存和全局串行队列；同一时刻最多只有一个调用。',
      streamEventSuffix: '个事件；流式片段会在完整校验后才被采用',
      purposes: [
        {
          purpose: 'hypothesis_explanation',
          label: '画像假设解释',
          trigger: '刷新或流式演示',
          output: '把已有 hypothesis 和 evidence IDs 转成可读的解释文本。',
          why: '演示时用来说明：我们相信什么、证据来自哪里、还缺什么。'
        },
        {
          purpose: 'reliability_review',
          label: '可靠性审稿',
          trigger: '带可靠性审稿的刷新',
          output: '审查中等置信度 hypothesis 的缺失证据、矛盾和替代解释。',
          why: '用来证明 LLM 不是盲目确认规则结论，而是在帮我们质疑它。'
        },
        {
          purpose: 'daily_portrait_summary',
          label: '家庭画像摘要',
          trigger: '画像摘要增强',
          output: '基于已经计算出的家庭画像片段和证据生成高层摘要。',
          why: '让画像结论更适合向人解释，但不改变底层画像计算。'
        },
        {
          purpose: 'semantic_candidate',
          label: '语义候选',
          trigger: '候选批处理',
          output: '为稳定 evidence window 提出可能的语义解释。',
          why: '只作为候选，不直接写回 memory，用来发现规则库尚未覆盖的模式。'
        },
        {
          purpose: 'unknown_schema_mapping',
          label: '未知字段映射',
          trigger: '未知字段达到阈值',
          output: '建议陌生 device field 可能对应的 capability 或 semantic 类型。',
          why: '帮助扩展规则库，但不会让 LLM 直接修改规则。'
        },
        {
          purpose: 'query_planning',
          label: '查询计划',
          trigger: '自然语言查询',
          output: '生成证据锁定的查询计划，实际执行仍由确定性代码完成。',
          why: '用于翻译用户意图，避免 LLM 直接读写 memory。'
        }
      ]
    },
    whiteBox: {
      eyebrow: '白盒推理',
      ariaLabel: '家庭记忆白盒推理流程',
      confidence: '置信度',
      guidedTitle: '讲解链路',
      guidedSubtitle: '可以按这条路径向别人解释：系统如何从设备观测事实一步步计算出画像结论。',
      ledgerTitle: '完整计算账本',
      ledgerSubtitle: '这里完整展开所有证据、语义、特征、评分项、公式和不确定性说明，不做截断。'
    },
    selectedMemory: {
      eyebrow: '选中的记忆',
      emptyTitle: '未选择节点',
      empty: '选择一个球体查看记忆和证据。'
    },
    evidenceBreakdown: {
      supporting: '支持证据',
      contradicting: '矛盾证据',
      missing: '缺失证据'
    },
    evidence: {
      title: '证据',
      empty: '暂无直接证据。'
    },
    recentEvents: {
      eyebrow: '最近设备事件',
      title: '按时间倒序',
      ariaLabel: '最近设备事件',
      empty: '还没有观测到设备事件。'
    },
    rowLabels: {
      Activity: '活跃度',
      'Active days': '活跃天数',
      'Behavior episodes': '行为片段',
      'Candidate scoring': '候选评分',
      Category: '类别',
      Change: '变化',
      'Collect evidence': '收集证据',
      'Collect stable resident signals': '收集稳定住户信号',
      Confidence: '置信度',
      'Concurrent rooms': '并发房间',
      'Contradicting evidence': '矛盾证据',
      Current: '当前值',
      Device: '设备',
      'Device event': '设备事件',
      Devices: '设备',
      Distribution: '分布',
      Episodes: '片段',
      Estimate: '估计',
      'Estimator confidence': '估算器置信度',
      'Evidence aggregate': '证据聚合',
      'Evidence events': '证据事件',
      'Score ledger': '评分账本',
      Field: '字段',
      Fields: '字段',
      'Find concurrent lower bound': '查找并发下界',
      'Final confidence': '最终置信度',
      'Fact memory': '事实记忆',
      'Graph subjects': '图谱主体',
      'Hypothesis update': '结论更新',
      Kind: '类型',
      Latest: '最近',
      'Lower bound': '下界',
      'Map subjects': '映射主体',
      'Meaningful rooms': '有效房间',
      'Profile weight': '画像权重',
      Room: '房间',
      Rooms: '房间',
      Rule: '规则',
      'Rule inputs': '规则输入',
      'Score resident distribution': '住户分布评分',
      'Semantic interpretation': '语义解释',
      'Semantic signals': '语义信号',
      Signals: '信号',
      'Sleep zones': '睡眠区',
      Strength: '强度',
      Subjects: '主体',
      'Supporting evidence': '支持证据',
      Type: '类型',
      'UI confidence': '界面置信度',
      Updated: '更新于',
      Weight: '权重',
      'Weak environment ratio': '弱环境证据比例',
      'Weighted evidence': '加权证据'
    },
    whiteBoxStages: {
      'Observed conclusion': {
        title: '观测结论',
        description: '当前在记忆图谱中选中的画像结论。'
      },
      'Direct evidence': {
        title: '直接证据',
        description: '这个结论直接引用的设备事件。这些是观测输入，不是模拟真值。'
      },
      'Semantic interpretation': {
        title: '语义解释',
        description: '设备事件会先归一成语义信号，再被高层画像规则读取。'
      },
      'Aggregate features': {
        title: '聚合特征',
        description: '设备观测事实会被压缩成住户数量、活动、房间等推断特征。'
      },
      'Rule inputs': {
        title: '规则输入',
        description: '当前结论使用的事件、语义、房间、设备和图谱主体。'
      },
      'Candidate scoring': {
        title: '候选评分',
        description: '对每个候选结论使用同一组输入打分，然后归一化成概率。'
      },
      'Score ledger': {
        title: '评分账本',
        description: '住户数量估算器使用的每一个评分项。所有项求和后得到原始分，再经过下限保护并归一化成概率。'
      },
      'Confidence calculation': {
        title: '置信度计算',
        description: '置信度是受样本量、证据强度和不确定性限制的概率式分数。'
      },
      'Missing or weak evidence': {
        title: '缺失或弱证据',
        description: '这些信息会让结论更稳定或更精确。'
      }
    }
  }
};
