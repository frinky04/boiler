import { ensureSteamCmd } from '../core/steamcmd.js';
import { login } from '../core/auth.js';
import * as logger from '../util/logger.js';

export async function loginCommand(): Promise<void> {
  const steamcmdPath = await ensureSteamCmd();
  logger.dim(`  Using SteamCMD: ${steamcmdPath}`);

  const result = await login(steamcmdPath);

  if (!result.success) {
    logger.error(result.message);
    process.exit(1);
  }
}
