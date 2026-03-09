// Quick test of enrichment endpoint after AI disable
const customerId = 'a260ef86-9e3a-47cf-9e59-68bf8418e6d8';

console.log('🚀 Testing keyword enrichment (AI disabled, should be fast)...\n');
console.log(`Start time: ${new Date().toISOString()}\n`);

try {
  const response = await fetch('https://amazon-mcp-eight.vercel.app/api/bol-keywords-enrich', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ customerId }),
  });

  const endTime = new Date();
  console.log(`End time: ${endTime.toISOString()}`);
  console.log(`Status: ${response.status} ${response.statusText}\n`);

  if (response.ok) {
    const data = await response.json();
    console.log('✅ Success!');
    console.log(JSON.stringify(data, null, 2));
  } else {
    const text = await response.text();
    console.log('❌ Error response:');
    console.log(text.substring(0, 500));
  }

} catch (err) {
  console.error('\n❌ Fetch error:', err.message);
}
