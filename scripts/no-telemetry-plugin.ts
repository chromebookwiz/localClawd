import type { BunPlugin } from 'bun'

const stubs: Record<string, string> = {
  'services/analytics/index': `
export function stripProtoFields(metadata) { return metadata; }
export function attachAnalyticsSink() {}
export function logEvent() {}
export async function logEventAsync() {}
export function _resetForTesting() {}
`,
  'services/analytics/growthbook': `
const noop = () => {};
export function onGrowthBookRefresh() { return noop; }
export function hasGrowthBookEnvOverride() { return false; }
export function getAllGrowthBookFeatures() { return {}; }
export function getGrowthBookConfigOverrides() { return {}; }
export function setGrowthBookConfigOverride() {}
export function clearGrowthBookConfigOverrides() {}
export function getApiBaseUrlHost() { return undefined; }
export const initializeGrowthBook = async () => null;
export async function getFeatureValue_DEPRECATED(feature, defaultValue) { return defaultValue; }
export function getFeatureValue_CACHED_MAY_BE_STALE(feature, defaultValue) { return defaultValue; }
export function getFeatureValue_CACHED_WITH_REFRESH(feature, defaultValue) { return defaultValue; }
export function checkStatsigFeatureGate_CACHED_MAY_BE_STALE() { return false; }
export async function checkSecurityRestrictionGate() { return false; }
export async function checkGate_CACHED_OR_BLOCKING() { return false; }
export function refreshGrowthBookAfterAuthChange() {}
export function resetGrowthBook() {}
export async function refreshGrowthBookFeatures() {}
export function setupPeriodicGrowthBookRefresh() {}
export function stopPeriodicGrowthBookRefresh() {}
export async function getDynamicConfig_BLOCKS_ON_INIT(configName, defaultValue) { return defaultValue; }
export function getDynamicConfig_CACHED_MAY_BE_STALE(configName, defaultValue) { return defaultValue; }
`,
  'services/analytics/sink': `
export function initializeAnalyticsGates() {}
export function initializeAnalyticsSink() {}
`,
  'services/analytics/config': `
export function isAnalyticsDisabled() { return true; }
export function isFeedbackSurveyDisabled() { return true; }
`,
  'services/analytics/datadog': `
export const initializeDatadog = async () => false;
export async function shutdownDatadog() {}
export async function trackDatadogEvent() {}
`,
  'services/analytics/firstPartyEventLogger': `
export function getEventSamplingConfig() { return {}; }
export function shouldSampleEvent() { return null; }
export async function shutdown1PEventLogging() {}
export function is1PEventLoggingEnabled() { return false; }
export function logEventTo1P() {}
export function logGrowthBookExperimentTo1P() {}
export function initialize1PEventLogging() {}
export async function reinitialize1PEventLoggingIfConfigChanged() {}
`,
  'services/analytics/firstPartyEventLoggingExporter': `
export class FirstPartyEventLoggingExporter {
  async export(_logs, resultCallback) { resultCallback({ code: 0 }); }
  async getQueuedEventCount() { return 0; }
  async shutdown() {}
  async forceFlush() {}
}
`,
  'utils/autoUpdater': `
export async function assertMinVersion() {}
export async function getMaxVersion() { return undefined; }
export async function getMaxVersionMessage() { return undefined; }
export function shouldSkipVersion() { return true; }
export function getLockFilePath() { return '/tmp/localclawd-update.lock'; }
export async function checkGlobalInstallPermissions() { return { hasPermissions: false, npmPrefix: null }; }
export async function getLatestVersion() { return null; }
export async function getNpmDistTags() { return { latest: null, stable: null }; }
export async function getLatestVersionFromGcs() { return null; }
export async function getGcsDistTags() { return { latest: null, stable: null }; }
export async function getVersionHistory() { return []; }
export async function installGlobalPackage() { return 'success'; }
`,
}

function escapeForResolvedPathRegex(modulePath: string): string {
  return modulePath.replace(/[|\\{}()[\]^$+*?.]/g, '\\$&').replace(/\//g, '[/\\\\]')
}

export const noTelemetryPlugin: BunPlugin = {
  name: 'no-telemetry',
  setup(build) {
    for (const [modulePath, contents] of Object.entries(stubs)) {
      const escaped = escapeForResolvedPathRegex(modulePath)
      const filter = new RegExp(`${escaped}\\.(ts|js)$`)
      build.onLoad({ filter }, () => ({
        contents,
        loader: 'js',
      }))
    }
  },
}