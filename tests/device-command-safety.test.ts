import { describe, expect, it, vi } from 'vitest';
import { confirmDeviceCommand, getDeviceCommandConfirmationMessage } from '../src/web/deviceCommandSafety';

describe('device command safety confirmation', () => {
  it('requires confirmation for commands marked requiresConfirmation even when they are not high risk', () => {
    const message = getDeviceCommandConfirmationMessage({
      displayName: 'Home Router',
      label: 'Restart router',
      highRisk: false,
      requiresConfirmation: true,
      disabled: false
    });

    expect(message).toContain('Restart router');
    expect(message).toContain('Home Router');
  });

  it('confirms high-risk commands and cancels execution when the operator rejects it', () => {
    const confirm = vi.fn(() => false);

    const allowed = confirmDeviceCommand({
      displayName: 'Main Water Valve',
      label: 'Open valve',
      highRisk: true,
      requiresConfirmation: true,
      disabled: false,
      confirm
    });

    expect(allowed).toBe(false);
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('does not prompt for disabled or ordinary commands', () => {
    const confirm = vi.fn(() => true);

    expect(confirmDeviceCommand({
      displayName: 'Living Room Light',
      label: 'Turn on',
      highRisk: false,
      requiresConfirmation: false,
      disabled: false,
      confirm
    })).toBe(true);
    expect(confirmDeviceCommand({
      displayName: 'Home Router',
      label: 'Restart router',
      highRisk: false,
      requiresConfirmation: true,
      disabled: true,
      confirm
    })).toBe(true);
    expect(confirm).not.toHaveBeenCalled();
  });
});
