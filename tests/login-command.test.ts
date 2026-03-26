import { describe, it, expect } from 'vitest';
import { resolveLoginOptions, resolveSteamCmdPathForLogin } from '../src/commands/login.js';

describe('resolveLoginOptions', () => {
  it('uses explicit env-variable names for secrets', () => {
    const options = resolveLoginOptions(
      {
        username: 'cli-user',
        passwordEnv: 'STEAM_PASS',
        guardCodeEnv: 'STEAM_GUARD',
        nonInteractive: true,
      },
      {
        STEAM_PASS: 'secret-password',
        STEAM_GUARD: '123456',
      }
    );

    expect(options).toEqual({
      username: 'cli-user',
      password: 'secret-password',
      guardCode: '123456',
      nonInteractive: true,
    });
  });

  it('prefers BOILER_* environment variables', () => {
    const options = resolveLoginOptions(
      {},
      {
        BOILER_USERNAME: 'env-user',
        BOILER_PASSWORD: 'env-password',
        BOILER_GUARD_CODE: '654321',
        BOILER_NON_INTERACTIVE: 'true',
      }
    );

    expect(options).toEqual({
      username: 'env-user',
      password: 'env-password',
      guardCode: '654321',
      nonInteractive: true,
    });
  });

  it('throws when an explicit password env var is missing', () => {
    expect(() => resolveLoginOptions({ passwordEnv: 'MISSING_PASSWORD' }, {})).toThrow(/MISSING_PASSWORD/);
  });
});

describe('resolveSteamCmdPathForLogin', () => {
  it('uses an existing SteamCMD install when found', async () => {
    await expect(resolveSteamCmdPathForLogin(
      {},
      {
        findSteamCmd: async () => '/usr/bin/steamcmd',
        downloadSteamCmd: async () => '/tmp/steamcmd',
      }
    )).resolves.toBe('/usr/bin/steamcmd');
  });

  it('downloads SteamCMD only when explicitly requested', async () => {
    await expect(resolveSteamCmdPathForLogin(
      { installSteamcmd: true },
      {
        findSteamCmd: async () => null,
        downloadSteamCmd: async () => '/tmp/steamcmd',
      }
    )).resolves.toBe('/tmp/steamcmd');
  });

  it('fails when SteamCMD is missing and install is not allowed', async () => {
    await expect(resolveSteamCmdPathForLogin(
      {},
      {
        findSteamCmd: async () => null,
        downloadSteamCmd: async () => '/tmp/steamcmd',
      }
    )).rejects.toThrow(/--install-steamcmd/i);
  });
});
