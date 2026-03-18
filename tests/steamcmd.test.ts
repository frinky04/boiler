import { describe, it, expect } from 'vitest';
import { parseBuildId, parseUploadProgress, isLoginFailure, needsSteamGuard, isSuccessfulBuild } from '../src/core/steamcmd.js';

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
});
