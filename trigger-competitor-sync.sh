#!/bin/bash

# Trigger Extended Sync + Competitor Analysis
# Usage: ./trigger-competitor-sync.sh

CUSTOMER_ID="a260ef86-9e3a-47cf-9e59-68bf8418e6d8"  # FashionPower
BASE_URL="https://amazon-mcp-eight.vercel.app"

# Get Supabase auth token from environment
if [ -z "$SUPABASE_ANON_KEY" ]; then
    echo "❌ Error: SUPABASE_ANON_KEY not set"
    echo "Please run: export SUPABASE_ANON_KEY='your-anon-key'"
    exit 1
fi

echo "🔄 Step 1: Triggering Extended Sync..."
echo "This will fetch catalog data for FashionPower products..."

EXTENDED_RESPONSE=$(curl -s -X POST "${BASE_URL}/api/bol-sync-trigger" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer ${SUPABASE_ANON_KEY}" \
  -d "{\"customerId\":\"${CUSTOMER_ID}\",\"syncType\":\"extended\"}")

echo "Extended Sync Response:"
echo "$EXTENDED_RESPONSE" | jq '.' 2>/dev/null || echo "$EXTENDED_RESPONSE"

echo ""
echo "⏳ Waiting 30 seconds for extended sync to complete..."
sleep 30

echo ""
echo "🔍 Step 2: Triggering Competitor Analysis..."
echo "This will discover products in categories and run AI analysis..."

COMPETITOR_RESPONSE=$(curl -s -X GET "${BASE_URL}/api/bol-sync-competitor-analysis")

echo "Competitor Analysis Response:"
echo "$COMPETITOR_RESPONSE" | jq '.' 2>/dev/null || echo "$COMPETITOR_RESPONSE"

echo ""
echo "✅ Done! Check the responses above for any errors."
echo "If successful, visit the Competitor Research page to see results."
