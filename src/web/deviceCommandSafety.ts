export interface DeviceCommandConfirmationInput {
  displayName: string;
  label: string;
  highRisk: boolean;
  requiresConfirmation: boolean;
  disabled: boolean;
}

export interface ConfirmDeviceCommandInput extends DeviceCommandConfirmationInput {
  confirm?: (message: string) => boolean;
}

export function getDeviceCommandConfirmationMessage(input: DeviceCommandConfirmationInput): string | null {
  if (input.disabled || !input.highRisk && !input.requiresConfirmation) {
    return null;
  }
  const riskLabel = input.highRisk ? 'high-risk command' : 'device command';
  return `${input.label} ${input.displayName}? This ${riskLabel} may affect home safety or availability.`;
}

export function confirmDeviceCommand(input: ConfirmDeviceCommandInput): boolean {
  const message = getDeviceCommandConfirmationMessage(input);
  if (!message) {
    return true;
  }
  return (input.confirm ?? window.confirm)(message);
}
