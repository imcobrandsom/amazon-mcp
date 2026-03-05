#!/bin/bash

# Simplified test script (no jq required)
# Usage: ./test-api-simple.sh [base-url]

BASE_URL="${1:-http://localhost:3000}"

echo "🧪 Testing API endpoints at: $BASE_URL"
echo ""

echo "1️⃣  Minimal endpoint..."
curl -s "$BASE_URL/api/debug-minimal"
echo -e "\n"

echo "2️⃣  Environment variables..."
curl -s "$BASE_URL/api/debug-env"
echo -e "\n"

echo "3️⃣  Supabase connection..."
curl -s "$BASE_URL/api/debug-supabase"
echo -e "\n"

echo "4️⃣  Content table access..."
curl -s "$BASE_URL/api/debug-content-table"
echo -e "\n"

echo "5️⃣  Full diagnostics..."
curl -s "$BASE_URL/api/test-content-tables"
echo -e "\n"

echo "6️⃣  Client brief endpoint..."
curl -s "$BASE_URL/api/bol-client-brief?customerId=a260ef86-9e3a-47cf-9e59-68bf8418e6d8"
echo -e "\n"

echo "7️⃣  Content trends endpoint..."
curl -s "$BASE_URL/api/bol-content-trends?customerId=a260ef86-9e3a-47cf-9e59-68bf8418e6d8"
echo -e "\n"

echo "✅ Done!"
