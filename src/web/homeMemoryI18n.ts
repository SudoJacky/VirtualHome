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
