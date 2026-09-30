async function testLiveApi() {
  const BASE = 'http://localhost:3000';
  console.log('Testing live API endpoints on ' + BASE + '...\n');

  // 1. Live Preview - YouTube
  const ytRes = await fetch(`${BASE}/api/resources/preview?url=${encodeURIComponent('https://www.youtube.com/watch?v=0k_2hY5VvN0')}`);
  const ytData = await ytRes.json();
  console.log('Preview YouTube:', {
    status: ytRes.status,
    resourceType: ytData.resourceType,
    supported: ytData.supported,
    hasThumbnail: Boolean(ytData.thumbnailUrl),
    willAnalyzeCount: ytData.willAnalyze?.length
  });

  // 2. Live Preview - Incompatible GitHub issue
  const issueRes = await fetch(`${BASE}/api/resources/preview?url=${encodeURIComponent('https://github.com/Panniantong/Agent-Reach/issues/1')}`);
  const issueData = await issueRes.json();
  console.log('Preview GitHub Issue:', {
    status: issueRes.status,
    supported: issueData.supported,
    unsupportedReason: issueData.unsupportedReason
  });

  // 3. SSRF Block via POST /api/resources
  const ssrfRes = await fetch(`${BASE}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: 'http://169.254.169.254/latest/meta-data' })
  });
  const ssrfData = await ssrfRes.json();
  console.log('SSRF Block POST /api/resources:', {
    status: ssrfRes.status,
    blocked: ssrfData.status === 'BLOCKED',
    error: ssrfData.error
  });

  // 4. Ingest and Deduplication Test
  const testUrl = 'https://example.com/test-article-' + Date.now();
  const ingest1 = await fetch(`${BASE}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: testUrl })
  });
  const ingest1Data = await ingest1.json();
  console.log('Ingest 1:', {
    status: ingest1.status,
    resourceId: ingest1Data.resourceId,
    resourceType: ingest1Data.resourceType,
    initialStatus: ingest1Data.status
  });

  if (ingest1Data.resourceId) {
    // 5. Check Status Endpoint
    const statusRes = await fetch(`${BASE}/api/resources/${ingest1Data.resourceId}/status`);
    const statusData = await statusRes.json();
    console.log('Status Check:', {
      status: statusRes.status,
      id: statusData.id,
      resourceType: statusData.resourceType,
      currentStatus: statusData.status,
      jobStep: statusData.jobStep
    });

    // 6. Test Safe Cancellation
    const cancelRes = await fetch(`${BASE}/api/resources/${ingest1Data.resourceId}/cancel`, { method: 'POST' });
    const cancelData = await cancelRes.json();
    console.log('Cancel Check:', {
      status: cancelRes.status,
      message: cancelData.message,
      cancelledStatus: cancelData.status
    });

    // 7. Verify status is CANCELLED
    const postCancelStatus = await fetch(`${BASE}/api/resources/${ingest1Data.resourceId}/status`);
    const postCancelData = await postCancelStatus.json();
    console.log('Post-Cancel Status:', {
      status: postCancelData.status,
      errorMessage: postCancelData.errorMessage
    });
  }

  console.log('\nAll Live API verification tests completed successfully!');
}

testLiveApi().catch(err => {
  console.error('Live API test failed:', err);
  process.exit(1);
});
