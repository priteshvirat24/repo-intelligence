async function runApiIntegrationTests() {
  console.log('Testing Repo Intelligence Live API Endpoints...\n');
  const baseUrl = 'http://localhost:3000';

  // 1. GET /api/repositories
  const reposRes = await fetch(`${baseUrl}/api/repositories`);
  if (!reposRes.ok) throw new Error(`GET /api/repositories failed with status ${reposRes.status}`);
  const reposData = await reposRes.json();
  console.log(`✓ GET /api/repositories returned ${reposData.items.length} repositories`);

  // 2. GET /api/capabilities
  const capsRes = await fetch(`${baseUrl}/api/capabilities`);
  if (!capsRes.ok) throw new Error(`GET /api/capabilities failed with status ${capsRes.status}`);
  const capsData = await capsRes.json();
  console.log(`✓ GET /api/capabilities returned ${capsData.capabilities.length} dynamic capabilities:`);
  capsData.capabilities.forEach((c: any) => console.log(`   - ${c.name} (${c.category}) [${c.repoCount} repos]`));

  // 3. GET /api/collection
  const colRes = await fetch(`${baseUrl}/api/collection`);
  if (!colRes.ok) throw new Error(`GET /api/collection failed with status ${colRes.status}`);
  const colData = await colRes.json();
  console.log(`✓ GET /api/collection returned ${colData.stats.totalRepos} repos, ${colData.stats.totalCapabilities} capabilities, ${colData.stats.totalVerifiedEvidence} verified evidence items`);
  console.log(`   Domain clusters: ${Object.keys(colData.domainClusters).join(', ')}`);

  // 4. POST /api/chat
  console.log('\nTesting POST /api/chat with cross-repo question...');
  const chatRes = await fetch(`${baseUrl}/api/chat`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      message: 'I want to track satellites on an interactive 3D globe and calculate their orbits.'
    })
  });

  if (!chatRes.ok || !chatRes.body) {
    throw new Error(`POST /api/chat failed with status ${chatRes.status}`);
  }

  const text = await chatRes.text();
  if (!text.includes('event: metadata') || !text.includes('event: message') || !text.includes('event: done')) {
    throw new Error('POST /api/chat response missing expected SSE events');
  }

  // Extract metadata JSON
  const metaMatch = text.match(/event:\s*metadata\ndata:\s*(.+)$/m);
  if (metaMatch) {
    const meta = JSON.parse(metaMatch[1]);
    console.log(`✓ POST /api/chat returned structured metadata:`);
    console.log(`   Discovered Requirements: ${meta.requirements.requirements.map((r: any) => r.name).join(', ')}`);
    console.log(`   Inferred Data Flow Pipelines: ${meta.composition.dataFlow.length}`);
    meta.composition.dataFlow.forEach((df: any) => {
      console.log(`     [${df.producerRepo}] --(${df.output} → ${df.input})--> [${df.consumerRepo}] (${df.boundary})`);
    });
    console.log(`   Verified Citations Returned: ${meta.citations.length}`);
    meta.citations.slice(0, 3).forEach((c: any) => {
      console.log(`     - [repo:${c.repo}#${c.filePath}${c.lines ? `:${c.lines}` : ''}] ${c.symbolName ? `(${c.symbolName})` : ''} verified=${c.verified}`);
    });
  }

  console.log('\n✓ All API integration tests PASSED successfully!\n');
}

runApiIntegrationTests().catch(err => {
  console.error('Integration test failed:', err);
  process.exit(1);
});
