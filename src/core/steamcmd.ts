import { spawn } from 'child_process';
import { existsSync, mkdirSync, createWriteStream } from 'fs';
import { join } from 'path';
import which from 'which';
import { steamcmdBinary, commonSteamcmdLocations, steamcmdDownloadUrl } from '../util/platform.js';
import { loadGlobalConfig, updateGlobalConfig, getGlobalDir } from './config.js';
import * as logger from '../util/logger.js';

export interface SteamCmdResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

const UPLOAD_PROGRESS_PATTERN = /(\d+(?:[\.,]\d+)?)\s*%/;
const UPLOAD_PROGRESS_TAIL_LENGTH = 32;

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

    await downloadArchiveWithProgress(response, archivePath, spin);

    spin.text = 'Extracting SteamCMD...';

    await extractArchiveWithFallback(archivePath, installDir, isZip);

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

function formatBytes(bytes: number): string {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unitIndex = 0;
  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }
  return `${value.toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

async function downloadArchiveWithProgress(response: Response, archivePath: string, spin: ReturnType<typeof logger.spinner>): Promise<void> {
  if (!response.body) {
    throw new Error('SteamCMD download returned no response body.');
  }

  const totalBytes = Number(response.headers.get('content-length') ?? 0);
  const fileStream = createWriteStream(archivePath);
  const reader = response.body.getReader();
  let downloadedBytes = 0;
  let lastRenderedAt = 0;

  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;

      downloadedBytes += value.byteLength;
      if (!fileStream.write(value)) {
        await new Promise<void>((resolve) => fileStream.once('drain', resolve));
      }

      const now = Date.now();
      if (now - lastRenderedAt >= 200) {
        if (totalBytes > 0) {
          const percent = ((downloadedBytes / totalBytes) * 100).toFixed(1);
          spin.text = `Downloading SteamCMD... ${percent}% (${formatBytes(downloadedBytes)} / ${formatBytes(totalBytes)})`;
        } else {
          spin.text = `Downloading SteamCMD... ${formatBytes(downloadedBytes)}`;
        }
        lastRenderedAt = now;
      }
    }
  } catch (err) {
    fileStream.destroy(err instanceof Error ? err : undefined);
    throw err;
  }

  await new Promise<void>((resolve, reject) => {
    fileStream.once('error', reject);
    fileStream.end(() => resolve());
  });
}

interface ExtractionAttempt {
  command: string;
  args: string[];
  label: string;
}

function buildExtractionAttempts(archivePath: string, installDir: string, isZip: boolean): ExtractionAttempt[] {
  if (isZip) {
    return [
      {
        command: 'powershell',
        args: ['-Command', `Expand-Archive -Path '${archivePath}' -DestinationPath '${installDir}' -Force`],
        label: 'PowerShell Expand-Archive',
      },
      {
        command: 'tar',
        args: ['-xf', archivePath, '-C', installDir],
        label: 'tar',
      },
      {
        command: 'unzip',
        args: ['-o', archivePath, '-d', installDir],
        label: 'unzip',
      },
    ];
  }

  return [
    {
      command: 'tar',
      args: ['-xzf', archivePath, '-C', installDir],
      label: 'tar',
    },
    {
      command: 'python',
      args: ['-c', `import tarfile; tarfile.open(r"${archivePath}", "r:gz").extractall(r"${installDir}")`],
      label: 'python tarfile',
    },
    {
      command: 'python3',
      args: ['-c', `import tarfile; tarfile.open(r"${archivePath}", "r:gz").extractall(r"${installDir}")`],
      label: 'python3 tarfile',
    },
  ];
}

async function extractArchiveWithFallback(archivePath: string, installDir: string, isZip: boolean): Promise<void> {
  const attempts = buildExtractionAttempts(archivePath, installDir, isZip);
  const failures: string[] = [];

  for (const attempt of attempts) {
    try {
      logger.verbose(`Extracting with ${attempt.label}...`);
      await runCommand(attempt.command, attempt.args);
      return;
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      logger.debug(`Extraction failed via ${attempt.label}: ${message}`);
      failures.push(`${attempt.label}: ${message}`);
    }
  }

  throw new Error(`Failed to extract SteamCMD archive. Attempts: ${failures.join(' | ')}`);
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

export interface RetrySteamCmdOptions {
  maxAttempts?: number;
  initialDelayMs?: number;
  backoffMultiplier?: number;
  shouldRetry?: (result: SteamCmdResult) => boolean;
  onRetry?: (context: SteamCmdRetryContext) => void;
  sleep?: (ms: number) => Promise<void>;
}

export interface SteamCmdRetryContext {
  attempt: number;
  maxAttempts: number;
  delayMs: number;
  reason: string;
  result: SteamCmdResult;
}

export interface CachedLoginProbeResult {
  status: 'valid' | 'missing' | 'rate_limited' | 'timeout' | 'unknown';
  message: string;
  output: string;
}

export type SteamCmdFailureCategory =
  | 'auth'
  | 'rate_limit'
  | 'network'
  | 'content'
  | 'disk'
  | 'depot_lock'
  | 'manifest'
  | 'timeout'
  | 'unknown';

export interface SteamCmdFailureInfo {
  category: SteamCmdFailureCategory;
  summary: string;
  guidance: string;
  retriable: boolean;
  matchedPattern?: string;
}

const LOGGED_IN_RE = /Logged in OK|Waiting for user info\.\.\.OK|Login Success/i;
const PASSWORD_PROMPT_RE = /password:/i;
const STEAM_GUARD_PROMPT_RE = /Steam Guard|Two-factor|two factor|confirm the login in the Steam Mobile app|Waiting for confirmation|Steam Guard mobile authenticator/i;
const RETRIABLE_STEAMCMD_ERRORS: Array<{ reason: string; pattern: RegExp }> = [
  { reason: 'timeout', pattern: /timed out|timeout/i },
  { reason: 'network error', pattern: /connection (?:timed out|reset|closed)|network error|failed to connect|unable to connect|temporary failure/i },
  { reason: 'steam service unavailable', pattern: /content server.*unavailable|service unavailable|server is busy|try again later/i },
  { reason: 'steam http error', pattern: /http.*\b(429|500|502|503|504)\b/i },
  { reason: 'depot lock conflict', pattern: /depot.*locked|another build is in progress/i },
];
const STEAMCMD_FAILURE_PATTERNS: Array<{
  category: Exclude<SteamCmdFailureCategory, 'auth' | 'rate_limit' | 'timeout' | 'unknown'>;
  pattern: RegExp;
  summary: string;
  guidance: string;
  retriable: boolean;
}> = [
  {
    category: 'network',
    pattern: /failed to connect|unable to connect|network error|connection (?:timed out|reset|closed)|service unavailable|server is busy|http.*\b(429|500|502|503|504)\b/i,
    summary: 'network/service error',
    guidance: 'Steam network services look unavailable. Retry in a few minutes.',
    retriable: true,
  },
  {
    category: 'disk',
    pattern: /no space left on device|disk full|not enough disk space|insufficient disk space|failed writing/i,
    summary: 'disk space error',
    guidance: 'Free disk space on the machine running SteamCMD and retry.',
    retriable: false,
  },
  {
    category: 'depot_lock',
    pattern: /depot.*locked|another build is in progress|conflict.*depot/i,
    summary: 'depot lock conflict',
    guidance: 'Another upload appears to be using this depot. Wait for it to finish and retry.',
    retriable: true,
  },
  {
    category: 'manifest',
    pattern: /manifest.*invalid|failed to get manifest|failed to load script|invalid app build|invalid depot build/i,
    summary: 'manifest/build script error',
    guidance: 'Generated VDF or build metadata appears invalid. Validate config and VDF output, then retry.',
    retriable: false,
  },
  {
    category: 'content',
    pattern: /content root|file not found|unable to read|failed to open|invalid path|path does not exist/i,
    summary: 'content path error',
    guidance: 'One or more content paths are invalid or unreadable. Fix project paths and retry.',
    retriable: false,
  },
];

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

function redactSteamCmdArgs(args: string[]): string[] {
  const redacted = [...args];

  for (let i = 0; i < redacted.length; i++) {
    const token = redacted[i];
    if (token === '+set_steam_guard_code' && i + 1 < redacted.length) {
      redacted[i + 1] = '***';
    }

    if (token === '+login') {
      const passwordIndex = i + 2;
      if (
        passwordIndex < redacted.length &&
        !redacted[passwordIndex].startsWith('+') &&
        passwordIndex + 1 <= redacted.length
      ) {
        redacted[passwordIndex] = '***';
      }
    }
  }

  return redacted;
}

function formatSteamCmdCommandForLog(steamcmdPath: string, args: string[]): string {
  const renderedArgs = redactSteamCmdArgs(args).map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg)).join(' ');
  return `${steamcmdPath} ${renderedArgs}`.trim();
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
  const startedAt = Date.now();
  logger.debug(`SteamCMD exec: ${formatSteamCmdCommandForLog(steamcmdPath, args)}`);

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
        logger.debug(`SteamCMD exec finished with timeout after ${Date.now() - startedAt}ms`);
        resolve({
          exitCode: 1,
          stdout,
          stderr: stderr + '\n[boiler] SteamCMD timed out after ' + (timeoutMs / 1000) + 's',
        });
      } else {
        logger.debug(`SteamCMD exec finished with exit code ${code ?? 1} after ${Date.now() - startedAt}ms`);
        resolve({ exitCode: code ?? 1, stdout, stderr });
      }
    });

    proc.on('error', (err) => {
      clearTimeout(timer);
      logger.debug(`SteamCMD process error after ${Date.now() - startedAt}ms: ${err.message}`);
      reject(err);
    });
  });
}

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function getRetriableSteamCmdReason(output: string): string | null {
  for (const rule of RETRIABLE_STEAMCMD_ERRORS) {
    if (rule.pattern.test(output)) {
      return rule.reason;
    }
  }

  return null;
}

export function isRetriableSteamCmdOutput(output: string): boolean {
  return getRetriableSteamCmdReason(output) !== null;
}

export function isRetriableSteamCmdResult(result: SteamCmdResult): boolean {
  const output = result.stdout + result.stderr;

  if (result.exitCode === 0 && !/timed out|timeout/i.test(output)) {
    return false;
  }

  if (isLoginFailure(output) || needsSteamGuard(output) || isRateLimited(output)) {
    return false;
  }

  return isRetriableSteamCmdOutput(output);
}

export async function retrySteamCmdExecution(
  runAttempt: () => Promise<SteamCmdResult>,
  options: RetrySteamCmdOptions = {}
): Promise<SteamCmdResult> {
  const maxAttempts = Math.max(1, options.maxAttempts ?? 3);
  const initialDelayMs = Math.max(0, options.initialDelayMs ?? 1_000);
  const backoffMultiplier = Math.max(1, options.backoffMultiplier ?? 2);
  const shouldRetry = options.shouldRetry ?? isRetriableSteamCmdResult;
  const sleep = options.sleep ?? wait;

  let delayMs = initialDelayMs;
  let lastResult: SteamCmdResult | null = null;

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const result = await runAttempt();
    lastResult = result;

    if (attempt === maxAttempts || !shouldRetry(result)) {
      return result;
    }

    const output = result.stdout + result.stderr;
    options.onRetry?.({
      attempt,
      maxAttempts,
      delayMs,
      reason: getRetriableSteamCmdReason(output) ?? `exit code ${result.exitCode}`,
      result,
    });

    await sleep(delayMs);
    delayMs = Math.round(delayMs * backoffMultiplier);
  }

  return lastResult ?? { exitCode: 1, stdout: '', stderr: '' };
}

export async function runSteamCmdWithRetry(
  steamcmdPath: string,
  args: string[],
  runOptions: RunSteamCmdOptions | ((line: string) => void) | undefined,
  retryOptions: RetrySteamCmdOptions = {}
): Promise<SteamCmdResult> {
  return retrySteamCmdExecution(
    () => runSteamCmd(steamcmdPath, args, runOptions),
    retryOptions
  );
}

export function classifySteamCmdFailure(output: string, exitCode: number = 1): SteamCmdFailureInfo {
  if (isRateLimited(output)) {
    return {
      category: 'rate_limit',
      summary: 'rate limited by Steam',
      guidance: 'Too many login attempts were detected. Wait 15-30 minutes and retry.',
      retriable: true,
      matchedPattern: 'Rate Limit Exceeded',
    };
  }

  if (isLoginFailure(output) || needsSteamGuard(output) || PASSWORD_PROMPT_RE.test(output)) {
    return {
      category: 'auth',
      summary: 'authentication failed',
      guidance: 'Cached credentials may be expired. Run `boiler login` and retry.',
      retriable: false,
      matchedPattern: 'login/Steam Guard prompt',
    };
  }

  if (/timed out|timeout/i.test(output)) {
    return {
      category: 'timeout',
      summary: 'SteamCMD timed out',
      guidance: 'Steam may be slow or unavailable. Retry shortly.',
      retriable: true,
      matchedPattern: 'timed out',
    };
  }

  for (const failure of STEAMCMD_FAILURE_PATTERNS) {
    if (failure.pattern.test(output)) {
      return {
        category: failure.category,
        summary: failure.summary,
        guidance: failure.guidance,
        retriable: failure.retriable,
        matchedPattern: failure.pattern.source,
      };
    }
  }

  return {
    category: 'unknown',
    summary: `upload failed (exit code ${exitCode})`,
    guidance: 'SteamCMD returned an unclassified error. Check last-error.log for raw output details.',
    retriable: false,
  };
}

export function parseBuildId(output: string): string | null {
  // SteamCMD outputs something like: "Successfully finished appID=480 (BuildID 12345)"
  const match = output.match(/BuildID\s+(\d+)/i);
  return match ? match[1] : null;
}

function toProgressNumber(value: string): number | null {
  const parsed = Number.parseFloat(value.replace(',', '.'));
  if (!Number.isFinite(parsed)) {
    return null;
  }

  if (parsed < 0 || parsed > 100) {
    return null;
  }

  return parsed;
}

export function parseUploadProgress(line: string): number | null {
  // Look for percentage patterns in SteamCMD output
  const match = line.match(UPLOAD_PROGRESS_PATTERN);
  if (!match) {
    return null;
  }

  return toProgressNumber(match[1]);
}

export function parseUploadProgressChunk(
  chunk: string,
  previousTail: string = ''
): { progress: number | null; tail: string } {
  const text = `${previousTail}${chunk}`;
  let progress: number | null = null;
  const matcher = new RegExp(UPLOAD_PROGRESS_PATTERN.source, 'g');

  let match: RegExpExecArray | null;
  while ((match = matcher.exec(text)) !== null) {
    const parsed = toProgressNumber(match[1]);
    if (parsed !== null) {
      progress = parsed;
    }
  }

  return {
    progress,
    tail: text.slice(-UPLOAD_PROGRESS_TAIL_LENGTH),
  };
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
