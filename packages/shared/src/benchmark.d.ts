export interface TestCase {
    id: string;
    query: string;
    expectedRepositories: string[];
    expectedCapabilities: string[];
    redundancyExpectations?: {
        flaggedRepos: string[];
        reason: string;
    };
    negativeAssertions: {
        forbiddenRepositories: string[];
        forbiddenCapabilities: string[];
    };
    evaluationCriteria: string;
}
export declare const EVALUATION_BENCHMARK: TestCase[];
