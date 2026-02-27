# Daily Sync Implementation Plan

## Problem

The Bol.com Advertising API returns **aggregated data** for whatever date range you request. Currently:

1. We request: `dateFrom=2026-02-20&dateTo=2026-02-27` (7 days)
2. Bol returns: ONE aggregated row with totals for those 7 days
3. We store: ONE row with `period_start_date=2026-02-20, period_end_date=2026-02-27`
4. Dashboard problem: When user selects Nov 1-27, we have no rows that overlap

**API Limit**: Last 30 days only (per the spec you provided)

## Solution

Fetch data **day-by-day** to build a proper daily time-series.

### Changes Required

#### 1. Update Sync Logic (bol-sync-trigger.ts & bol-sync-start.ts)

Instead of:
```typescript
const dateFrom = '2026-02-20';
const dateTo = '2026-02-27';
const data = await getAdsCampaignPerformance(adsToken, campaignIds, dateFrom, dateTo);
// Returns: ONE row with aggregated 7-day totals
```

Do this:
```typescript
// Fetch each day individually
for (let dayOffset = 29; dayOffset >= 0; dayOffset--) {
  const date = new Date(Date.now() - dayOffset * 86400000).toISOString().slice(0, 10);
  const data = await getAdsCampaignPerformance(adsToken, campaignIds, date, date);
  // Returns: Daily metrics for this specific date

  // Store with period_start_date = date, period_end_date = date
}
```

#### 2. Update Backfill Strategy

- **First sync**: Fetch last 30 days (API limit)
- **Incremental syncs**: Fetch last 2 days (yesterday + today)
- Remove the 180-day backfill concept (not supported by Bol API)

#### 3. Rate Limiting

- 30 days × (campaigns + keywords) = lots of API calls
- Add sleep(200ms) between date requests
- Expected time: ~30 seconds for 30-day backfill

#### 4. Deduplication Strategy

- Check if row exists before inserting: `SELECT id FROM bol_campaign_performance WHERE bol_customer_id = ? AND campaign_id = ? AND period_start_date = ?`
- Skip if exists (avoid duplicates on re-sync)

## Implementation Steps

### Step 1: Create Daily Fetch Function

```typescript
async function fetchDailyPerformance(
  adsToken: string,
  campaigns: unknown[],
  allAdGroups: unknown[],
  date: string,
  customerId: string
): Promise<{
  campRows: Array<Record<string, unknown>>;
  kwRows: Array<Record<string, unknown>>;
}> {
  const campaignIds = (campaigns as Array<{ campaignId?: string }>)
    .filter(c => c.campaignId)
    .map(c => c.campaignId as string);

  // Fetch campaign performance for this date
  const campPerf = await getAdsCampaignPerformance(adsToken, campaignIds, date, date);
  const subTotals = campPerf as Array<Record<string, unknown>>;

  const campRows = (campaigns as Array<Record<string, unknown>>).map((camp, i) => {
    const campaignId = camp.campaignId as string;
    const p = subTotals.find(s => s.entityId === campaignId) ?? subTotals[i] ?? {};
    const budget = camp.dailyBudget as Record<string, unknown> | undefined;

    return {
      bol_customer_id: customerId,
      campaign_id: campaignId,
      campaign_name: (camp.name as string) ?? null,
      campaign_type: (camp.campaignType as string) ?? null,
      state: (camp.state as string) ?? null,
      budget: budget?.amount ?? null,
      spend: p.cost ?? null,
      impressions: p.impressions ?? null,
      clicks: p.clicks ?? null,
      ctr_pct: p.ctr ?? null,
      avg_cpc: p.averageCpc ?? null,
      revenue: p.sales14d ?? null,
      roas: p.roas14d ?? null,
      acos: p.acos14d ?? null,
      conversions: p.conversions14d ?? null,
      cvr_pct: p.conversionRate14d ?? null,
      period_start_date: date,  // SAME DATE
      period_end_date: date,    // SAME DATE
    };
  });

  // Fetch keywords (once per day, not per campaign)
  const allKeywords: Array<Record<string, unknown>> = [];
  for (const adGroup of (allAdGroups as Array<{ adGroupId?: string }>).slice(0, 40)) {
    if (adGroup.adGroupId) {
      const kws = await getAdsKeywords(adsToken, adGroup.adGroupId);
      allKeywords.push(...(kws as Array<Record<string, unknown>>));
      await sleep(50);
    }
  }

  const keywordIds = allKeywords.filter(k => k.keywordId).map(k => k.keywordId as string);
  const kwPerf = await getAdsKeywordPerformance(adsToken, keywordIds, date, date);
  const kwSubTotals = kwPerf as Array<Record<string, unknown>>;

  const kwRows = allKeywords.map((kw, i) => {
    const keywordId = kw.keywordId as string;
    const p = kwSubTotals.find(s => s.entityId === keywordId) ?? kwSubTotals[i] ?? {};
    const bid = kw.bid as Record<string, unknown> | undefined;

    return {
      bol_customer_id: customerId,
      keyword_id: keywordId,
      keyword_text: (kw.keywordText as string) ?? null,
      match_type: (kw.matchType as string) ?? null,
      campaign_id: kw.campaignId as string,
      ad_group_id: (kw.adGroupId as string) ?? null,
      bid: bid?.amount ?? null,
      state: (kw.state as string) ?? null,
      spend: p.cost ?? null,
      impressions: p.impressions ?? null,
      clicks: p.clicks ?? null,
      revenue: p.sales14d ?? null,
      acos: p.acos14d ?? null,
      conversions: p.conversions14d ?? null,
      period_start_date: date,  // SAME DATE
      period_end_date: date,    // SAME DATE
    };
  });

  return { campRows, kwRows };
}
```

### Step 2: Update Main Sync Logic

```typescript
// Determine how many days to fetch
const now = new Date();
let daysToFetch = 30; // First sync

if (backfillStatus?.backfill_completed) {
  daysToFetch = 2; // Incremental: yesterday + today
}

// Fetch campaigns and ad groups once
const campaigns = await getAdsCampaigns(adsToken);
const allAdGroups = /* ... fetch ad groups ... */;

// Loop through each day
const allCampRows: Array<Record<string, unknown>> = [];
const allKwRows: Array<Record<string, unknown>> = [];

for (let dayOffset = daysToFetch - 1; dayOffset >= 0; dayOffset--) {
  const date = new Date(now.getTime() - dayOffset * 86400000).toISOString().slice(0, 10);
  console.log(`Fetching data for ${date}...`);

  const { campRows, kwRows } = await fetchDailyPerformance(
    adsToken,
    campaigns,
    allAdGroups,
    date,
    customer.id
  );

  allCampRows.push(...campRows);
  allKwRows.push(...kwRows);

  await sleep(200); // Rate limit between days
}

// Bulk insert all rows
if (allCampRows.length > 0) {
  await supabase.from('bol_campaign_performance').insert(allCampRows);
}
if (allKwRows.length > 0) {
  await supabase.from('bol_keyword_performance').insert(allKwRows);
}
```

### Step 3: Update AI Analysis

The AI analysis needs the LAST DAY's data for the blob. Change:

```typescript
// After the daily loop, fetch last day's advertiser performance
const lastDate = now.toISOString().slice(0, 10);
const perf = await getAdsPerformance(adsToken, lastDate, lastDate);

// Use for analysis blob
const analysis = analyzeAdvertising(campaigns, allAdGroups, perf);
```

## Expected Behavior After Fix

### First Sync
- Fetches last 30 days (API limit)
- Creates 30 rows per campaign (one per day)
- Total rows: ~30 campaigns × 30 days = 900 rows
- Time: ~30-60 seconds

### Incremental Sync
- Fetches last 2 days
- Creates 2 rows per campaign
- Total rows: ~30 campaigns × 2 days = 60 rows
- Time: ~5-10 seconds

### Dashboard Queries
- User selects Nov 1-27, 2025: Returns 0 (no data - beyond 30-day window)
- User selects Feb 1-27, 2026: Returns all days within Feb 1-27 that exist
- User selects Last 7 days: Returns last 7 daily data points

## Testing Plan

1. Clear existing data:
   ```sql
   DELETE FROM bol_campaign_performance WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
   DELETE FROM bol_keyword_performance WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
   DELETE FROM bol_advertising_backfill_status WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
   ```

2. Trigger sync via dashboard

3. Check database:
   ```sql
   SELECT period_start_date, COUNT(*) as campaigns
   FROM bol_campaign_performance
   WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
   GROUP BY period_start_date
   ORDER BY period_start_date;
   ```

   Expected: 30 rows (one per day)

4. Test dashboard with various date ranges

## Files to Modify

1. `api/bol-sync-trigger.ts` - Main sync endpoint
2. `api/bol-sync-start.ts` - Async sync endpoint
3. `api/bol-campaigns-chart.ts` - Already correct (filters by period dates)
4. `api/bol-campaigns.ts` - Already correct (filters by period dates)

NO frontend changes needed!
