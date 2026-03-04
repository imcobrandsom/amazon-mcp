#!/bin/bash
# Run full catalog sync in batches (handles Vercel 60s timeout)
# Usage: ./scripts/run-full-catalog-sync.sh [customer_id]

CUSTOMER_ID="${1:-a260ef86-9e3a-47cf-9e59-68bf8418e6d8}"
API_URL="https://amazon-mcp-eight.vercel.app/api/bol-sync-catalog"

echo "Starting full catalog sync for customer: $CUSTOMER_ID"
echo "=========================================="

BATCH=1
TOTAL_PROCESSED=0

while true; do
  echo ""
  echo "Batch $BATCH starting..."

  RESPONSE=$(curl -s -X POST "$API_URL" \
    -H "Content-Type: application/json" \
    -d "{\"customerId\": \"$CUSTOMER_ID\"}")

  if [ $? -ne 0 ]; then
    echo "❌ Error: curl command failed"
    exit 1
  fi

  # Parse JSON response
  PROCESSED=$(echo "$RESPONSE" | jq -r '.processed_this_run')
  FAILED=$(echo "$RESPONSE" | jq -r '.failed_this_run')
  REMAINING=$(echo "$RESPONSE" | jq -r '.remaining_to_process')
  COMPLETE=$(echo "$RESPONSE" | jq -r '.complete')
  DURATION=$(echo "$RESPONSE" | jq -r '.duration_ms')

  TOTAL_PROCESSED=$((TOTAL_PROCESSED + PROCESSED))

  echo "✅ Batch $BATCH complete:"
  echo "   Processed: $PROCESSED products"
  echo "   Failed: $FAILED products"
  echo "   Duration: ${DURATION}ms"
  echo "   Total processed: $TOTAL_PROCESSED products"
  echo "   Remaining: $REMAINING products"

  if [ "$COMPLETE" = "true" ] || [ "$REMAINING" = "0" ]; then
    echo ""
    echo "=========================================="
    echo "🎉 Full catalog sync complete!"
    echo "   Total processed: $TOTAL_PROCESSED products"
    echo "=========================================="
    break
  fi

  BATCH=$((BATCH + 1))
  echo "   Waiting 2 seconds before next batch..."
  sleep 2
done
