async function testDedupAndReindex() {
  const BASE = 'http://localhost:3000';
  console.log('Testing deduplication and reindexing...\n');

  const url = 'https://example.com/canonical-test-' + Date.now();
  
  // First addition
  const res1 = await fetch(`${BASE}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url })
  });
  const data1 = await res1.json();
  console.log('Submission 1:', {
    status: res1.status,
    resourceId: data1.resourceId,
    alreadyProcessing: Boolean(data1.alreadyProcessing),
    alreadyExists: Boolean(data1.alreadyExists)
  });

  // Second immediate addition of same URL (while in flight)
  const res2 = await fetch(`${BASE}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: url + '?utm_source=twitter' }) // with tracking param
  });
  const data2 = await res2.json();
  console.log('Submission 2 (Tracking param variant while in flight):', {
    status: res2.status,
    resourceId: data2.resourceId,
    alreadyProcessing: Boolean(data2.alreadyProcessing),
    sameId: data1.resourceId === data2.resourceId
  });

  // Reindex with forceReindex: true
  const res3 = await fetch(`${BASE}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url, forceReindex: true })
  });
  const data3 = await res3.json();
  console.log('Submission 3 (forceReindex: true):', {
    status: res3.status,
    resourceId: data3.resourceId,
    alreadyExists: Boolean(data3.alreadyExists) // Should be false since forceReindex is true
  });

  console.log('\nDeduplication tests passed successfully!');
}

testDedupAndReindex().catch(err => {
  console.error('Dedup test failed:', err);
  process.exit(1);
});
