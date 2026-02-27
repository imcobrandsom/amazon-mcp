# Dashboard Fix Summary - Feb 27, 2026

## The Real Problem (Now Understood)

You were absolutely right! The Bol.com Advertising API **DOES support last 30 days of historical data** (not just 7 days as I mistakenly thought).

The issue is **HOW we're fetching and storing the data**:

### Current (Broken) Behavior
1. We request: `period-start-date=2026-02-20&period-end-date=2026-02-27` (7 days)
2. Bol API returns: **ONE aggregated row** with totals for those entire 7 days
3. We store: ONE database row with `period_start_date=2026-02-20, period_end_date=2026-02-27`
4. Result: We have only ONE data point for a 7-day period

When user selects different dates in the dashboard, we can't show daily trends because we only have aggregated multi-day periods.

### Correct Behavior (What We Need)
1. Request data **day-by-day**: `period-start-date=2026-02-20&period-end-date=2026-02-20` (same date)
2. Bol API returns: **Daily metrics** for that single day
3. Store: ONE row per day with `period_start_date=2026-02-20, period_end_date=2026-02-20`
4. Repeat for each of the last 30 days
5. Result: 30 daily data points that can be aggregated any way the user wants

## Why Your Numbers Don't Match

Bol Portal shows (Nov 1 - Feb 27):
- €2,688 spend for November portion

Our dashboard shows (Jan 28 - Feb 27):
- €5,273 spend for late Feb portion

These are **different time periods**, so different numbers are correct. BUT you can't select November in our dashboard because:
1. We only fetched the last 7-8 days
2. The Bol API supports last 30 days, but we're not using it properly

## Solution: Daily Sync Loop

Change from:
```typescript
// WRONG: One big request for 7 days
const data = await getAdsCampaignPerformance(token, campaignIds, '2026-02-20', '2026-02-27');
// Returns: Aggregated 7-day total
```

To:
```typescript
// CORRECT: Loop through each day
for (let day = 0; day < 30; day++) {
  const date = getDateFromOffset(day);
  const data = await getAdsCampaignPerformance(token, campaignIds, date, date);
  // Returns: Daily metrics for ONE day
  // Store with period_start_date = date, period_end_date = date
}
```

## Implementation Complexity

This requires substantial changes to:
1. `api/bol-sync-trigger.ts` (~170 lines need modification)
2. `api/bol-sync-start.ts` (~120 lines need modification)

The complexity comes from:
- Rewriting the fetch loop to iterate daily
- Handling keywords separately (they don't need daily fetch)
- Updating the AI analysis blob to use last day's data
- Rate limiting (200ms between requests)
- Error handling for each day

## What's Already Fixed

✅ Database schema (migration 009) - period dates exist
✅ Chart API - filters by period dates correctly
✅ Campaigns API - filters by period dates correctly
✅ Frontend - no changes needed

## What Needs Fixing

❌ Sync logic - needs to fetch daily instead of multi-day aggregated

## Estimated Time

- Code changes: 30-45 minutes
- Testing: 15-20 minutes
- Total: ~1 hour

## Options

### Option A: Implement Now
I can implement the daily sync loop changes now. This will fix the dashboard completely.

### Option B: Implement Later
Given the complexity and that I've already made errors, you may prefer to:
1. Review the DAILY_SYNC_IMPLEMENTATION_PLAN.md document I created
2. Implement it in a fresh session when you have time to test thoroughly
3. Or have another developer implement it

### Option C: Quick Workaround
Delete existing data and run a fresh 30-day sync with the fixed code:
```sql
DELETE FROM bol_campaign_performance;
DELETE FROM bol_keyword_performance;
DELETE FROM bol_advertising_backfill_status;
```
Then trigger sync after code is fixed.

## Current Status

- ✅ Problem identified correctly
- ✅ Solution designed (see DAILY_SYNC_IMPLEMENTATION_PLAN.md)
- ⏳ Implementation in progress (reverted incomplete changes)
- ❌ Not yet deployed

## My Recommendation

Let me implement the daily sync loop now. The plan is solid, and I just need to execute it carefully without rushing. The code changes are straightforward once broken down into steps.

**Shall I proceed with the implementation?**
