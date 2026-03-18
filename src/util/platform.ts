import { platform } from 'os';
import { resolve, sep } from 'path';

export function isWindows(): boolean {
  return platform() === 'win32';
}

export function isMac(): boolean {
  return platform() === 'darwin';
}

export function isLinux(): boolean {
  return platform() === 'linux';
}

export function steamcmdBinary(): string {
  return isWindows() ? 'steamcmd.exe' : 'steamcmd.sh';
}

export function steamcmdDownloadUrl(): string {
  if (isWindows()) {
    return 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd.zip';
  }
  if (isMac()) {
    return 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_osx.tar.gz';
  }
  return 'https://steamcdn-a.akamaihd.net/client/installer/steamcmd_linux.tar.gz';
}

export function toVdfPath(p: string): string {
  return resolve(p).split(sep).join(isWindows() ? '\\' : '/');
}

export function commonSteamcmdLocations(): string[] {
  if (isWindows()) {
    return [
      'C:\\steamcmd',
      'C:\\SteamCMD',
      'C:\\Program Files\\steamcmd',
      'C:\\Program Files (x86)\\steamcmd',
    ];
  }
  if (isMac()) {
    return [
      '/usr/local/bin',
      '/opt/homebrew/bin',
      `${process.env.HOME}/steamcmd`,
    ];
  }
  return [
    '/usr/local/bin',
    '/usr/bin',
    `${process.env.HOME}/steamcmd`,
    '/opt/steamcmd',
  ];
}
