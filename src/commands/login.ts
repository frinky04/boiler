import { ensureSteamCmd } from '../core/steamcmd.js';
import { login, type LoginOptions } from '../core/auth.js';
import * as logger from '../util/logger.js';

export interface LoginCommandOptions {
  username?: string;
  passwordEnv?: string;
  guardCodeEnv?: string;
  nonInteractive?: boolean;
}

function readEnvSecret(envVar: string | undefined, env: NodeJS.ProcessEnv, label: string): string | undefined {
  if (!envVar) {
    return undefined;
  }

  const value = env[envVar];
  if (!value) {
    throw new Error(`Environment variable ${envVar} is not set for ${label}.`);
  }

  return value;
}

function parseBooleanEnv(value: string | undefined): boolean {
  return value !== undefined && /^(1|true|yes)$/i.test(value);
}

export function resolveLoginOptions(
  options: LoginCommandOptions,
  env: NodeJS.ProcessEnv = process.env
): LoginOptions {
  return {
    username: options.username ?? env.BOILER_USERNAME,
    password: readEnvSecret(options.passwordEnv, env, 'Steam password') ?? env.BOILER_PASSWORD,
    guardCode: readEnvSecret(options.guardCodeEnv, env, 'Steam Guard code') ?? env.BOILER_GUARD_CODE,
    nonInteractive: Boolean(options.nonInteractive || parseBooleanEnv(env.BOILER_NON_INTERACTIVE)),
  };
}

export async function loginCommand(options: LoginCommandOptions = {}): Promise<void> {
  const steamcmdPath = await ensureSteamCmd();
  logger.dim(`  Using SteamCMD: ${steamcmdPath}`);

  let loginOptions: LoginOptions;
  try {
    loginOptions = resolveLoginOptions(options);
  } catch (err) {
    logger.error(err instanceof Error ? err.message : String(err));
    process.exit(1);
  }

  const result = await login(steamcmdPath, loginOptions);

  if (!result.success) {
    logger.error(result.message);
    process.exit(1);
  }
}
