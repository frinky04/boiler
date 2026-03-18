export interface DepotConfig {
  depotId: number;
  contentRoot: string;
  fileMapping: {
    localPath: string;
    depotPath: string;
    recursive: boolean;
  };
  fileExclusions: string[];
}

export interface ProjectConfig {
  appId: number;
  depots: DepotConfig[];
  buildOutput: string;
  setLive: string | null;
}

export interface GlobalConfig {
  steamcmdPath: string | null;
  username: string | null;
}

export interface AppBuildVdfConfig {
  appId: number;
  description: string;
  contentRoot: string;
  buildOutput: string;
  setLive?: string | null;
  depots: DepotConfig[];
}

export interface PushOptions {
  folder?: string;
  app?: number;
  depot?: number;
  desc?: string;
  setLive?: string;
  dryRun?: boolean;
}

export interface LastPush {
  timestamp: string;
  buildId: string | null;
  description: string;
  appId: number;
  success: boolean;
}
