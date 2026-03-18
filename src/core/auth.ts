import inquirer from 'inquirer';
import { runSteamCmd, isLoginFailure, isRateLimited, isSuccessfulLogin } from './steamcmd.js';
import { loadGlobalConfig, updateGlobalConfig } from './config.js';
import * as logger from '../util/logger.js';

export interface LoginResult {
  success: boolean;
  username: string;
  message: string;
}

export interface LoginOptions {
  username?: string;
  password?: string;
  guardCode?: string;
  nonInteractive?: boolean;
}

// SteamCMD auth prompt patterns
const STEAM_GUARD_EMAIL_RE = /check your email|enter the Steam Guard code from that message/i;
const STEAM_GUARD_MOBILE_APPROVAL_RE = /confirm the login in the Steam Mobile app|Waiting for confirmation|Steam Guard mobile authenticator/i;
const STEAM_GUARD_MOBILE_CODE_RE = /Two-factor code|6-digit code/i;
const STEAM_GUARD_ANY_RE = /Steam Guard|Two-factor|two factor|enter.*code|Waiting for confirmation|confirm the login/i;

function failLogin(username: string, message: string): LoginResult {
  return {
    success: false,
    username,
    message,
  };
}

export async function login(steamcmdPath: string, options: LoginOptions = {}): Promise<LoginResult> {
  const savedUsername = loadGlobalConfig().username;
  let username = options.username?.trim() || savedUsername || undefined;

  if (!username) {
    if (options.nonInteractive) {
      return failLogin('', 'Steam username is required in non-interactive mode. Pass `--username` or set `EASY_STEAM_USERNAME`.');
    }

    const answers = await inquirer.prompt([
      {
        type: 'input',
        name: 'username',
        message: 'Steam username:',
        default: savedUsername ?? undefined,
        validate: (v: string) => v.length > 0 || 'Username is required',
      },
    ]);
    username = (answers.username as string).trim();
  }

  let password = options.password;
  if (!password) {
    if (options.nonInteractive) {
      return failLogin(username, 'Steam password is required in non-interactive mode. Use `--password-env` or set `EASY_STEAM_PASSWORD`.');
    }

    const answers = await inquirer.prompt([
      {
        type: 'password',
        name: 'password',
        message: 'Steam password:',
        mask: '*',
        validate: (v: string) => v.length > 0 || 'Password is required',
      },
    ]);
    password = answers.password as string;
  }

  const spin = logger.spinner('Logging in to Steam...');
  spin.start();
  let showedMobileApprovalHint = false;

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
      } else if (STEAM_GUARD_MOBILE_APPROVAL_RE.test(line)) {
        spin.text = 'Approve the login in the Steam Mobile app on your phone...';
        if (!showedMobileApprovalHint) {
          logger.info('Steam is waiting for approval in the Steam Mobile app.');
          logger.dim('  Open Steam on your phone and approve the login request.');
          showedMobileApprovalHint = true;
        }
      } else if (/Logging in user/i.test(line)) {
        spin.text = 'Logging in — if prompted, approve the login on your Steam mobile app...';
      }
    },
  });

  let combined = result.stdout + result.stderr;
  let loginSucceeded = isSuccessfulLogin(combined) || result.exitCode === 0;

  // Check if Steam Guard is required
  if (STEAM_GUARD_ANY_RE.test(combined) && !loginSucceeded) {
    const needsMobileApproval = STEAM_GUARD_MOBILE_APPROVAL_RE.test(combined);
    const needsMobileCode = STEAM_GUARD_MOBILE_CODE_RE.test(combined);
    const needsEmailCode = STEAM_GUARD_EMAIL_RE.test(combined);

    if (needsMobileApproval && !needsMobileCode && !needsEmailCode) {
      if (combined.includes('timed out')) {
        spin.fail('Login approval timed out');
        return failLogin(
          username,
          'SteamCMD timed out waiting for approval in the Steam Mobile app. Approve the login on your phone and try again.'
        );
      }

      spin.fail('Login approval required');
      return failLogin(
        username,
        'Steam is waiting for approval in the Steam Mobile app. Open Steam on your phone and approve the login request.'
      );
    }

    spin.stop();
    const isMobileAuth = needsMobileCode;

    if (isMobileAuth) {
      logger.info('Steam Guard Mobile Authenticator code required.');
      logger.dim('  Open your Steam app → Steam Guard → enter the 6-digit code below.');
      logger.dim('  (The phone push notification is for the Steam client, not SteamCMD.)');
    } else {
      logger.info('Steam Guard code required. Check your email for the code.');
    }

    let guardCode = options.guardCode?.trim();
    if (!guardCode) {
      if (options.nonInteractive) {
        spin.fail('Steam Guard code required');
        return failLogin(
          username,
          'Steam Guard code is required in non-interactive mode. Use `--guard-code-env` or set `EASY_STEAM_GUARD_CODE`.'
        );
      }

      const answers = await inquirer.prompt([
        {
          type: 'input',
          name: 'guardCode',
          message: isMobileAuth ? 'Steam Guard code (from app):' : 'Steam Guard code (from email):',
          validate: (v: string) => v.length > 0 || 'Code is required',
        },
      ]);
      guardCode = (answers.guardCode as string).trim();
    }

    spin.start('Logging in with Steam Guard code...');
    result = await runSteamCmd(steamcmdPath, [
      '+set_steam_guard_code', guardCode,
      '+login', username, password,
      '+quit',
    ], { timeoutMs: 120_000 });
    combined = result.stdout + result.stderr;
    loginSucceeded = isSuccessfulLogin(combined) || result.exitCode === 0;
  }

  if (isRateLimited(combined)) {
    spin.fail('Rate limited by Steam');
    return failLogin(username, 'Too many login attempts. Wait 15-30 minutes before trying again.');
  }

  if (isLoginFailure(combined)) {
    spin.fail('Login failed');
    return failLogin(username, 'Invalid credentials or incorrect Steam Guard code. Please try again.');
  }

  if (loginSucceeded) {
    updateGlobalConfig({ username });
    spin.succeed(`Logged in as ${username}`);
    logger.dim('  Credentials cached — future logins from this machine won\'t need a code.');
    return { success: true, username, message: 'Login successful' };
  }

  spin.fail('Login failed');
  if (combined.includes('timed out')) {
    if (STEAM_GUARD_MOBILE_APPROVAL_RE.test(combined)) {
      return failLogin(
        username,
        'SteamCMD timed out waiting for approval in the Steam Mobile app. Approve the login on your phone and try again.'
      );
    }
    return failLogin(username, 'SteamCMD timed out. It may still be updating — try again.');
  }

  return failLogin(username, `Unexpected SteamCMD output (exit code ${result.exitCode}). Run SteamCMD manually to debug.`);
}

export function isLoggedIn(): boolean {
  const config = loadGlobalConfig();
  return config.username !== null;
}

export function getUsername(): string | null {
  return loadGlobalConfig().username;
}
