// Test sync trigger directly via production endpoint
const customerId = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

// We need a valid Supabase session token
// Let's try calling the enrichment endpoint directly instead (no auth required for internal calls)

console.log('🚀 Testing keyword enrichment directly...\n');

try {
  const response = await fetch('https://amazon-mcp-eight.vercel.app/api/bol-keywords-enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  });

  console.log(`Status: ${response.status} ${response.statusText}\n`);

  const text = await response.text();
  console.log('Raw response (first 2000 chars):');
  console.log(text.substring(0, 2000));
  console.log('\n');

  if (text.length > 2000) {
    console.log(`... (${text.length - 2000} more characters)\n`);
  }

  // Try to parse as JSON
  try {
    const data = JSON.parse(text);
    console.log('\n✅ Parsed JSON:');
    console.log(JSON.stringify(data, null, 2));
  } catch (e) {
    console.log('\n❌ Failed to parse as JSON - this is the HTML/text error');
  }

} catch (err) {
  console.error('\n❌ Fetch error:', err.message);
}
