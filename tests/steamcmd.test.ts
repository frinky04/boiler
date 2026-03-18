import { describe, it, expect } from 'vitest';
import {
  parseBuildId,
  parseUploadProgress,
  isLoginFailure,
  needsSteamGuard,
  isSuccessfulLogin,
  isSuccessfulBuild,
  classifyCachedLoginProbe,
  processSteamCmdOutputChunk,
  flushSteamCmdOutputBuffer,
  isRetriableSteamCmdOutput,
  isRetriableSteamCmdResult,
  retrySteamCmdExecution,
  classifySteamCmdFailure,
} from '../src/core/steamcmd.js';

describe('output parsing', () => {
  it('parses BuildID from success output', () => {
    expect(parseBuildId('Successfully finished appID=480 (BuildID 12345)')).toBe('12345');
    expect(parseBuildId('BuildID 99999')).toBe('99999');
    expect(parseBuildId('no build id here')).toBeNull();
  });

  it('parses upload progress percentage', () => {
    expect(parseUploadProgress('Uploading content... 45.2%')).toBe(45.2);
    expect(parseUploadProgress('100%')).toBe(100);
    expect(parseUploadProgress('no percentage')).toBeNull();
  });

  it('processes carriage-return progress updates from stream chunks', () => {
    const lines: string[] = [];
    const state = processSteamCmdOutputChunk(
      'Uploading content... 12.5%\rUploading content... 55.0%\r',
      { buffered: '', aborted: false },
      { onOutput: (line) => lines.push(line) }
    );

    expect(lines).toEqual([
      'Uploading content... 12.5%',
      'Uploading content... 55.0%',
    ]);
    expect(state.buffered).toBe('');
  });

  it('flushes a final buffered line without a trailing newline', () => {
    const lines: string[] = [];
    const flushed = flushSteamCmdOutputBuffer(
      { buffered: 'Uploading content... 99.9%', aborted: false },
      { onOutput: (line) => lines.push(line) }
    );

    expect(lines).toEqual(['Uploading content... 99.9%']);
    expect(flushed.buffered).toBe('');
  });

  it('detects login failures', () => {
    expect(isLoginFailure('Login Failure: Invalid Password')).toBe(true);
    expect(isLoginFailure('FAILED login attempt')).toBe(true);
    expect(isLoginFailure('Logged in OK')).toBe(false);
  });

  it('detects Steam Guard requirement', () => {
    expect(needsSteamGuard('Steam Guard code required')).toBe(true);
    expect(needsSteamGuard('Two-factor authentication needed')).toBe(true);
    expect(needsSteamGuard('Please confirm the login in the Steam Mobile app on your phone.')).toBe(true);
    expect(needsSteamGuard('Waiting for confirmation...')).toBe(true);
    expect(needsSteamGuard('Logged in OK')).toBe(false);
  });

  it('detects successful logins across SteamCMD success variants', () => {
    expect(isSuccessfulLogin('Logged in OK')).toBe(true);
    expect(isSuccessfulLogin('Waiting for user info...OK')).toBe(true);
    expect(isSuccessfulLogin('Login Success')).toBe(true);
    expect(isSuccessfulLogin('Waiting for confirmation...')).toBe(false);
  });

  it('detects successful builds', () => {
    expect(isSuccessfulBuild('Successfully finished appID=480')).toBe(true);
    expect(isSuccessfulBuild('ERROR! Build failed')).toBe(false);
  });

  it('classifies a valid cached login check', () => {
    const result = classifyCachedLoginProbe({
      exitCode: 0,
      stdout: 'Logging in user foo\nLogged in OK\nWaiting for user info...OK',
      stderr: '',
    });

    expect(result.status).toBe('valid');
  });

  it('classifies an expired cached login check', () => {
    const result = classifyCachedLoginProbe({
      exitCode: 1,
      stdout: 'Logging in user foo',
      stderr: 'Password: ',
    });

    expect(result.status).toBe('missing');
  });

  it('classifies mobile approval output as a missing cached login', () => {
    const result = classifyCachedLoginProbe({
      exitCode: 1,
      stdout: [
        'Logging in user foo',
        'This account is protected by a Steam Guard mobile authenticator.',
        'Please confirm the login in the Steam Mobile app on your phone.',
        'Waiting for confirmation...',
      ].join('\n'),
      stderr: '',
    });

    expect(result.status).toBe('missing');
  });

  it('detects retriable SteamCMD output patterns', () => {
    expect(isRetriableSteamCmdOutput('ERROR! Failed to connect to content server')).toBe(true);
    expect(isRetriableSteamCmdOutput('HTTP 503 Service Unavailable')).toBe(true);
    expect(isRetriableSteamCmdOutput('Login Failure: Invalid Password')).toBe(false);
  });

  it('does not retry login/auth failures', () => {
    expect(isRetriableSteamCmdResult({
      exitCode: 1,
      stdout: '',
      stderr: 'Login Failure: Invalid Password',
    })).toBe(false);
  });
});

describe('retrySteamCmdExecution', () => {
  it('retries transient failures with exponential backoff', async () => {
    const attempts = [
      { exitCode: 1, stdout: '', stderr: '[boiler] SteamCMD timed out after 600s' },
      { exitCode: 1, stdout: '', stderr: 'HTTP 503 Service Unavailable' },
      { exitCode: 0, stdout: 'Successfully finished appID=480 (BuildID 12345)', stderr: '' },
    ];
    const sleepCalls: number[] = [];
    let attemptIndex = 0;

    const result = await retrySteamCmdExecution(
      async () => attempts[attemptIndex++]!,
      {
        maxAttempts: 3,
        initialDelayMs: 50,
        backoffMultiplier: 2,
        sleep: async (ms) => {
          sleepCalls.push(ms);
        },
      }
    );

    expect(result.exitCode).toBe(0);
    expect(attemptIndex).toBe(3);
    expect(sleepCalls).toEqual([50, 100]);
  });

  it('stops retrying when output is not retriable', async () => {
    let calls = 0;

    const result = await retrySteamCmdExecution(async () => {
      calls += 1;
      return {
        exitCode: 1,
        stdout: '',
        stderr: 'Invalid app build config file specified',
      };
    }, {
      maxAttempts: 3,
      initialDelayMs: 10,
      sleep: async () => {},
    });

    expect(result.exitCode).toBe(1);
    expect(calls).toBe(1);
  });
});

describe('classifySteamCmdFailure', () => {
  it('classifies rate-limit failures', () => {
    const failure = classifySteamCmdFailure('ERROR! Rate Limit Exceeded', 1);
    expect(failure.category).toBe('rate_limit');
    expect(failure.retriable).toBe(true);
  });

  it('classifies transient network failures', () => {
    const failure = classifySteamCmdFailure('Failed to connect to content server (HTTP 503)', 1);
    expect(failure.category).toBe('network');
    expect(failure.retriable).toBe(true);
  });

  it('classifies disk-related failures', () => {
    const failure = classifySteamCmdFailure('No space left on device', 1);
    expect(failure.category).toBe('disk');
    expect(failure.retriable).toBe(false);
  });

  it('classifies depot lock conflicts', () => {
    const failure = classifySteamCmdFailure('ERROR! Depot 481 is locked by another build', 1);
    expect(failure.category).toBe('depot_lock');
    expect(failure.retriable).toBe(true);
  });

  it('classifies manifest/build script failures', () => {
    const failure = classifySteamCmdFailure('ERROR! invalid app build script', 1);
    expect(failure.category).toBe('manifest');
    expect(failure.retriable).toBe(false);
  });

  it('falls back to unknown with exit code context', () => {
    const failure = classifySteamCmdFailure('mystery steamcmd output', 42);
    expect(failure.category).toBe('unknown');
    expect(failure.summary).toContain('42');
  });
});
