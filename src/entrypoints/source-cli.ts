const macroDefaults = {
  VERSION: process.env.LOCALCLAWD_SOURCE_VERSION ?? '0.0.0-source',
  BUILD_TIME: process.env.LOCALCLAWD_SOURCE_BUILD_TIME ?? '',
  PACKAGE_URL: process.env.LOCALCLAWD_PACKAGE_URL ?? 'localclawd',
  NATIVE_PACKAGE_URL:
    process.env.LOCALCLAWD_NATIVE_PACKAGE_URL ?? 'localclawd-native',
  ISSUES_EXPLAINER:
    process.env.LOCALCLAWD_ISSUES_EXPLAINER ??
    'open an issue in the localClawd repository',
  FEEDBACK_CHANNEL:
    process.env.LOCALCLAWD_FEEDBACK_CHANNEL ?? 'the localClawd issue tracker',
  VERSION_CHANGELOG: process.env.LOCALCLAWD_VERSION_CHANGELOG ?? '',
}

type MacroShape = typeof macroDefaults

const globalWithMacro = globalThis as typeof globalThis & {
  MACRO?: MacroShape
}

globalWithMacro.MACRO ??= macroDefaults

await import('./cli.tsx')