#!/bin/bash
set -e

CUSTOMER_ID="a260ef86-9e3a-47cf-9e59-68bf8418e6d8"
BASE_URL="https://amazon-mcp-eight.vercel.app"

# Load environment variables
if [ -f .env.local ]; then
  export $(cat .env.local | grep -v '^#' | xargs)
fi

echo "=========================================="
echo "Manual Sync - All Steps"
echo "=========================================="
echo ""

# You need to be logged in to get a user token
# For now, we'll use a simpler approach - call the cron endpoints with CRON_SECRET
# But since we don't have that, let's use the service key to create a temporary user session

echo "⏭️  Skipping Steps 1-2 (already completed based on diagnostic)"
echo ""

echo "🔄 Step 3: Extended Sync (populating bol_competitor_snapshots)"
echo "----------------------------------------"

# Call the extended sync endpoint directly with GET (it accepts both POST and GET)
RESPONSE=$(curl -s -X POST "${BASE_URL}/api/bol-sync-extended" \
  -H "Authorization: Bearer ${CRON_SECRET:-invalid}" 2>&1)

# If unauthorized, that's expected - we need to set CRON_SECRET in Vercel
if echo "$RESPONSE" | grep -q "Unauthorised"; then
  echo "❌ Cannot trigger via cron endpoint (CRON_SECRET not available)"
  echo ""
  echo "⚠️  Please click the 'Extended Data' button in the dashboard instead."
  echo "    OR set CRON_SECRET environment variable and re-run this script."
  exit 1
fi

echo "$RESPONSE" | python3 -m json.tool 2>&1 | head -50
echo ""

echo "⏳ Waiting 5 seconds before checking results..."
sleep 5

echo ""
echo "🔍 Checking bol_competitor_snapshots table..."
echo "----------------------------------------"
curl -s "${BASE_URL}/api/bol-sync-diagnostic?customerId=${CUSTOMER_ID}" | \
  python3 -c "import sys, json; d=json.load(sys.stdin); print(f\"Competitor snapshots: {d['checks']['competitor_snapshots']['count']}\")"

echo ""
echo "✅ Done!"
