import { cpSync, existsSync, mkdirSync, readFileSync, rmSync } from 'fs'
import { noTelemetryPlugin } from './no-telemetry-plugin'

const pkg = JSON.parse(readFileSync('./package.json', 'utf-8'))
const version = pkg.version

function failBuild(message: string): never {
  console.error(`Build failed: ${message}`)
  process.exit(1)
}

function getCurrentPlatformRipgrepBinary(root: string): string {
  if (process.platform === 'win32') {
    return `${root}/${process.arch}-win32/rg.exe`
  }

  return `${root}/${process.arch}-${process.platform}/rg`
}

function verifyPublishedFilesConfiguration(): void {
  const requiredFiles = ['bin', 'dist/cli.mjs', 'dist/vendor/ripgrep']
  const configuredFiles = Array.isArray(pkg.files) ? pkg.files : []
  const missingFiles = requiredFiles.filter(file => !configuredFiles.includes(file))

  if (missingFiles.length > 0) {
    failBuild(
      `package.json files is missing required publish entries: ${missingFiles.join(', ')}`,
    )
  }
}

const internalFeatureStubModules = new Map([
  [
    '../daemon/workerRegistry.js',
    'export async function runDaemonWorker() { throw new Error("Daemon worker is unavailable in this build."); }',
  ],
  [
    '../daemon/main.js',
    'export async function daemonMain() { throw new Error("Daemon mode is unavailable in this build."); }',
  ],
  [
    '../cli/bg.js',
    [
      'export async function psHandler() { throw new Error("Background sessions are unavailable in this build."); }',
      'export async function logsHandler() { throw new Error("Background sessions are unavailable in this build."); }',
      'export async function attachHandler() { throw new Error("Background sessions are unavailable in this build."); }',
      'export async function killHandler() { throw new Error("Background sessions are unavailable in this build."); }',
      'export async function handleBgFlag() { throw new Error("Background sessions are unavailable in this build."); }',
    ].join('\n'),
  ],
  [
    '../cli/handlers/templateJobs.js',
    'export async function templatesMain() { throw new Error("Template jobs are unavailable in this build."); }',
  ],
  [
    '../environment-runner/main.js',
    'export async function environmentRunnerMain() { throw new Error("Environment runner is unavailable in this build."); }',
  ],
  [
    '../self-hosted-runner/main.js',
    'export async function selfHostedRunnerMain() { throw new Error("Self-hosted runner is unavailable in this build."); }',
  ],
])

const publicCompatibilityStubModules = new Map([
  [
    './protectedNamespace.js',
    'export function checkProtectedNamespace() { return false; }',
  ],
  [
    './commands/agents-platform/index.js',
    'export default null;',
  ],
  [
    './components/agents/SnapshotUpdateDialog.js',
    'export function SnapshotUpdateDialog() { return null; }',
  ],
  [
    './assistant/AssistantSessionChooser.js',
    'export function AssistantSessionChooser() { return null; }',
  ],
  [
    './commands/assistant/assistant.js',
    [
      'export function NewInstallWizard() { return null; }',
      'export async function computeDefaultInstallDir() { return null; }',
      'export default null;',
    ].join('\n'),
  ],
  [
    './tools/SuggestBackgroundPRTool/SuggestBackgroundPRTool.js',
    'export const SuggestBackgroundPRTool = null;',
  ],
  [
    './cachedMicrocompact.js',
    [
      'export function isCachedMicrocompactEnabled() { return false; }',
      'export function isModelSupportedForCacheEditing() { return false; }',
      'export function createCachedMCState() { return { pinnedEdits: [], registeredTools: new Set(), toolOrder: [], deletedRefs: new Set() }; }',
      'export function markToolsSentToAPI() {}',
      'export function resetCachedMCState(state) { if (state) { state.pinnedEdits = []; state.registeredTools = new Set(); state.toolOrder = []; state.deletedRefs = new Set(); } }',
      'export function getCachedMCConfig() { return { triggerThreshold: 0, keepRecent: 0, supportedModels: [] }; }',
      'export function registerToolResult() {}',
      'export function registerToolMessage() {}',
      'export function getToolResultsToDelete() { return []; }',
      'export function createCacheEditsBlock() { return null; }',
    ].join('\n'),
  ],
  [
    '../tools/TungstenTool/TungstenLiveMonitor.js',
    'export function TungstenLiveMonitor() { return null; }',
  ],
  [
    './sdk/runtimeTypes.js',
    'export {};',
  ],
  [
    './sdk/toolTypes.js',
    'export {};',
  ],
  [
    './devtools.js',
    'export {};',
  ],
  [
    '../tools/WorkflowTool/constants.js',
    "export const WORKFLOW_TOOL_NAME = 'workflow';",
  ],
  [
    './services/contextCollapse/index.js',
    [
      'export function isContextCollapseEnabled() { return false; }',
      'export function initContextCollapse() {}',
      'export function resetContextCollapse() {}',
      'export async function applyCollapsesIfNeeded(messages) { return { messages }; }',
      'export function isWithheldPromptTooLong() { return false; }',
      'export function recoverFromOverflow() { return null; }',
      'export function subscribe() { return () => {}; }',
      'export function getStats() { return { collapsedSpans: 0, stagedSpans: 0, collapsedMessages: 0, health: { emptySpawnWarningEmitted: false, totalErrors: 0, totalEmptySpawns: 0, totalSpawns: 0, lastError: "" } }; }',
    ].join('\n'),
  ],
  [
    '../services/contextCollapse/index.js',
    [
      'export function isContextCollapseEnabled() { return false; }',
      'export function initContextCollapse() {}',
      'export function resetContextCollapse() {}',
      'export async function applyCollapsesIfNeeded(messages) { return { messages }; }',
      'export function isWithheldPromptTooLong() { return false; }',
      'export function recoverFromOverflow() { return null; }',
      'export function subscribe() { return () => {}; }',
      'export function getStats() { return { collapsedSpans: 0, stagedSpans: 0, collapsedMessages: 0, health: { emptySpawnWarningEmitted: false, totalErrors: 0, totalEmptySpawns: 0, totalSpawns: 0, lastError: "" } }; }',
    ].join('\n'),
  ],
  [
    '../contextCollapse/index.js',
    [
      'export function isContextCollapseEnabled() { return false; }',
      'export function initContextCollapse() {}',
      'export function resetContextCollapse() {}',
      'export async function applyCollapsesIfNeeded(messages) { return { messages }; }',
      'export function isWithheldPromptTooLong() { return false; }',
      'export function recoverFromOverflow() { return null; }',
      'export function subscribe() { return () => {}; }',
      'export function getStats() { return { collapsedSpans: 0, stagedSpans: 0, collapsedMessages: 0, health: { emptySpawnWarningEmitted: false, totalErrors: 0, totalEmptySpawns: 0, totalSpawns: 0, lastError: "" } }; }',
    ].join('\n'),
  ],
  [
    '../../services/contextCollapse/index.js',
    [
      'export function isContextCollapseEnabled() { return false; }',
      'export function initContextCollapse() {}',
      'export function resetContextCollapse() {}',
      'export async function applyCollapsesIfNeeded(messages) { return { messages }; }',
      'export function isWithheldPromptTooLong() { return false; }',
      'export function recoverFromOverflow() { return null; }',
      'export function subscribe() { return () => {}; }',
      'export function getStats() { return { collapsedSpans: 0, stagedSpans: 0, collapsedMessages: 0, health: { emptySpawnWarningEmitted: false, totalErrors: 0, totalEmptySpawns: 0, totalSpawns: 0, lastError: "" } }; }',
    ].join('\n'),
  ],
  [
    '../../services/contextCollapse/operations.js',
    'export function projectView(messages) { return messages; }',
  ],
  [
    '../services/contextCollapse/persist.js',
    'export function restoreFromEntries() {}',
  ],
])

const nativeStubContents = `
const noop = () => null;
const noopClass = class {};
const handler = {
  get(_, prop) {
    if (prop === '__esModule') return true;
    if (prop === 'default') return new Proxy({}, handler);
    if (prop === 'ExportResultCode') return { SUCCESS: 0, FAILED: 1 };
    if (prop === 'resourceFromAttributes') return () => ({});
    if (prop === 'SandboxRuntimeConfigSchema') return { parse: () => ({}) };
    return noop;
  }
};
const stub = new Proxy(noop, handler);
export default stub;
export const __stub = true;
export const SandboxViolationStore = null;
export const SandboxManager = new Proxy({}, { get: () => noop });
export const SandboxRuntimeConfigSchema = { parse: () => ({}) };
export const BROWSER_TOOLS = [];
export const CLI_CU_CAPABILITIES = { screenshotFiltering: 'native', platform: 'darwin' };
export const getMcpConfigForManifest = noop;
export const ColorDiff = null;
export const ColorFile = null;
export const getSyntaxTheme = noop;
export const plot = noop;
export const createClaudeForChromeMcpServer = noop;
export const buildComputerUseTools = () => [];
export const createComputerUseMcpServer = noop;
export const bindSessionContext = noop;
export const DEFAULT_GRANT_FLAGS = {};
export const getSentinelCategory = noop;
export const ExportResultCode = { SUCCESS: 0, FAILED: 1 };
export const resourceFromAttributes = noop;
export const Resource = noopClass;
export const SimpleSpanProcessor = noopClass;
export const BatchSpanProcessor = noopClass;
export const NodeTracerProvider = noopClass;
export const BasicTracerProvider = noopClass;
export const OTLPTraceExporter = noopClass;
export const OTLPLogExporter = noopClass;
export const OTLPMetricExporter = noopClass;
export const PrometheusExporter = noopClass;
export const LoggerProvider = noopClass;
export const SimpleLogRecordProcessor = noopClass;
export const BatchLogRecordProcessor = noopClass;
export const MeterProvider = noopClass;
export const PeriodicExportingMetricReader = noopClass;
export const trace = { getTracer: () => ({ startSpan: () => ({ end: noop, setAttribute: noop, setStatus: noop, recordException: noop }) }) };
export const context = { active: noop, with: (_, fn) => fn() };
export const SpanStatusCode = { OK: 0, ERROR: 1, UNSET: 2 };
export const ATTR_SERVICE_NAME = 'service.name';
export const ATTR_SERVICE_VERSION = 'service.version';
export const SEMRESATTRS_SERVICE_NAME = 'service.name';
export const SEMRESATTRS_SERVICE_VERSION = 'service.version';
export const AggregationTemporality = { CUMULATIVE: 0, DELTA: 1 };
export const DataPointType = { HISTOGRAM: 0, SUM: 1, GAUGE: 2 };
export const InstrumentType = { COUNTER: 0, HISTOGRAM: 1, UP_DOWN_COUNTER: 2 };
export const PushMetricExporter = noopClass;
export const SeverityNumber = {};
`

// Remove stale build artifacts before rebuilding to prevent stale cache issues
rmSync('./dist/cli.mjs', { force: true })
rmSync('./dist/cli.mjs.map', { force: true })

const result = await Bun.build({
  entrypoints: ['./src/entrypoints/cli.tsx'],
  outdir: './dist',
  target: 'node',
  format: 'esm',
  splitting: false,
  sourcemap: 'external',
  minify: false,
  naming: 'cli.mjs',
  // zod v3.25+ ships a /v4 compatibility shim that Bun's bundler cannot
  // correctly order due to lazy __esm init patterns (util3/util not defined
  // errors at startup). Mark zod as external so Node loads it from
  // node_modules at runtime — safe for npm installs since zod is listed in
  // dependencies and will be present alongside dist/cli.mjs.
  // zod is externalized via the plugin below (regex covers all subpaths)
  define: {
    'MACRO.VERSION': JSON.stringify(version),
    'MACRO.DISPLAY_VERSION': JSON.stringify(version),
    'MACRO.BUILD_TIME': JSON.stringify(new Date().toISOString()),
    'MACRO.ISSUES_EXPLAINER': JSON.stringify('report the issue at https://github.com/chromebookwiz/localclawd/issues'),
    'MACRO.PACKAGE_URL': JSON.stringify('localclawd'),
    'MACRO.NATIVE_PACKAGE_URL': 'undefined',
  },
  plugins: [
    noTelemetryPlugin,
    {
      name: 'zod-subpath-external',
      setup(build) {
        // Externalize zod subpath exports (e.g. zod/v4, zod/v4-mini, zod/v3).
        // The main 'zod' package is already in the external[] array above.
        // Bun's external array only matches exact bare specifiers, not subpaths,
        // so we need a plugin to cover zod/* as well.
        build.onResolve({ filter: /^zod\/.+/ }, args => ({
          path: args.path,
          external: true,
        }))
      },
    },
    {
      name: 'bun-bundle-shim',
      setup(build) {
        build.onResolve({ filter: /^bun:bundle$/ }, () => ({
          path: 'bun:bundle',
          namespace: 'bun-bundle-shim',
        }))
        build.onLoad({ filter: /.*/, namespace: 'bun-bundle-shim' }, () => ({
          contents: 'export function feature() { return false; }',
          loader: 'js',
        }))

        build.onResolve(
          { filter: /^\.\.\/(daemon\/workerRegistry|daemon\/main|cli\/bg|cli\/handlers\/templateJobs|environment-runner\/main|self-hosted-runner\/main)\.js$/ },
          args => {
            if (!internalFeatureStubModules.has(args.path)) return null
            return {
              path: args.path,
              namespace: 'internal-feature-stub',
            }
          },
        )
        build.onLoad({ filter: /.*/, namespace: 'internal-feature-stub' }, args => ({
          contents: internalFeatureStubModules.get(args.path) ?? 'export {}',
          loader: 'js',
        }))

        build.onResolve({ filter: /^(\.\/|\.\.\/).+\.(js|d\.ts)$/ }, args => {
          if (
            args.path === './types.js' &&
            /[\\/]src[\\/]utils[\\/]filePersistence[\\/]filePersistence\.ts$/.test(
              args.importer,
            )
          ) {
            return {
              path: 'file-persistence-types-stub',
              namespace: 'contextual-stub',
            }
          }
          if (args.path.endsWith('.d.ts')) {
            return {
              path: args.path,
              namespace: 'type-only-stub',
            }
          }
          if (!publicCompatibilityStubModules.has(args.path)) return null
          return {
            path: args.path,
            namespace: 'public-compatibility-stub',
          }
        })
        build.onLoad({ filter: /.*/, namespace: 'public-compatibility-stub' }, args => ({
          contents: publicCompatibilityStubModules.get(args.path) ?? 'export {}',
          loader: 'js',
        }))
        build.onLoad({ filter: /.*/, namespace: 'type-only-stub' }, () => ({
          contents: 'export {};',
          loader: 'js',
        }))
        build.onLoad({ filter: /^file-persistence-types-stub$/, namespace: 'contextual-stub' }, () => ({
          contents: [
            'export const DEFAULT_UPLOAD_CONCURRENCY = 4;',
            'export const FILE_COUNT_LIMIT = 1000;',
            "export const OUTPUTS_SUBDIR = 'outputs';",
          ].join('\n'),
          loader: 'js',
        }))

        build.onResolve({ filter: /^react\/compiler-runtime$/ }, () => ({
          path: 'react/compiler-runtime',
          namespace: 'react-compiler-shim',
        }))
        build.onLoad({ filter: /.*/, namespace: 'react-compiler-shim' }, () => ({
          contents: "export function c(size) { return new Array(size).fill(Symbol.for('react.memo_cache_sentinel')); }",
          loader: 'js',
        }))

        for (const mod of [
          'audio-capture-napi',
          'audio-capture.node',
          'image-processor-napi',
          'modifiers-napi',
          'url-handler-napi',
          'color-diff-napi',
          'sharp',
          '@anthropic-ai/mcpb',
          '@ant/claude-for-chrome-mcp',
          '@ant/computer-use-mcp',
          '@ant/computer-use-mcp/types',
          '@ant/computer-use-mcp/sentinelApps',
          '@ant/computer-use-input',
          '@ant/computer-use-swift',
          '@anthropic-ai/sandbox-runtime',
          'asciichart',
          'plist',
          'cacache',
          'fuse',
          'code-excerpt',
          'stack-utils',
        ]) {
          build.onResolve({ filter: new RegExp(`^${mod}$`) }, () => ({
            path: mod,
            namespace: 'native-stub',
          }))
        }
        build.onLoad({ filter: /.*/, namespace: 'native-stub' }, () => ({
          contents: nativeStubContents,
          loader: 'js',
        }))

        build.onResolve({ filter: /\.(md|txt)$/ }, args => ({
          path: args.path,
          namespace: 'text-stub',
        }))
        build.onLoad({ filter: /.*/, namespace: 'text-stub' }, () => ({
          contents: "export default '';",
          loader: 'js',
        }))
      },
    },
  ],
  external: [
    'zod',
    'execa',
    '@opentelemetry/api',
    '@opentelemetry/api-logs',
    '@opentelemetry/core',
    '@opentelemetry/exporter-trace-otlp-grpc',
    '@opentelemetry/exporter-trace-otlp-http',
    '@opentelemetry/exporter-trace-otlp-proto',
    '@opentelemetry/exporter-logs-otlp-http',
    '@opentelemetry/exporter-logs-otlp-proto',
    '@opentelemetry/exporter-logs-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-proto',
    '@opentelemetry/exporter-metrics-otlp-grpc',
    '@opentelemetry/exporter-metrics-otlp-http',
    '@opentelemetry/exporter-prometheus',
    '@opentelemetry/resources',
    '@opentelemetry/sdk-trace-base',
    '@opentelemetry/sdk-trace-node',
    '@opentelemetry/sdk-logs',
    '@opentelemetry/sdk-metrics',
    '@opentelemetry/semantic-conventions',
    '@aws-sdk/client-bedrock',
    '@aws-sdk/client-bedrock-runtime',
    '@aws-sdk/client-sts',
    '@aws-sdk/credential-providers',
    '@azure/identity',
    'google-auth-library',
  ],
})

if (!result.success) {
  console.error('Build failed:')
  for (const log of result.logs) {
    console.error(log)
  }
  process.exit(1)
}

const ripgrepVendorSource = './node_modules/@anthropic-ai/claude-agent-sdk/vendor/ripgrep'
const ripgrepVendorDestination = './dist/vendor/ripgrep'
const builtCliPath = './dist/cli.mjs'

verifyPublishedFilesConfiguration()

if (!existsSync(builtCliPath)) {
  failBuild(`expected bundled CLI at ${builtCliPath}`)
}

rmSync(ripgrepVendorDestination, { recursive: true, force: true })

if (!existsSync(ripgrepVendorSource)) {
  failBuild(
    `required ripgrep vendor directory was not found at ${ripgrepVendorSource}`,
  )
}

mkdirSync('./dist/vendor', { recursive: true })
cpSync(ripgrepVendorSource, ripgrepVendorDestination, { recursive: true })

const currentPlatformRipgrepBinary = getCurrentPlatformRipgrepBinary(
  ripgrepVendorDestination,
)

if (!existsSync(currentPlatformRipgrepBinary)) {
  failBuild(
    `expected ripgrep binary for ${process.platform}/${process.arch} at ${currentPlatformRipgrepBinary}`,
  )
}

console.log(`Built localclawd v${version} -> dist/cli.mjs`)