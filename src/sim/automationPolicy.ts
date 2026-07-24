export const automationRuleIds = [
  'sleep_mode',
  'cooking_ventilation',
  'stove_unattended_safety',
  'away_mode',
  'close_water_valve_on_leak',
  'fridge_left_open',
  'network_offline',
  'door_left_open',
  'senior_no_activity'
] as const;

export type AutomationRuleId = typeof automationRuleIds[number];

export interface AutomationPolicyThresholds {
  cookingVentilationOnPowerW: number;
  cookingVentilationOffPowerW: number;
  unattendedStovePowerW: number;
  fridgeOpenMinutes: number;
}

export interface AutomationPolicyModule {
  id: string;
  version: string;
  enabledRules: readonly AutomationRuleId[];
  thresholds: Readonly<AutomationPolicyThresholds>;
}

export const coreAutomationPolicyModule: AutomationPolicyModule = Object.freeze({
  id: 'core_household_automation',
  version: '1.0.0',
  enabledRules: Object.freeze([...automationRuleIds]),
  thresholds: Object.freeze({
    cookingVentilationOnPowerW: 500,
    cookingVentilationOffPowerW: 100,
    unattendedStovePowerW: 1000,
    fridgeOpenMinutes: 5
  })
});

const mandatorySafetyRules = new Set<AutomationRuleId>([
  'stove_unattended_safety',
  'close_water_valve_on_leak'
]);

export function validateAutomationPolicyModule(policy: AutomationPolicyModule): string[] {
  const issues: string[] = [];
  const enabled = new Set(policy.enabledRules);
  if (!policy.id.trim()) issues.push('id must not be empty');
  if (!policy.version.trim()) issues.push('version must not be empty');
  if (enabled.size !== policy.enabledRules.length) issues.push('enabledRules must not contain duplicates');
  for (const ruleId of policy.enabledRules) {
    if (!automationRuleIds.includes(ruleId)) issues.push(`unknown rule ${ruleId}`);
  }
  for (const ruleId of mandatorySafetyRules) {
    if (!enabled.has(ruleId)) issues.push(`mandatory safety rule ${ruleId} must remain enabled`);
  }

  const { thresholds } = policy;
  for (const [name, value] of Object.entries(thresholds)) {
    if (!Number.isFinite(value) || value < 0) issues.push(`threshold ${name} must be a non-negative finite number`);
  }
  if (thresholds.cookingVentilationOffPowerW > thresholds.cookingVentilationOnPowerW) {
    issues.push('cookingVentilationOffPowerW must not exceed cookingVentilationOnPowerW');
  }
  if (thresholds.fridgeOpenMinutes < 1) issues.push('fridgeOpenMinutes must be at least 1');
  return issues;
}

export function isAutomationRuleEnabled(policy: AutomationPolicyModule, ruleId: AutomationRuleId): boolean {
  return policy.enabledRules.includes(ruleId);
}
