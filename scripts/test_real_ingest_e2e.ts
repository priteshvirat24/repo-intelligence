async function testRealIngestE2E() {
  const BASE = 'http://localhost:3000';
  console.log('Testing full end-to-end ingestion pipeline...\n');

  // Submit a YouTube video for real ingestion
  const ytUrl = 'https://www.youtube.com/watch?v=0k_2hY5VvN0';
  const postRes = await fetch(`${BASE}/api/resources`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: ytUrl, forceReindex: true })
  });
  const postData = await postRes.json();
  console.log('Ingestion Initiated:', {
    status: postRes.status,
    resourceId: postData.resourceId,
    initialStatus: postData.status,
    title: postData.title
  });

  const resourceId = postData.resourceId;
  if (!resourceId) {
    throw new Error('No resourceId returned');
  }

  // Poll for completion (up to 45 seconds)
  const maxAttempts = 30;
  let attempts = 0;
  let finalStatus = postData.status;

  while (attempts < maxAttempts) {
    await new Promise(r => setTimeout(r, 1500));
    attempts++;

    const statusRes = await fetch(`${BASE}/api/resources/${resourceId}/status`);
    const statusData = await statusRes.json();
    console.log(`Poll #${attempts}: status=${statusData.status}, step=${statusData.jobStep || 'N/A'}`);

    finalStatus = statusData.status;
    if (finalStatus === 'READY' || finalStatus === 'FAILED' || finalStatus === 'BLOCKED') {
      console.log('\nTerminal State Reached:', {
        status: finalStatus,
        title: statusData.title,
        capabilitiesCount: statusData.capabilitiesCount,
        problemsSolved: statusData.problemsSolved,
        usefulFor: statusData.usefulFor,
        valueProposition: statusData.valueProposition?.slice(0, 100)
      });
      break;
    }
  }

  if (finalStatus === 'READY') {
    console.log('\nSUCCESS: End-to-end real ingestion verified! Resource is READY with full intelligence.');
  } else {
    console.log(`\nCOMPLETED with terminal state: ${finalStatus}`);
  }
}

testRealIngestE2E().catch(err => {
  console.error('E2E test error:', err);
  process.exit(1);
});
