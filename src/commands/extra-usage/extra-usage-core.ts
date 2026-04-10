type ExtraUsageResult =
  | { type: 'message'; value: string }
  | { type: 'browser-opened'; url: string; opened: boolean }

export async function runExtraUsage(): Promise<ExtraUsageResult> {
  return {
    type: 'message',
    value:
      'Extra-usage, admin billing, and organization credit flows are disabled in localclawd.',
  }
}
