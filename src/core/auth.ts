import inquirer from 'inquirer';
import { runSteamCmd, isLoginFailure, isRateLimited } from './steamcmd.js';
import { loadGlobalConfig, updateGlobalConfig } from './config.js';
import * as logger from '../util/logger.js';

export interface LoginResult {
  success: boolean;
  username: string;
  message: string;
}

// SteamCMD auth prompt patterns
const STEAM_GUARD_EMAIL_RE = /check your email|enter the Steam Guard code from that message/i;
const STEAM_GUARD_MOBILE_RE = /Mobile Authenticator|Two-factor code/i;
const STEAM_GUARD_ANY_RE = /Steam Guard|Two-factor|two factor|enter.*code/i;
const LOGGED_IN_RE = /Logged in OK|logged in|Login Success/i;

export async function login(steamcmdPath: string, username?: string): Promise<LoginResult> {
  if (!username) {
    const saved = loadGlobalConfig().username;
    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'username',
        message: 'Steam username:',
        default: saved ?? undefined,
        validate: (v: string) => v.length > 0 || 'Username is required',
      },
    ]);
    username = answers.username as string;
  }

  const { password } = await inquirer.prompt([
    {
      type: 'password',
      name: 'password',
      message: 'Steam password:',
      mask: '*',
      validate: (v: string) => v.length > 0 || 'Password is required',
    },
  ]);

  const spin = logger.spinner('Logging in to Steam...');
  spin.start();

  // Attempt login. SteamCMD will exit when it needs a Steam Guard code
  // because we close stdin. We detect the type of code needed from the output.
  let result = await runSteamCmd(steamcmdPath, [
    '+login', username, password,
    '+quit',
  ], {
    timeoutMs: 300_000,
    onOutput: (line) => {
      if (/update|download|install|extract|verify/i.test(line)) {
        spin.text = line.length > 60 ? line.slice(0, 60) + '...' : line;
      } else if (/Logging in user/i.test(line)) {
        spin.text = 'Logging in — if prompted, approve the login on your Steam mobile app...';
      }
    },
  });

  let combined = result.stdout + result.stderr;

  // Check if Steam Guard is required
  if (STEAM_GUARD_ANY_RE.test(combined) && !LOGGED_IN_RE.test(combined)) {
    spin.stop();

    const isMobileAuth = STEAM_GUARD_MOBILE_RE.test(combined);

    if (isMobileAuth) {
      logger.info('Steam Guard Mobile Authenticator code required.');
      logger.dim('  Open your Steam app → Steam Guard → enter the 6-digit code below.');
      logger.dim('  (The phone push notification is for the Steam client, not SteamCMD.)');
    } else {
      logger.info('Steam Guard code required. Check your email for the code.');
    }

    const { guardCode } = await inquirer.prompt([
      {
        type: 'input',
        name: 'guardCode',
        message: isMobileAuth ? 'Steam Guard code (from app):' : 'Steam Guard code (from email):',
        validate: (v: string) => v.length > 0 || 'Code is required',
      },
    ]);

    spin.start('Logging in with Steam Guard code...');
    result = await runSteamCmd(steamcmdPath, [
      '+set_steam_guard_code', guardCode,
      '+login', username, password,
      '+quit',
    ], { timeoutMs: 120_000 });
    combined = result.stdout + result.stderr;
  }

  if (isRateLimited(combined)) {
    spin.fail('Rate limited by Steam');
    return {
      success: false,
      username,
      message: 'Too many login attempts. Wait 15-30 minutes before trying again.',
    };
  }

  if (isLoginFailure(combined)) {
    spin.fail('Login failed');
    return {
      success: false,
      username,
      message: 'Invalid credentials or incorrect Steam Guard code. Please try again.',
    };
  }

  if (LOGGED_IN_RE.test(combined) || result.exitCode === 0) {
    updateGlobalConfig({ username });
    spin.succeed(`Logged in as ${username}`);
    logger.dim('  Credentials cached — future logins from this machine won\'t need a code.');
    return { success: true, username, message: 'Login successful' };
  }

  spin.fail('Login failed');
  if (combined.includes('timed out')) {
    return {
      success: false,
      username,
      message: 'SteamCMD timed out. It may still be updating — try again.',
    };
  }

  return {
    success: false,
    username,
    message: `Unexpected SteamCMD output (exit code ${result.exitCode}). Run SteamCMD manually to debug.`,
  };
}

export function isLoggedIn(): boolean {
  const config = loadGlobalConfig();
  return config.username !== null;
}

export function getUsername(): string | null {
  return loadGlobalConfig().username;
}
