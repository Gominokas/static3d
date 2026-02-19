export interface DeployConfig {
  pages: {
    outputDir: string;
    customDomain?: string;
  };
  cdn: {
    provider: 'cloudflare-r2';
    bucket: string;
    baseUrl: string;
    region?: string;
  };
  assets: {
    immediateDir: string;
    deferredDir: string;
    hashLength?: number;
    maxFileSize?: string;
    ignore?: string[];
    include?: string[];
  };
  oldVersionRetention?: number;
  oldVersionMaxAge?: string;
}

export interface DisplayConfig {
  loader: {
    concurrency?: number;
    retryCount?: number;
    retryBaseDelay?: number;
    timeout?: number;
  };
}

export interface DraftConfig {
  preview: {
    expiresIn?: string;
  };
}

export interface Static3dConfig {
  schemaVersion: 1;
  project: string;
  deploy?: DeployConfig;
  display?: DisplayConfig;
  draft?: DraftConfig;
}
