import {
  OpenQueryRequirements,
  OpenRequirement,
  CandidateScore,
  CompositionPlan,
  ArchitectureGraphData,
  ArchitectureNode,
  ArchitectureEdge,
  KnowledgeObject
} from '@repo/shared';

export class OpenRepositoryCompositionEngine {
  compose(
    requirements: OpenQueryRequirements,
    candidates: CandidateScore[],
    rawObjectsByRepo: Map<string, KnowledgeObject[]>
  ): CompositionPlan {
    const coverage: Record<string, {
      providedBy: string[];
      status: 'COVERED' | 'PARTIAL' | 'MISSING';
      notes?: string;
    }> = {};

    // 1. Initialize coverage mapping for all requirements
    for (const req of requirements.requirements) {
      coverage[req.name] = {
        providedBy: [],
        status: 'MISSING'
      };
    }

    // 2. Evaluate requirement coverage against candidate repositories
    for (const candidate of candidates) {
      const repoName = `${candidate.owner}/${candidate.repositoryName}`;
      const repoObjects = rawObjectsByRepo.get(candidate.repositoryId) || [];
      const repoCapabilities = candidate.matchedCapabilities.map(c => c.toLowerCase());
      const repoConcepts = (candidate.matchedConcepts || []).map(c => c.toLowerCase());

      for (const req of requirements.requirements) {
        const reqWords = req.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
        const reqDescWords = req.description.toLowerCase().split(/\s+/).filter(w => w.length > 3);

        const capMatch = repoCapabilities.some(c => 
          reqWords.some(w => c.includes(w)) || (req.canonicalSlug && c.includes(req.canonicalSlug))
        );
        const concMatch = repoConcepts.some(c => reqWords.some(w => c.includes(w)));
        const objMatch = repoObjects.some(o => 
          reqWords.some(w => o.name.toLowerCase().includes(w) || o.description.toLowerCase().includes(w))
        );

        if (capMatch || concMatch || objMatch) {
          coverage[req.name].providedBy.push(repoName);
          coverage[req.name].status = 'COVERED';
        }
      }
    }

    // 3. Detect Uncovered Requirements
    const uncoveredRequirements: OpenRequirement[] = [];
    for (const req of requirements.requirements) {
      if (coverage[req.name].status === 'MISSING') {
        uncoveredRequirements.push(req);
      }
    }

    // 4. Input / Output Data Flow Matching
    const dataFlow: CompositionPlan['dataFlow'] = [];
    const allRepoInputs = new Map<string, Array<{ name: string; format: string }>>();
    const allRepoOutputs = new Map<string, Array<{ name: string; format: string }>>();

    for (const candidate of candidates) {
      const repoKey = `${candidate.owner}/${candidate.repositoryName}`;
      const repoObjects = rawObjectsByRepo.get(candidate.repositoryId) || [];

      const inputs = repoObjects.filter(o => o.objectType === 'input').map(o => ({
        name: o.name,
        format: o.description || o.name
      }));
      const outputs = repoObjects.filter(o => o.objectType === 'output').map(o => ({
        name: o.name,
        format: o.description || o.name
      }));

      allRepoInputs.set(repoKey, inputs);
      allRepoOutputs.set(repoKey, outputs);
    }

    // Compare outputs of candidate A with inputs of candidate B
    const candidateKeys = candidates.map(c => `${c.owner}/${c.repositoryName}`);
    for (let i = 0; i < candidateKeys.length; i++) {
      for (let j = 0; j < candidateKeys.length; j++) {
        if (i === j) continue;
        const repoA = candidateKeys[i];
        const repoB = candidateKeys[j];
        const outputsA = allRepoOutputs.get(repoA) || [];
        const inputsB = allRepoInputs.get(repoB) || [];

        for (const out of outputsA) {
          for (const inp of inputsB) {
            const outWords = out.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);
            const isMatch = outWords.some(w => inp.name.toLowerCase().includes(w) || inp.format.toLowerCase().includes(w));
            if (isMatch) {
              const candidateAObj = candidates.find(c => `${c.owner}/${c.repositoryName}` === repoA);
              const candidateBObj = candidates.find(c => `${c.owner}/${c.repositoryName}` === repoB);
              const sameLang = candidateAObj?.primaryLanguage === candidateBObj?.primaryLanguage;
              const boundary = sameLang ? 'library' : 'http-service';

              dataFlow.push({
                producerRepo: repoA,
                output: out.name,
                consumerRepo: repoB,
                input: inp.name,
                boundary
              });
            }
          }
        }
      }
    }

    // 5. Select Minimal Viable Architecture Stack
    // Greedy set cover prioritizing MUST requirements with minimum number of components
    const selectedRepos: CandidateScore[] = [];
    const coveredMusts = new Set<string>();
    const mustRequirements = requirements.requirements.filter(r => r.criticality === 'MUST');

    for (const candidate of candidates) {
      const repoKey = `${candidate.owner}/${candidate.repositoryName}`;
      let addsNewMust = false;

      for (const mustReq of mustRequirements) {
        if (!coveredMusts.has(mustReq.name) && coverage[mustReq.name]?.providedBy.includes(repoKey)) {
          addsNewMust = true;
          coveredMusts.add(mustReq.name);
        }
      }

      if (addsNewMust || (selectedRepos.length === 0 && candidate.finalScore > 0.45)) {
        selectedRepos.push(candidate);
      }
    }

    // 6. Redundancy & Overlap Analysis
    const redundancies: CompositionPlan['redundancies'] = [];
    for (const [reqName, data] of Object.entries(coverage)) {
      if (data.providedBy.length > 1) {
        const selectedOverlap = data.providedBy.filter(r => 
          selectedRepos.some(s => `${s.owner}/${s.repositoryName}` === r)
        );
        if (selectedOverlap.length > 1) {
          redundancies.push({
            capabilityOrFeature: reqName,
            overlappingRepositories: selectedOverlap,
            overlapType: 'partial',
            recommendation: `Both ${selectedOverlap.join(' and ')} implement capability for '${reqName}'. Prefer native in-process integration over wrapping duplicate functionality.`
          });
        }
      }
    }

    // 7. Construct Architecture Graph Data
    const nodes: ArchitectureNode[] = selectedRepos.map(repo => {
      const repoKey = `${repo.owner}/${repo.repositoryName}`;
      const repoObjects = rawObjectsByRepo.get(repo.repositoryId) || [];
      const profile = repoObjects.find(o => o.objectType === 'repository_profile');
      const role = repo.matchedCapabilities[0] || profile?.name || repo.primaryLanguage || 'Component';

      return {
        id: repo.repositoryId,
        label: repo.repositoryName,
        role,
        domain: repo.domainTags?.[0] || 'engineering'
      };
    });

    const edges: ArchitectureEdge[] = [];
    for (let i = 0; i < selectedRepos.length - 1; i++) {
      const fromRepo = selectedRepos[i];
      const toRepo = selectedRepos[i + 1];
      const sameLang = fromRepo.primaryLanguage === toRepo.primaryLanguage;

      // Find if an explicit data flow exists
      const flow = dataFlow.find(df => 
        df.producerRepo === `${fromRepo.owner}/${fromRepo.repositoryName}` &&
        df.consumerRepo === `${toRepo.owner}/${toRepo.repositoryName}`
      );

      edges.push({
        from: fromRepo.repositoryId,
        to: toRepo.repositoryId,
        relationship: flow ? 'produces-consumes' : 'integrates-with',
        label: flow ? `${flow.output} → ${flow.input}` : 'pipeline',
        boundary: flow ? (flow.boundary as any) : (sameLang ? 'library' : 'http-service')
      });
    }

    const graphData: ArchitectureGraphData = { nodes, edges };

    // 8. Synthesis Summary
    const totalMust = mustRequirements.length;
    const coveredMustCount = coveredMusts.size;
    const summary = selectedRepos.length === 1
      ? `Single-repository solution: '${selectedRepos[0].owner}/${selectedRepos[0].repositoryName}' satisfies ${coveredMustCount}/${totalMust} critical requirements.`
      : `Composed multi-repository architecture: ${selectedRepos.length} components satisfy ${coveredMustCount}/${totalMust} critical requirements with ${dataFlow.length} inferred data flow pipelines.`;

    return {
      recommendedRepositories: selectedRepos,
      architectureGraph: graphData,
      capabilityCoverage: coverage,
      redundancies,
      dataFlow,
      uncoveredRequirements,
      synthesisSummary: summary
    };
  }
}
