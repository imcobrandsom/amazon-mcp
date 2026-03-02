# Testing Daily Sync Implementation

## Status: ✅ Code Deployed to Production

The daily sync implementation has been pushed to GitHub and deployed to Vercel.

---

## What Changed

### Before (Broken)
- Requested: `period-start-date=2026-02-20&period-end-date=2026-02-27` (7 days)
- Received: ONE aggregated row with 7-day totals
- Stored: ONE database row
- Dashboard: Couldn't show daily trends

### After (Fixed)
- Loops through each day: Feb 20, Feb 21, Feb 22... (30 days on first sync)
- Requests: `period-start-date=2026-02-20&period-end-date=2026-02-20` (same date)
- Receives: Daily metrics for that single day
- Stores: 30 daily rows per campaign
- Dashboard: Can show any date range, daily trends

---

## Testing Steps

### Step 1: Clear Existing Data

Run this SQL in Supabase SQL Editor:

```sql
-- Delete all existing advertising data for fresh test
DELETE FROM bol_campaign_performance WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
DELETE FROM bol_keyword_performance WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
DELETE FROM bol_advertising_backfill_status WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';
```

### Step 2: Trigger Sync via Dashboard

1. Go to: https://amazon-mcp-eight.vercel.app/bol-dashboard/a260ef86-9e3a-47cf-9e59-68bf8418e6d8
2. Click **"Sync Now"** button in the top right
3. Wait ~30-60 seconds (fetching 30 days)
4. You should see "Sync completed successfully"

### Step 3: Verify Daily Data in Database

Run this SQL to check data:

```sql
-- Check daily data points
SELECT
  period_start_date,
  COUNT(*) as campaigns,
  SUM(spend) as total_spend,
  SUM(revenue) as total_revenue
FROM bol_campaign_performance
WHERE bol_customer_id = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8'
GROUP BY period_start_date
ORDER BY period_start_date DESC;
```

**Expected Result:**
- 30 rows (one per day)
- Dates from ~30 days ago to today
- Each row shows daily totals

### Step 4: Test Dashboard Date Ranges

Go to dashboard and test these scenarios:

#### Test A: Last 7 Days
1. Select dates: Last 7 days using quick preset "7d" button
2. Expected: Chart shows 7 daily data points
3. Expected: Stat tiles show aggregated 7-day totals

#### Test B: Last 30 Days
1. Select dates: Last 30 days using quick preset "30d" button
2. Expected: Chart shows 30 daily data points
3. Expected: Stat tiles show aggregated 30-day totals

#### Test C: Custom Range (Last 14 Days)
1. Select start date: 14 days ago
2. Select end date: Today
3. Expected: Chart shows 14 daily data points
4. Expected: Stat tiles show aggregated 14-day totals

#### Test D: November 2025 (No Data)
1. Select start date: Nov 1, 2025
2. Select end date: Nov 27, 2025
3. Expected: Chart shows NO data (empty)
4. Expected: Stat tiles show €0 (no data for that period)
5. This is CORRECT - Bol API only provides last 30 days

---

## Expected Performance

### First Sync (30 Days)
- API calls: ~30 days × (campaigns + keywords) = ~1,800 calls
- Time: ~30-60 seconds
- Rows created: ~900 campaign rows + ~4,500 keyword rows
- Rate limit: 200ms between days

### Incremental Sync (2 Days)
- API calls: ~2 days × (campaigns + keywords) = ~120 calls
- Time: ~5-10 seconds
- Rows created: ~60 campaign rows + ~300 keyword rows
- Rate limit: 200ms between days

---

## Troubleshooting

### Problem: Sync takes too long
**Cause:** Too many campaigns/keywords
**Solution:** Code already limits to first 20 campaigns, 40 ad groups

### Problem: Duplicate data
**Cause:** Running sync multiple times without clearing
**Solution:** Run the DELETE SQL commands first, or sync logic should handle upserts

### Problem: Missing dates
**Cause:** Bol API might not have data for all requested dates
**Expected:** Some days may have no data if campaigns weren't active

### Problem: Chart still shows wrong data
**Cause:** Browser cache
**Solution:** Hard refresh (Cmd+Shift+R on Mac, Ctrl+Shift+R on Windows)

---

## Verification Commands

### Check data exists
```bash
node check-period-dates.js
```

Expected output:
```
Unique period_start_date values (30):
  2026-01-28 → 2026-01-28 (76 campaigns)
  2026-01-29 → 2026-01-29 (76 campaigns)
  ...
  2026-02-27 → 2026-02-27 (76 campaigns)
```

### Test API directly
```bash
node debug-api-calls.js
```

This will test various date ranges and show the API responses.

---

## Success Criteria

✅ **Database**: 30 daily data points exist (one per day)
✅ **Chart**: Shows daily trend line with multiple data points
✅ **Stat tiles**: Update correctly when date range changes
✅ **Date picker**: Changing dates triggers new data fetch
✅ **Campaign table**: Filters by selected date range
✅ **Keyword table**: Filters by selected date range

---

## Next Steps After Testing

### If Tests Pass
1. Dashboard is now fully functional! ✅
2. Set up daily cron job to run sync automatically
3. Monitor for ~7 days to ensure incremental syncs work

### If Tests Fail
1. Check Vercel logs for errors
2. Check browser console for frontend errors
3. Run diagnostic scripts (check-period-dates.js, debug-api-calls.js)
4. Report errors with specific date ranges that fail

---

## Daily Automatic Sync (Optional)

To get fresh data daily automatically, you can:

**Option A: Vercel Cron**
Add to `vercel.json`:
```json
{
  "crons": [{
    "path": "/api/bol-sync-manual",
    "schedule": "0 6 * * *"
  }]
}
```

**Option B: External Cron**
Use a service like GitHub Actions or cron-job.org to hit the sync endpoint daily.

---

## Current Limitations

1. **30-day window**: Bol API only provides last 30 days
2. **Historical data**: Cannot fetch data older than 30 days
3. **Rate limiting**: ~200ms between requests (could be faster if needed)
4. **Campaign limit**: Limited to first 20 campaigns (can be increased)

These are API limitations or safety limits, not bugs.
