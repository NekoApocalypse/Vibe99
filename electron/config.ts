import fs from 'node:fs';
import path from 'node:path';

export type UiConfig = {
  fontSize: number;
  paneOpacity: number;
  paneWidth: number;
};

export type AppConfigV1 = {
  version: 1;
  ui: UiConfig;
};

export type AppConfig = AppConfigV1;

type LegacyFlatSettings = Partial<UiConfig> & {
  version?: undefined;
  ui?: undefined;
};

type UnknownConfig = Partial<AppConfig> | LegacyFlatSettings | null | undefined;

export const CURRENT_CONFIG_VERSION = 1;

export const DEFAULT_CONFIG: AppConfig = Object.freeze({
  version: CURRENT_CONFIG_VERSION,
  ui: {
    fontSize: 13,
    paneOpacity: 0.8,
    paneWidth: 720,
  },
});

function sanitizeUiConfig(candidate: Partial<UiConfig> | undefined): UiConfig {
  const ui = candidate ?? {};

  const fontSize =
    typeof ui.fontSize === 'number' && Number.isFinite(ui.fontSize)
      ? ui.fontSize
      : DEFAULT_CONFIG.ui.fontSize;
  const paneOpacity =
    typeof ui.paneOpacity === 'number' && Number.isFinite(ui.paneOpacity)
      ? ui.paneOpacity
      : DEFAULT_CONFIG.ui.paneOpacity;
  const paneWidth =
    typeof ui.paneWidth === 'number' && Number.isFinite(ui.paneWidth)
      ? ui.paneWidth
      : DEFAULT_CONFIG.ui.paneWidth;

  return {
    fontSize: Math.max(10, Math.min(24, Math.round(fontSize))),
    paneOpacity: Math.max(0.55, Math.min(1, Number(paneOpacity.toFixed(2)))),
    paneWidth: Math.max(520, Math.min(1000, Math.round(paneWidth / 10) * 10)),
  };
}

export function sanitizeConfig(candidate: UnknownConfig): AppConfig {
  if (candidate && typeof candidate === 'object' && candidate.version === CURRENT_CONFIG_VERSION) {
    return {
      version: CURRENT_CONFIG_VERSION,
      ui: sanitizeUiConfig(candidate.ui),
    };
  }

  if (candidate && typeof candidate === 'object') {
    return {
      version: CURRENT_CONFIG_VERSION,
      ui: sanitizeUiConfig(candidate as LegacyFlatSettings),
    };
  }

  return {
    version: CURRENT_CONFIG_VERSION,
    ui: { ...DEFAULT_CONFIG.ui },
  };
}

export function loadConfig(configPath: string): AppConfig {
  try {
    const fileContents = fs.readFileSync(configPath, 'utf8');
    return sanitizeConfig(JSON.parse(fileContents) as UnknownConfig);
  } catch {
    return {
      version: CURRENT_CONFIG_VERSION,
      ui: { ...DEFAULT_CONFIG.ui },
    };
  }
}

export function saveConfig(configPath: string, nextConfig: UnknownConfig): AppConfig {
  const sanitizedConfig = sanitizeConfig(nextConfig);
  fs.mkdirSync(path.dirname(configPath), { recursive: true });
  fs.writeFileSync(configPath, JSON.stringify(sanitizedConfig, null, 2));
  return sanitizedConfig;
}
