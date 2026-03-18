import { describe, it, expect } from 'vitest';
import {
  parseBuildId,
  parseUploadProgress,
  isLoginFailure,
  needsSteamGuard,
  isSuccessfulBuild,
  classifyCachedLoginProbe,
  processSteamCmdOutputChunk,
  flushSteamCmdOutputBuffer,
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
    expect(needsSteamGuard('Logged in OK')).toBe(false);
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
});
