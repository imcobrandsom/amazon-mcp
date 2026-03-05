#!/bin/bash

# Test script for debugging API endpoints
# Usage: ./test-api-endpoints.sh [base-url]
# Example: ./test-api-endpoints.sh https://your-app.vercel.app
# Or for local: ./test-api-endpoints.sh http://localhost:3000

BASE_URL="${1:-http://localhost:3000}"

echo "🧪 Testing API endpoints at: $BASE_URL"
echo ""

# Test 1: Minimal endpoint (no dependencies)
echo "1️⃣  Testing minimal endpoint..."
curl -s "$BASE_URL/api/debug-minimal" | jq '.'
echo ""

# Test 2: Environment variables
echo "2️⃣  Testing environment variables..."
curl -s "$BASE_URL/api/debug-env" | jq '.'
echo ""

# Test 3: Supabase connection (existing table)
echo "3️⃣  Testing Supabase connection..."
curl -s "$BASE_URL/api/debug-supabase" | jq '.'
echo ""

# Test 4: Content table access
echo "4️⃣  Testing content table access..."
curl -s "$BASE_URL/api/debug-content-table" | jq '.'
echo ""

# Test 5: Full diagnostics
echo "5️⃣  Testing full diagnostics..."
curl -s "$BASE_URL/api/test-content-tables" | jq '.'
echo ""

# Test 6: Anthropic API (optional - costs tokens)
read -p "Test Anthropic API? (uses tokens) [y/N]: " -n 1 -r
echo
if [[ $REPLY =~ ^[Yy]$ ]]; then
  echo "6️⃣  Testing Anthropic API..."
  curl -s "$BASE_URL/api/debug-anthropic" | jq '.'
  echo ""
fi

# Test 7: Actual content endpoints
echo "7️⃣  Testing actual content endpoints..."
CUSTOMER_ID="a260ef86-9e3a-47cf-9e59-68bf8418e6d8"

echo "  → bol-client-brief (GET)"
curl -s "$BASE_URL/api/bol-client-brief?customerId=$CUSTOMER_ID" | jq '.'
echo ""

echo "  → bol-content-trends (GET)"
curl -s "$BASE_URL/api/bol-content-trends?customerId=$CUSTOMER_ID" | jq '.'
echo ""

echo "✅ All tests completed!"
