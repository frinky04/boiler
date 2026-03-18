import { spawn } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import which from 'which';
import { steamcmdBinary, commonSteamcmdLocations, steamcmdDownloadUrl } from '../util/platform.js';
import { loadGlobalConfig, updateGlobalConfig, getGlobalDir } from './config.js';
import * as logger from '../util/logger.js';

export interface SteamCmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export async function findSteamCmd(): Promise<string | null> {
  // 1. Check global config
  const global = loadGlobalConfig();
  if (global.steamcmdPath && existsSync(global.steamcmdPath)) {
    return global.steamcmdPath;
  }

  // 2. Check PATH
  const binary = steamcmdBinary();
  try {
    const found = await which(binary);
    if (found) return found;
  } catch {
    // not on PATH
  }

  // 3. Check common locations
  for (const dir of commonSteamcmdLocations()) {
    const candidate = join(dir, binary);
    if (existsSync(candidate)) return candidate;
  }

  // 4. Check our own managed install
  const managedPath = join(getGlobalDir(), 'steamcmd', binary);
  if (existsSync(managedPath)) return managedPath;

  return null;
}

export async function downloadSteamCmd(): Promise<string> {
  const installDir = join(getGlobalDir(), 'steamcmd');
  if (!existsSync(installDir)) mkdirSync(installDir, { recursive: true });

  const url = steamcmdDownloadUrl();
  const isZip = url.endsWith('.zip');
  const archiveName = isZip ? 'steamcmd.zip' : 'steamcmd.tar.gz';
  const archivePath = join(installDir, archiveName);

  const spin = logger.spinner(`Downloading SteamCMD from ${url}...`);
  spin.start();

  try {
    const response = await fetch(url);
    if (!response.ok || !response.body) {
      throw new Error(`Download failed: ${response.status} ${response.statusText}`);
    }

    const fileStream = createWriteStream(archivePath);
    // @ts-ignore - Node 18+ ReadableStream to NodeJS.ReadableStream
    await pipeline(response.body as any, fileStream);

    spin.text = 'Extracting SteamCMD...';

    if (isZip) {
      // Use PowerShell on Windows to extract
      await runCommand('powershell', [
        '-Command',
        `Expand-Archive -Path '${archivePath}' -DestinationPath '${installDir}' -Force`,
      ]);
    } else {
      await runCommand('tar', ['-xzf', archivePath, '-C', installDir]);
    }

    const binary = join(installDir, steamcmdBinary());
    if (!existsSync(binary)) {
      throw new Error(`SteamCMD binary not found after extraction at ${binary}`);
    }

    // Save path to global config
    updateGlobalConfig({ steamcmdPath: binary });

    spin.succeed('SteamCMD downloaded and ready');
    return binary;
  } catch (err) {
    spin.fail('Failed to download SteamCMD');
    throw err;
  }
}

function runCommand(cmd: string, args: string[]): Promise<void> {
  return new Promise((resolve, reject) => {
    const proc = spawn(cmd, args, { stdio: 'ignore' });
    proc.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} exited with code ${code}`));
    });
    proc.on('error', reject);
  });
}

export async function ensureSteamCmd(): Promise<string> {
  const found = await findSteamCmd();
  if (found) {
    updateGlobalConfig({ steamcmdPath: found });
    return found;
  }
  return downloadSteamCmd();
}

export interface RunAppBuildOptions {
  steamcmdPath: string;
  username: string;
  vdfPath: string;
  onOutput?: (line: string) => void;
}

export interface RunSteamCmdOptions {
  onOutput?: (line: string) => void;
  onRawOutput?: (chunk: string) => void;
  timeoutMs?: number;
  /** Kill the process early if a line matches this pattern */
  abortPattern?: RegExp;
}

export interface CachedLoginProbeResult {
  status: 'valid' | 'missing' | 'rate_limited' | 'timeout' | 'unknown';
  message: string;
  output: string;
}

const LOGGED_IN_RE = /Logged in OK|Waiting for user info\.\.\.OK|Login Success/i;
const PASSWORD_PROMPT_RE = /password:/i;
const STEAM_GUARD_PROMPT_RE = /Steam Guard|Two-factor|two factor|confirm the login in the Steam Mobile app|Waiting for confirmation|Steam Guard mobile authenticator/i;

export interface StreamProcessState {
  buffered: string;
  aborted: boolean;
}

export function processSteamCmdOutputChunk(
  chunk: string,
  state: StreamProcessState,
  options: Pick<RunSteamCmdOptions, 'onOutput' | 'abortPattern'>
): StreamProcessState {
  const text = state.buffered + chunk;
  const parts = text.split(/\r?\n|\r/g);
  const nextBuffered = parts.pop() ?? '';
  let aborted = state.aborted;

  for (const part of parts) {
    const trimmed = part.trim();
    if (!trimmed) continue;
    options.onOutput?.(trimmed);
    if (options.abortPattern && !aborted && options.abortPattern.test(trimmed)) {
      aborted = true;
    }
  }

  return {
    buffered: nextBuffered,
    aborted,
  };
}

export function flushSteamCmdOutputBuffer(
  state: StreamProcessState,
  options: Pick<RunSteamCmdOptions, 'onOutput' | 'abortPattern'>
): StreamProcessState {
  const trimmed = state.buffered.trim();
  if (!trimmed) {
    return { ...state, buffered: '' };
  }

  options.onOutput?.(trimmed);
  return {
    buffered: '',
    aborted: state.aborted || Boolean(options.abortPattern?.test(trimmed)),
  };
}

export function runSteamCmd(
  steamcmdPath: string,
  args: string[],
  options?: RunSteamCmdOptions | ((line: string) => void)
): Promise<SteamCmdResult> {
  // Support legacy signature: runSteamCmd(path, args, onOutput)
  const opts: RunSteamCmdOptions = typeof options === 'function'
    ? { onOutput: options }
    : options ?? {};

  const timeoutMs = opts.timeoutMs ?? 120_000; // 2 min default

  return new Promise((resolve, reject) => {
    const proc = spawn(steamcmdPath, args, {
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    // Close stdin immediately so SteamCMD doesn't block waiting for input.
    // If it needs Steam Guard, it will exit with an error we can detect.
    proc.stdin.end();

    let stdout = '';
    let stderr = '';
    let timedOut = false;
    let aborted = false;
    let stdoutState: StreamProcessState = { buffered: '', aborted: false };
    let stderrState: StreamProcessState = { buffered: '', aborted: false };

    const timer = setTimeout(() => {
      timedOut = true;
      proc.kill('SIGTERM');
    }, timeoutMs);

    proc.stdout.on('data', (data: Buffer) => {
      const text = data.toString();
      stdout += text;
      opts.onRawOutput?.(text);
      stdoutState = processSteamCmdOutputChunk(text, stdoutState, opts);
      if (!aborted && stdoutState.aborted) {
        aborted = true;
        proc.kill('SIGTERM');
      }
    });

    proc.stderr.on('data', (data: Buffer) => {
      const text = data.toString();
      stderr += text;
      opts.onRawOutput?.(text);
      stderrState = processSteamCmdOutputChunk(text, stderrState, opts);
      if (!aborted && stderrState.aborted) {
        aborted = true;
        proc.kill('SIGTERM');
      }
    });

    proc.on('close', (code) => {
      clearTimeout(timer);
      stdoutState = flushSteamCmdOutputBuffer(stdoutState, opts);
      stderrState = flushSteamCmdOutputBuffer(stderrState, opts);
      if (timedOut) {
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + '\n[boiler] SteamCMD timed out after ' + (timeoutMs / 1000) + 's',
        });
      } else {
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
  });
}

export function parseBuildId(output: string): string | null {
  // SteamCMD outputs something like: "Successfully finished appID=480 (BuildID 12345)"
  const match = output.match(/BuildID\s+(\d+)/i);
  return match ? match[1] : null;
}

export function parseUploadProgress(line: string): number | null {
  // Look for percentage patterns in SteamCMD output
  const match = line.match(/(\d+(?:\.\d+)?)\s*%/);
  return match ? parseFloat(match[1]) : null;
}

export function isLoginFailure(output: string): boolean {
  return /Login Failure|FAILED.*login|Invalid Password/i.test(output);
}

export function isRateLimited(output: string): boolean {
  return /Rate Limit Exceeded/i.test(output);
}

export function needsSteamGuard(output: string): boolean {
  return STEAM_GUARD_PROMPT_RE.test(output);
}

export function isSuccessfulLogin(output: string): boolean {
  return LOGGED_IN_RE.test(output);
}

export function isSuccessfulBuild(output: string): boolean {
  return /Successfully finished/i.test(output);
}

export function classifyCachedLoginProbe(result: SteamCmdResult): CachedLoginProbeResult {
  const output = result.stdout + result.stderr;

  if (isSuccessfulLogin(output)) {
    return {
      status: 'valid',
      message: 'Cached Steam login is valid.',
      output,
    };
  }

  if (isRateLimited(output)) {
    return {
      status: 'rate_limited',
      message: 'Steam is rate limiting login checks right now.',
      output,
    };
  }

  if (output.includes('timed out')) {
    return {
      status: 'timeout',
      message: 'SteamCMD timed out while checking cached login.',
      output,
    };
  }

  if (needsSteamGuard(output) || isLoginFailure(output) || PASSWORD_PROMPT_RE.test(output)) {
    return {
      status: 'missing',
      message: 'Cached Steam login is missing or expired. Run `boiler login` again.',
      output,
    };
  }

  return {
    status: 'unknown',
    message: `SteamCMD returned exit code ${result.exitCode} without a clear login result.`,
    output,
  };
}

export async function probeCachedLogin(steamcmdPath: string, username: string): Promise<CachedLoginProbeResult> {
  const result = await runSteamCmd(
    steamcmdPath,
    ['+login', username, '+quit'],
    {
      timeoutMs: 120_000,
      abortPattern: new RegExp(`${STEAM_GUARD_PROMPT_RE.source}|${PASSWORD_PROMPT_RE.source}`, 'i'),
    }
  );

  return classifyCachedLoginProbe(result);
}
