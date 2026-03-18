import { beforeEach, describe, expect, it, vi } from 'vitest';

const promptMock = vi.fn();
const runSteamCmdMock = vi.fn();
const loadGlobalConfigMock = vi.fn();
const updateGlobalConfigMock = vi.fn();

const spinnerState = {
  text: '',
  start: vi.fn(),
  stop: vi.fn(),
  fail: vi.fn(),
  succeed: vi.fn(),
};

vi.mock('inquirer', () => ({
  default: {
    prompt: promptMock,
  },
}));

vi.mock('../src/core/steamcmd.js', () => ({
  runSteamCmd: runSteamCmdMock,
  isLoginFailure: (output: string) => /Login Failure|FAILED.*login|Invalid Password/i.test(output),
  isRateLimited: (output: string) => /Rate Limit Exceeded/i.test(output),
}));

vi.mock('../src/core/config.js', () => ({
  loadGlobalConfig: loadGlobalConfigMock,
  updateGlobalConfig: updateGlobalConfigMock,
}));

vi.mock('../src/util/logger.js', () => ({
  spinner: () => spinnerState,
  info: vi.fn(),
  dim: vi.fn(),
}));

const { login } = await import('../src/core/auth.js');

describe('login', () => {
  beforeEach(() => {
    promptMock.mockReset();
    runSteamCmdMock.mockReset();
    loadGlobalConfigMock.mockReset();
    updateGlobalConfigMock.mockReset();
    spinnerState.start.mockReset();
    spinnerState.stop.mockReset();
    spinnerState.fail.mockReset();
    spinnerState.succeed.mockReset();
    spinnerState.text = '';
    loadGlobalConfigMock.mockReturnValue({ username: 'saved-user' });
  });

  it('fails without prompting when password is missing in non-interactive mode', async () => {
    const result = await login('/tmp/steamcmd', {
      username: 'ci-user',
      nonInteractive: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/password is required in non-interactive mode/i);
    expect(promptMock).not.toHaveBeenCalled();
    expect(runSteamCmdMock).not.toHaveBeenCalled();
  });

  it('fails without prompting when Steam Guard is required but no code was provided', async () => {
    runSteamCmdMock.mockResolvedValueOnce({
      exitCode: 1,
      stdout: 'Steam Guard code required',
      stderr: '',
    });

    const result = await login('/tmp/steamcmd', {
      username: 'ci-user',
      password: 'ci-password',
      nonInteractive: true,
    });

    expect(result.success).toBe(false);
    expect(result.message).toMatch(/steam guard code is required in non-interactive mode/i);
    expect(promptMock).not.toHaveBeenCalled();
    expect(runSteamCmdMock).toHaveBeenCalledTimes(1);
  });

  it('uses a provided guard code in non-interactive mode', async () => {
    runSteamCmdMock
      .mockResolvedValueOnce({
        exitCode: 1,
        stdout: 'Steam Guard code required',
        stderr: '',
      })
      .mockResolvedValueOnce({
        exitCode: 0,
        stdout: 'Logged in OK',
        stderr: '',
      });

    const result = await login('/tmp/steamcmd', {
      username: 'ci-user',
      password: 'ci-password',
      guardCode: '123456',
      nonInteractive: true,
    });

    expect(result.success).toBe(true);
    expect(runSteamCmdMock).toHaveBeenCalledTimes(2);
    expect(runSteamCmdMock.mock.calls[1][1]).toEqual([
      '+set_steam_guard_code',
      '123456',
      '+login',
      'ci-user',
      'ci-password',
      '+quit',
    ]);
    expect(updateGlobalConfigMock).toHaveBeenCalledWith({ username: 'ci-user' });
  });
});
