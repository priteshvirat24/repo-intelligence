import {
  OpenQueryRequirements,
  OpenRequirement,
  CandidateScore,
  CompositionPlan,
  ArchitectureGraphData,
  ArchitectureNode,
  ArchitectureEdge,
  KnowledgeObject,
  CompatibilityLevel,
  ResourceRole
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

    // 2. Separate Executable Software Components from Information Resources (YouTube, PDF, Articles, Docs)
    const executableCandidates: CandidateScore[] = [];
    const knowledgeCandidates: CandidateScore[] = [];
    const knowledgeReferences: NonNullable<CompositionPlan['knowledgeReferences']> = [];

    for (const c of candidates) {
      const isExecutable =
        c.resourceType === 'github_repository' ||
        ['software_component', 'library', 'framework'].includes(c.resourceRole || '');

      if (isExecutable) {
        executableCandidates.push(c);
      } else {
        knowledgeCandidates.push(c);
        const contributionType =
          c.resourceType === 'youtube_video' ? 'tutorial_guide' :
          c.resourceType === 'pdf' || c.resourceType === 'research_paper' ? 'methodology' :
          c.resourceType === 'documentation_site' ? 'api_specification' : 'conceptual_background';

        knowledgeReferences.push({
          resourceId: c.resourceId || c.repositoryId || '',
          resourceTitle: c.repositoryName,
          resourceRole: (c.resourceRole || 'reference') as ResourceRole,
          sourceUrl: c.sourceUrl || '',
          contributionType,
          explanation: `Provides ${contributionType.replace('_', ' ')} and conceptual grounding for ${c.matchedCapabilities.slice(0, 3).join(', ')}.`
        });
      }
    }

    // 3. Evaluate requirement coverage across all candidates
    for (const candidate of candidates) {
      const repoName = candidate.owner ? `${candidate.owner}/${candidate.repositoryName}` : candidate.repositoryName;
      const repoId = candidate.repositoryId || candidate.resourceId || '';
      const repoObjects = rawObjectsByRepo.get(repoId) || [];
      const repoCapabilities = candidate.matchedCapabilities.map(c => c.toLowerCase());
      const repoConcepts = (candidate.matchedConcepts || []).map(c => c.toLowerCase());

      for (const req of requirements.requirements) {
        const reqWords = req.name.toLowerCase().split(/\s+/).filter(w => w.length > 3);

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

    // 4. Detect Uncovered Requirements
    const uncoveredRequirements: OpenRequirement[] = [];
    for (const req of requirements.requirements) {
      if (coverage[req.name].status === 'MISSING') {
        uncoveredRequirements.push(req);
      }
    }

    // 5. Strict Input / Output Data Flow Matching with Compatibility Levels
    const dataFlow: CompositionPlan['dataFlow'] = [];
    const allRepoInputs = new Map<string, Array<{ name: string; format: string; evidence?: string }>>();
    const allRepoOutputs = new Map<string, Array<{ name: string; format: string; evidence?: string }>>();

    // Only executable components can participate in runtime data flow
    for (const candidate of executableCandidates) {
      const repoKey = candidate.owner ? `${candidate.owner}/${candidate.repositoryName}` : candidate.repositoryName;
      const repoId = candidate.repositoryId || candidate.resourceId || '';
      const repoObjects = rawObjectsByRepo.get(repoId) || [];

      const inputs = repoObjects.filter(o => o.objectType === 'input').map(o => ({
        name: o.name,
        format: o.description || o.name,
        evidence: o.metadata?.evidenceRef || o.name
      }));
      const outputs = repoObjects.filter(o => o.objectType === 'output').map(o => ({
        name: o.name,
        format: o.description || o.name,
        evidence: o.metadata?.evidenceRef || o.name
      }));

      allRepoInputs.set(repoKey, inputs);
      allRepoOutputs.set(repoKey, outputs);
    }

    const candidateKeys = executableCandidates.map(c =>
      c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName
    );

    for (let i = 0; i < candidateKeys.length; i++) {
      for (let j = 0; j < candidateKeys.length; j++) {
        if (i === j) continue;
        const repoA = candidateKeys[i];
        const repoB = candidateKeys[j];
        const outputsA = allRepoOutputs.get(repoA) || [];
        const inputsB = allRepoInputs.get(repoB) || [];

        for (const out of outputsA) {
          for (const inp of inputsB) {
            const outLower = out.name.toLowerCase().trim();
            const inpLower = inp.name.toLowerCase().trim();
            const outFormatLower = out.format.toLowerCase().trim();
            const inpFormatLower = inp.format.toLowerCase().trim();

            const isExactMatch = outLower === inpLower || outFormatLower === inpFormatLower;
            const isGenericFormat = ['json', 'string', 'stream', 'data', 'object', 'bytes'].includes(outLower) ||
                                    ['json', 'string', 'stream', 'data', 'object', 'bytes'].includes(inpLower);

            const outWords = outLower.split(/\s+/).filter(w => w.length > 3);
            const isSemanticMatch = outWords.some(w => inpLower.includes(w) || inpFormatLower.includes(w));

            let compatibilityLevel: CompatibilityLevel = 'UNKNOWN';
            if (isExactMatch && !isGenericFormat) {
              compatibilityLevel = 'VERIFIED';
            } else if (isSemanticMatch && !isGenericFormat) {
              compatibilityLevel = 'STRONGLY_INFERRED';
            } else if (isExactMatch && isGenericFormat) {
              compatibilityLevel = 'POSSIBLE';
            } else if (isSemanticMatch && isGenericFormat) {
              compatibilityLevel = 'POSSIBLE';
            }

            if (compatibilityLevel !== 'UNKNOWN') {
              const candidateAObj = executableCandidates.find(c => (c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName) === repoA);
              const candidateBObj = executableCandidates.find(c => (c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName) === repoB);
              const sameLang = candidateAObj?.primaryLanguage === candidateBObj?.primaryLanguage;
              const boundary = sameLang ? 'library' : 'http-service';

              dataFlow.push({
                producerRepo: repoA,
                output: out.name,
                consumerRepo: repoB,
                input: inp.name,
                boundary,
                compatibilityLevel,
                evidence: `Producer contract '${out.name} (${out.format})' -> Consumer contract '${inp.name} (${inp.format})'`
              });
            }
          }
        }
      }
    }

    // 6. "One Resource is Enough" & Minimal Viable Architecture Stack Selection
    const selectedExecutableRepos: CandidateScore[] = [];
    const coveredMusts = new Set<string>();
    const mustRequirements = requirements.requirements.filter(r => r.criticality === 'MUST');

    if (executableCandidates.length > 0) {
      const topCandidate = executableCandidates[0];
      const topKey = topCandidate.owner ? `${topCandidate.owner}/${topCandidate.repositoryName}` : topCandidate.repositoryName;
      const topCoveredMusts = mustRequirements.filter(m => coverage[m.name]?.providedBy.includes(topKey));

      // SINGLE-RESOURCE MINIMALIZATION CHECK:
      // If one candidate covers all critical MUST requirements, select only that one without forcing a stack!
      if (mustRequirements.length > 0 && topCoveredMusts.length === mustRequirements.length) {
        selectedExecutableRepos.push(topCandidate);
        for (const m of topCoveredMusts) coveredMusts.add(m.name);
      } else {
        // Multi-repository greedy set cover: only add candidate if it genuinely covers an uncovered MUST requirement
        for (const candidate of executableCandidates) {
          const repoKey = candidate.owner ? `${candidate.owner}/${candidate.repositoryName}` : candidate.repositoryName;
          let addsNewMust = false;

          for (const mustReq of mustRequirements) {
            if (!coveredMusts.has(mustReq.name) && coverage[mustReq.name]?.providedBy.includes(repoKey)) {
              addsNewMust = true;
              coveredMusts.add(mustReq.name);
            }
          }

          if (addsNewMust) {
            selectedExecutableRepos.push(candidate);
            if (selectedExecutableRepos.length >= 3) break;
          }
        }

        // If no MUST requirements existed, select top 1-2 relevant components
        if (selectedExecutableRepos.length === 0 && executableCandidates.length > 0) {
          selectedExecutableRepos.push(executableCandidates[0]);
        }
      }
    }

    // 7. Redundancy & Overlap Analysis
    const redundancies: CompositionPlan['redundancies'] = [];
    for (const [reqName, data] of Object.entries(coverage)) {
      if (data.providedBy.length > 1) {
        const selectedOverlap = data.providedBy.filter(r =>
          selectedExecutableRepos.some(s => (s.owner ? `${s.owner}/${s.repositoryName}` : s.repositoryName) === r)
        );
        if (selectedOverlap.length > 1) {
          const repoA = selectedOverlap[0];
          const repoB = selectedOverlap[1];
          const candA = executableCandidates.find(c => (c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName) === repoA);
          const candB = executableCandidates.find(c => (c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName) === repoB);

          const sameLang = candA?.primaryLanguage === candB?.primaryLanguage;
          const overlapType = sameLang ? 'full' : 'complementary';

          redundancies.push({
            capabilityOrFeature: reqName,
            overlappingRepositories: selectedOverlap,
            overlapType,
            recommendation: sameLang
              ? `Both ${selectedOverlap.join(' and ')} implement '${reqName}' in the same language stack (${candA?.primaryLanguage}). Select ${candA && candB && (candA.stars || 0) >= (candB.stars || 0) ? repoA : repoB} to avoid duplicate dependencies.`
              : `${selectedOverlap.join(' and ')} offer complementary language implementations (${candA?.primaryLanguage} vs ${candB?.primaryLanguage}) for '${reqName}'.`
          });
        }
      }
    }

    // 8. Grounded Architecture Graph Generation (NO INVENTED EDGES!)
    const nodes: ArchitectureNode[] = selectedExecutableRepos.map(repo => {
      const repoId = repo.repositoryId || repo.resourceId || '';
      const repoObjects = rawObjectsByRepo.get(repoId) || [];
      const profile = repoObjects.find(o => o.objectType === 'repository_profile');
      const role = repo.matchedCapabilities[0] || profile?.name || repo.primaryLanguage || 'Component';

      return {
        id: repoId,
        label: repo.repositoryName,
        role,
        resourceType: repo.resourceType,
        resourceRole: repo.resourceRole,
        domain: repo.domainTags?.[0] || 'engineering'
      };
    });

    const edges: ArchitectureEdge[] = [];

    // ONLY generate an edge if an explicit verified or strongly inferred dataFlow exists between nodes!
    // NEVER invent arbitrary chain edges between consecutive nodes!
    for (const flow of dataFlow) {
      const fromCandidate = selectedExecutableRepos.find(c =>
        (c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName) === flow.producerRepo
      );
      const toCandidate = selectedExecutableRepos.find(c =>
        (c.owner ? `${c.owner}/${c.repositoryName}` : c.repositoryName) === flow.consumerRepo
      );

      if (fromCandidate && toCandidate) {
        const fromId = fromCandidate.repositoryId || fromCandidate.resourceId || '';
        const toId = toCandidate.repositoryId || toCandidate.resourceId || '';

        // Prevent duplicate edges
        const edgeKey = `${fromId}->${toId}`;
        const alreadyExists = edges.some(e => `${e.from}->${e.to}` === edgeKey);
        if (!alreadyExists) {
          edges.push({
            from: fromId,
            to: toId,
            relationship: 'produces-consumes',
            label: `${flow.output} → ${flow.input}`,
            boundary: flow.boundary as any,
            compatibilityLevel: flow.compatibilityLevel,
            reason: `Component '${fromCandidate.repositoryName}' outputs '${flow.output}' which satisfies input requirement '${flow.input}' of '${toCandidate.repositoryName}'.`,
            dataFlowSnippet: `${flow.output} -> ${flow.input}`,
            evidenceRef: flow.evidence
          });
        }
      }
    }

    const architectureGraph: ArchitectureGraphData = { nodes, edges };

    // 9. Synthesis Summary
    const totalMust = mustRequirements.length;
    const coveredMustCount = coveredMusts.size;
    let summary = '';

    if (selectedExecutableRepos.length === 1) {
      const single = selectedExecutableRepos[0];
      summary = `Single-resource solution: '${single.owner ? `${single.owner}/` : ''}${single.repositoryName}' satisfies ${coveredMustCount}/${totalMust} critical requirements without requiring multi-repository composition.`;
    } else if (selectedExecutableRepos.length > 1) {
      summary = `Composed multi-component architecture: ${selectedExecutableRepos.length} executable components satisfy ${coveredMustCount}/${totalMust} critical requirements with ${edges.length} grounded integration edges.`;
    } else if (knowledgeReferences.length > 0) {
      summary = `Knowledge-grounded solution: ${knowledgeReferences.length} reference resources provide methodology, architectural patterns, and API specifications.`;
    } else {
      summary = `No verified internal resource currently satisfies the specified critical requirements.`;
    }

    return {
      recommendedRepositories: selectedExecutableRepos,
      architectureGraph,
      capabilityCoverage: coverage,
      redundancies,
      dataFlow,
      knowledgeReferences,
      uncoveredRequirements,
      synthesisSummary: summary
    };
  }
}
