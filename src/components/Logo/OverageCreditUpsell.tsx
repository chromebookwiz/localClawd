import type { FeedConfig } from './Feed.js'

export function isEligibleForOverageCreditGrant(): boolean {
  return false
}

export function shouldShowOverageCreditUpsell(): boolean {
  return false
}

export function maybeRefreshOverageCreditCache(): void {}

export function useShowOverageCreditUpsell(): boolean {
  return false
}

export function incrementOverageCreditUpsellSeenCount(): void {}

type Props = {
  maxWidth?: number
  twoLine?: boolean
}

export function OverageCreditUpsell(_props: Props) {
  return null
}

export function createOverageCreditFeed(): FeedConfig {
  return {
    title: 'Usage',
    lines: [],
    emptyMessage: 'Pricing and credit promos are disabled in localclawd',
  }
}
