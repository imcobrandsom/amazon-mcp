# Date Range Fix Instructions

## Problem Summary

The Bol.com campaign performance dashboard was showing incorrect data for selected date ranges because:

1. **Database schema issue**: The `bol_campaign_performance` and `bol_keyword_performance` tables only stored `synced_at` (when we fetched the data), not the actual reporting period the metrics represent.

2. **Chart API issue**: The chart endpoint was filtering by `synced_at` instead of the report date range.

3. **Table API issue**: The campaigns/keywords endpoint was also filtering by `synced_at`.

When a user selected "November 1-27" in the dashboard, it would query `synced_at >= 2025-11-01` and `synced_at <= 2025-11-27`, but all existing rows had `synced_at` in February 2026 (when we actually fetched the data), so no results were returned.

## Solution

Added `period_start_date` and `period_end_date` columns to track the actual reporting period.

---

## Required Steps to Deploy

### 1. Run Database Migration

Execute the SQL migration in Supabase:

```bash
cat supabase/migrations/009_add_report_date_to_performance_tables.sql
```

Or copy/paste the contents into Supabase SQL Editor.

This will:
- Add `period_start_date` and `period_end_date` columns
- Create indexes for efficient date range queries
- Backfill existing rows with `period_start_date = synced_at::date`

### 2. Deploy API Changes

The following files have been updated and must be deployed:

- `api/bol-sync-trigger.ts` - adds period dates when inserting performance data
- `api/bol-sync-start.ts` - adds period dates when inserting performance data
- `api/bol-campaigns-chart.ts` - filters by period dates instead of synced_at
- `api/bol-campaigns.ts` - filters by period dates instead of synced_at

Deploy to Vercel:
```bash
git add .
git commit -m "fix: add period dates to performance tables for accurate date range filtering"
git push
```

### 3. Trigger New Sync to Populate Period Dates

After deployment, trigger a new sync to populate the `period_start_date` and `period_end_date` fields:

**Option A: Via Dashboard**
- Go to https://amazon-mcp-eight.vercel.app/bol-dashboard/a260ef86-9e3a-47cf-9e59-68bf8418e6d8
- Click the "Sync Now" button in the top right

**Option B: Via Script**
```bash
node trigger-backfill.js
```

**Option C: Via API**
```bash
curl -X POST https://amazon-mcp-eight.vercel.app/api/bol-sync-trigger \
  -H "Content-Type: application/json" \
  -d '{"customerId":"a260ef86-9e3a-47cf-9e59-68bf8418e6d8","syncType":"main"}'
```

This will:
- Fetch last 7 days of performance data (incremental sync)
- Store it with `period_start_date` and `period_end_date` set to the API date range

---

## How It Works Now

### Before (Broken)
```
User selects: Nov 1-27, 2025
Query: synced_at >= '2025-11-01' AND synced_at <= '2025-11-27'
Data in DB: synced_at = '2026-02-26' (when we fetched it)
Result: 0 rows ❌
```

### After (Fixed)
```
User selects: Nov 1-27, 2025
Query: period_start_date >= '2025-11-01' AND period_end_date <= '2025-11-27'
Data in DB: period_start_date = '2025-11-18', period_end_date = '2025-11-25'
Result: Correct historical data ✅
```

---

## Testing the Fix

After deploying and running sync, test with:

```bash
node test-chart-date-range.js
```

Expected output:
- November 1-27 range should return data matching Bol.com screenshot
- Total Spend ≈ €2,688
- Total Revenue ≈ €15,144
- ROAS ≈ 5.50×

---

## Notes

1. **Historical data**: Existing rows were backfilled with `period_start_date = synced_at::date` as a best-effort migration. This means they'll appear as single-day data points. Future syncs will have proper multi-day periods.

2. **Bol.com API behavior**: The Advertising API returns aggregated metrics for the date range requested (e.g., dateFrom=2025-11-01, dateTo=2025-11-27). We store these as one row with the full period.

3. **Chart aggregation**: If multiple sync runs cover overlapping periods, the chart will sum them. This is intentional for incremental syncs.

4. **Orders data**: The TACOS calculation also uses the period dates to join with orders data.

---

## Rollback Plan

If issues occur, rollback by:

1. Revert Git commit:
   ```bash
   git revert HEAD
   git push
   ```

2. Drop new columns in Supabase (optional):
   ```sql
   ALTER TABLE public.bol_campaign_performance DROP COLUMN IF EXISTS period_start_date, DROP COLUMN IF EXISTS period_end_date;
   ALTER TABLE public.bol_keyword_performance DROP COLUMN IF EXISTS period_start_date, DROP COLUMN IF EXISTS period_end_date;
   ```

The old `synced_at` columns remain intact, so the dashboard will continue working (but with incorrect date filtering).
