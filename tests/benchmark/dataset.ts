import { ResourceType, ResourceRole } from '@repo/shared';

export interface BenchmarkResource {
  id: string;
  title: string;
  sourceUrl: string;
  resourceType: ResourceType;
  expectedRole: ResourceRole;
  domain: string;
  isUnknownDomain: boolean; // >= 30% must be completely novel concepts not in standard seed
  description: string;
  groundTruthCapabilities: string[];
  groundTruthConcepts: string[];
  groundTruthUseCases: string[];
  sampleQuery: string;
  expectedRetrievalTerms: string[];
}

export const BENCHMARK_DATASET: BenchmarkResource[] = [
  // ==========================================
  // 1. GITHUB REPOSITORIES (10)
  // ==========================================
  {
    id: 'gh-1-sgp4',
    title: 'brandon-rhodes/python-sgp4',
    sourceUrl: 'https://github.com/brandon-rhodes/python-sgp4',
    resourceType: 'github_repository',
    expectedRole: 'library',
    domain: 'satellite systems / orbital mechanics',
    isUnknownDomain: true,
    description: 'Track Earth satellite positions using standard SGP4/SDP4 models from Two-Line Element (TLE) sets.',
    groundTruthCapabilities: ['SGP4 orbital propagation', 'TLE parsing', 'ECI state vector calculation'],
    groundTruthConcepts: ['Two-Line Elements', 'Geocentric Equatorial Coordinates', 'Gravitational perturbations'],
    groundTruthUseCases: ['Predict satellite ground passes', 'Space situational awareness'],
    sampleQuery: 'calculate where a satellite will be from orbital elements',
    expectedRetrievalTerms: ['sgp4', 'satellite', 'propagation', 'orbit']
  },
  {
    id: 'gh-2-gjk',
    title: 'kevinmoran/GJK',
    sourceUrl: 'https://github.com/kevinmoran/GJK',
    resourceType: 'github_repository',
    expectedRole: 'library',
    domain: 'games / physics simulation',
    isUnknownDomain: true,
    description: '3D implementation of the Gilbert-Johnson-Keerthi (GJK) collision detection algorithm in C.',
    groundTruthCapabilities: ['GJK collision detection', 'Minkowski difference simplex solving', 'Convex hull proximity testing'],
    groundTruthConcepts: ['Minkowski Difference', 'Support Mapping', 'Simplex Evolution'],
    groundTruthUseCases: ['Physics engine narrow-phase collision detection', 'Robotics obstacle clearance'],
    sampleQuery: 'detect 3D collision between convex meshes without mesh discretization',
    expectedRetrievalTerms: ['gjk', 'collision', 'simplex', 'convex']
  },
  {
    id: 'gh-3-colmap',
    title: 'colmap/colmap',
    sourceUrl: 'https://github.com/colmap/colmap',
    resourceType: 'github_repository',
    expectedRole: 'software_component',
    domain: 'computer vision / photogrammetry',
    isUnknownDomain: true,
    description: 'General-purpose Structure-from-Motion (SfM) and Multi-View Stereo (MVS) pipeline with GUI and CLI.',
    groundTruthCapabilities: ['Structure-from-Motion pipeline', 'Multi-view stereo dense reconstruction', 'Bundle adjustment'],
    groundTruthConcepts: ['Epipolar geometry', 'SIFT feature matching', 'Dense point cloud triangulation'],
    groundTruthUseCases: ['Reconstruct 3D scene from drone photos', 'Geodetic survey 3D mapping'],
    sampleQuery: 'reconstruct a 3D model from multiple overlapping drone images',
    expectedRetrievalTerms: ['photogrammetry', 'sfm', 'stereo', 'reconstruction']
  },
  {
    id: 'gh-4-treetime',
    title: 'polaklab/treetime',
    sourceUrl: 'https://github.com/polaklab/treetime',
    resourceType: 'github_repository',
    expectedRole: 'library',
    domain: 'bioinformatics / evolutionary biology',
    isUnknownDomain: true,
    description: 'Maximum-likelihood phylodynamic analysis, ancestral state reconstruction, and molecular dating.',
    groundTruthCapabilities: ['Maximum-likelihood phylogenetic inference', 'Molecular clock dating', 'Ancestral sequence reconstruction'],
    groundTruthConcepts: ['Phylogenetic tree', 'Branch length optimization', 'Substitution model'],
    groundTruthUseCases: ['Viral mutation tracking during epidemic outbreaks', 'Evolutionary ancestry analysis'],
    sampleQuery: 'estimate the date of the most recent common ancestor from genetic sequences',
    expectedRetrievalTerms: ['phylogenetic', 'treetime', 'mutation', 'tree']
  },
  {
    id: 'gh-5-xarray',
    title: 'pydata/xarray',
    sourceUrl: 'https://github.com/pydata/xarray',
    resourceType: 'github_repository',
    expectedRole: 'library',
    domain: 'scientific computing / geospatial',
    isUnknownDomain: true,
    description: 'N-D labeled arrays and datasets in Python, widely used for climate, oceanographic, and hydrological simulation.',
    groundTruthCapabilities: ['Labeled multi-dimensional array operations', 'NetCDF / Zarr geospatial dataset indexing', 'Out-of-core Dask computation'],
    groundTruthConcepts: ['Spatiotemporal dimensions', 'Coordinate alignment', 'Hydrological raster operations'],
    groundTruthUseCases: ['Global climate model precipitation analysis', 'Hydrological runoff spatial analysis'],
    sampleQuery: 'process NetCDF climate and hydrological raster grids with coordinate dimensions',
    expectedRetrievalTerms: ['xarray', 'dataset', 'geospatial', 'dimensions']
  },
  {
    id: 'gh-6-ego-lite',
    title: 'citrolabs/ego-lite',
    sourceUrl: 'https://github.com/citrolabs/ego-lite',
    resourceType: 'github_repository',
    expectedRole: 'software_component',
    domain: 'robotics / simulation',
    isUnknownDomain: false,
    description: 'Lightweight autonomous vehicle and ego-motion simulator designed for spatial trajectory testing.',
    groundTruthCapabilities: ['Ego-motion trajectory simulation', 'Sensor telemetry streaming', 'Vehicle kinematic state tracking'],
    groundTruthConcepts: ['Kinematic bicycle model', 'Spatial trajectory', 'Waypoint navigation'],
    groundTruthUseCases: ['Test autonomous vehicle path planning', 'Validate collision avoidance'],
    sampleQuery: 'simulate vehicle ego-motion trajectory and telemetry',
    expectedRetrievalTerms: ['ego', 'trajectory', 'simulation', 'vehicle']
  },
  {
    id: 'gh-7-scout',
    title: 'kiryano/Scout',
    sourceUrl: 'https://github.com/kiryano/Scout',
    resourceType: 'github_repository',
    expectedRole: 'software_component',
    domain: 'security / developer tools',
    isUnknownDomain: false,
    description: 'Static security scanner and vulnerability assessment tool for software dependencies and manifests.',
    groundTruthCapabilities: ['Static vulnerability scanning', 'Dependency tree audit', 'CVE database cross-referencing'],
    groundTruthConcepts: ['Software supply chain security', 'Vulnerability scoring', 'Security posture'],
    groundTruthUseCases: ['Automated security gate in CI/CD', 'Audit third-party dependencies'],
    sampleQuery: 'scan dependencies for known vulnerabilities and CVEs',
    expectedRetrievalTerms: ['security', 'vulnerability', 'scan', 'audit']
  },
  {
    id: 'gh-8-agency-agents',
    title: 'msitarzewski/agency-agents',
    sourceUrl: 'https://github.com/msitarzewski/agency-agents',
    resourceType: 'github_repository',
    expectedRole: 'framework',
    domain: 'AI / autonomous agents',
    isUnknownDomain: false,
    description: 'Multi-agent orchestration framework for autonomous collaborative software workflows.',
    groundTruthCapabilities: ['Multi-agent role coordination', 'Task queue delegation', 'Agent state persistence'],
    groundTruthConcepts: ['Agent communication protocol', 'Role decomposition', 'Shared workspace'],
    groundTruthUseCases: ['Orchestrate team of specialized AI agents', 'Automated code review workflow'],
    sampleQuery: 'orchestrate multiple autonomous agents working collaboratively on a task',
    expectedRetrievalTerms: ['agent', 'orchestration', 'multi-agent', 'workflow']
  },
  {
    id: 'gh-9-agent-reach',
    title: 'Panniantong/Agent-Reach',
    sourceUrl: 'https://github.com/Panniantong/Agent-Reach',
    resourceType: 'github_repository',
    expectedRole: 'software_component',
    domain: 'developer tools / automation',
    isUnknownDomain: false,
    description: 'Autonomous communication and web outreach agent toolkit for developer notifications and integrations.',
    groundTruthCapabilities: ['Automated notification dispatch', 'Web channel integration', 'Message template rendering'],
    groundTruthConcepts: ['Outreach automation', 'Rate limiting', 'Event hooks'],
    groundTruthUseCases: ['Automate status notifications across communication channels'],
    sampleQuery: 'automated developer outreach and notification dispatch',
    expectedRetrievalTerms: ['outreach', 'notification', 'communication']
  },
  {
    id: 'gh-10-sourcemap',
    title: 'danvk/source-map-visualization',
    sourceUrl: 'https://github.com/danvk/source-map-visualization',
    resourceType: 'github_repository',
    expectedRole: 'software_component',
    domain: 'developer tools / web performance',
    isUnknownDomain: false,
    description: 'Interactive visualization and debugging tool for JavaScript/TypeScript source maps.',
    groundTruthCapabilities: ['Source map decoding', 'Bundle size inspection', 'Original-to-generated line mapping'],
    groundTruthConcepts: ['VLQ encoding', 'Source map specification', 'Bundle optimization'],
    groundTruthUseCases: ['Debug production stack traces', 'Analyze minified bundle composition'],
    sampleQuery: 'visualize and decode source maps to see what code is inside a bundle',
    expectedRetrievalTerms: ['source-map', 'bundle', 'visualization']
  },

  // ==========================================
  // 2. TECHNICAL ARTICLES (5)
  // ==========================================
  {
    id: 'art-1-gps',
    title: 'GPS - Bartosz Ciechanowski',
    sourceUrl: 'https://ciechanow.ski/gps/',
    resourceType: 'article',
    expectedRole: 'article',
    domain: 'satellite systems / geospatial',
    isUnknownDomain: true,
    description: 'In-depth interactive breakdown of Global Positioning System, satellite constellations, time dilation, and trilateration.',
    groundTruthCapabilities: ['Pseudorange calculation explanation', 'Relativistic clock correction', 'Sphere trilateration mathematical analysis'],
    groundTruthConcepts: ['Trilateration', 'Special and General Relativity time shift', 'Geometric Dilution of Precision (GDOP)'],
    groundTruthUseCases: ['Understand GPS receiver positioning mathematics', 'Design geospatial positioning algorithms'],
    sampleQuery: 'how do satellites calculate geographic coordinates using time delay',
    expectedRetrievalTerms: ['gps', 'trilateration', 'satellite', 'clock']
  },
  {
    id: 'art-2-watch',
    title: 'Mechanical Watch - Bartosz Ciechanowski',
    sourceUrl: 'https://ciechanow.ski/mechanical-watch/',
    resourceType: 'article',
    expectedRole: 'article',
    domain: 'simulation / mechanics',
    isUnknownDomain: true,
    description: 'Detailed mechanical engineering dissection of gear trains, balance springs, and escapement mechanisms.',
    groundTruthCapabilities: ['Kinematic gear train ratio calculation', 'Swiss lever escapement physics explanation', 'Balance wheel harmonic oscillation modeling'],
    groundTruthConcepts: ['Escapement', 'Gear ratio kinematics', 'Harmonic oscillator'],
    groundTruthUseCases: ['Mechanical CAD design modeling', 'Clockwork physics simulation'],
    sampleQuery: 'kinematics of mechanical gear trains and escapement oscillation',
    expectedRetrievalTerms: ['gear', 'escapement', 'mechanical', 'oscillation']
  },
  {
    id: 'art-3-file-consistency',
    title: 'Can Applications Recover from fsync Failures? - Dan Luu',
    sourceUrl: 'https://danluu.com/file-consistency/',
    resourceType: 'article',
    expectedRole: 'article',
    domain: 'security / storage systems',
    isUnknownDomain: false,
    description: 'Empirical analysis of file system crash consistency, fsync behavior, and database ACID durability bugs across OS kernels.',
    groundTruthCapabilities: ['POSIX fsync failure mode analysis', 'Database write-ahead log corruption auditing', 'Buffer cache flush analysis'],
    groundTruthConcepts: ['ACID durability', 'Page cache writeback', 'Silent data corruption'],
    groundTruthUseCases: ['Design crash-safe storage engines', 'Audit database persistence layer reliability'],
    sampleQuery: 'how to handle fsync errors safely in a database write-ahead log',
    expectedRetrievalTerms: ['fsync', 'consistency', 'storage', 'crash']
  },
  {
    id: 'art-4-instant-logs',
    title: 'How we built Instant Logs - Cloudflare Blog',
    sourceUrl: 'https://blog.cloudflare.com/how-we-built-instant-logs',
    resourceType: 'article',
    expectedRole: 'article',
    domain: 'developer tools / distributed systems',
    isUnknownDomain: false,
    description: 'Architecture of a high-throughput, low-latency log streaming system over WebSockets using distributed pipelines.',
    groundTruthCapabilities: ['Distributed real-time log streaming', 'Dynamic WebSocket session multiplexing', 'Rate-limited tail filtering'],
    groundTruthConcepts: ['Log streaming', 'Zero-buffer pipeline', 'Backpressure propagation'],
    groundTruthUseCases: ['Live production traffic debugging', 'Distributed trace inspection'],
    sampleQuery: 'stream high volume production logs in real time over websockets',
    expectedRetrievalTerms: ['logs', 'streaming', 'websocket', 'cloudflare']
  },
  {
    id: 'art-5-lilian-agent',
    title: 'LLM Powered Autonomous Agents - Lilian Weng',
    sourceUrl: 'https://lilianweng.github.io/posts/2023-06-23-agent/',
    resourceType: 'article',
    expectedRole: 'article',
    domain: 'AI / cognitive architectures',
    isUnknownDomain: false,
    description: 'Systematic architectural survey of agent planning, memory systems, tool usage, and self-reflection patterns.',
    groundTruthCapabilities: ['Agent planning decomposition analysis', 'Short-term and long-term memory architecture comparison', 'Tool use orchestration patterns'],
    groundTruthConcepts: ['Tree of Thoughts', 'ReAct prompting', 'Episodic memory vs semantic memory'],
    groundTruthUseCases: ['Architect reliable multi-step AI agents', 'Design agent memory systems'],
    sampleQuery: 'how to structure planning and memory in autonomous LLM agents',
    expectedRetrievalTerms: ['agent', 'planning', 'memory', 'react']
  },

  // ==========================================
  // 3. DOCUMENTATION PAGES (5)
  // ==========================================
  {
    id: 'doc-1-fastapi',
    title: 'Tutorial - User Guide - FastAPI',
    sourceUrl: 'https://fastapi.tiangolo.com/tutorial/',
    resourceType: 'documentation_site',
    expectedRole: 'documentation',
    domain: 'developer tools / web APIs',
    isUnknownDomain: false,
    description: 'Comprehensive documentation and tutorial on building high-performance Python APIs with Pydantic and OpenAPI.',
    groundTruthCapabilities: ['Pydantic schema validation', 'Dependency injection container usage', 'Asynchronous HTTP endpoint definition'],
    groundTruthConcepts: ['Type hinting', 'Automatic OpenAPI generation', 'Asyncio event loop'],
    groundTruthUseCases: ['Build typed REST APIs with automatic documentation', 'Validate input request payloads'],
    sampleQuery: 'build a Python REST API with automatic OpenAPI documentation and input validation',
    expectedRetrievalTerms: ['fastapi', 'pydantic', 'openapi', 'tutorial']
  },
  {
    id: 'doc-2-threejs',
    title: 'Creating a scene - Three.js Documentation',
    sourceUrl: 'https://threejs.org/docs/index.html#manual/en/introduction/Creating-a-scene',
    resourceType: 'documentation_site',
    expectedRole: 'documentation',
    domain: 'computer graphics / web visualization',
    isUnknownDomain: false,
    description: 'Official introduction to Three.js WebGL scene graph, camera setup, mesh render loops, and illumination.',
    groundTruthCapabilities: ['WebGL scene graph construction', 'Perspective camera configuration', 'Animation render loop management'],
    groundTruthConcepts: ['Scene Graph', 'Mesh Geometry and Material', 'Rasterization Pipeline'],
    groundTruthUseCases: ['Render 3D interactive graphics in browser', 'Visualize geospatial satellite orbits on 3D globe'],
    sampleQuery: 'render an interactive 3D scene in browser with a camera and lighting',
    expectedRetrievalTerms: ['threejs', 'scene', 'camera', 'webgl']
  },
  {
    id: 'doc-3-scipy-opt',
    title: 'Optimization and root finding - SciPy Documentation',
    sourceUrl: 'https://docs.scipy.org/doc/scipy/reference/optimize.html',
    resourceType: 'documentation_site',
    expectedRole: 'documentation',
    domain: 'scientific computing / mathematics',
    isUnknownDomain: false,
    description: 'API reference for numerical optimization, Nelder-Mead, BFGS, least-squares, and root finding algorithms.',
    groundTruthCapabilities: ['Non-linear least squares optimization', 'Constrained multivariate minimization', 'Scalar root finding'],
    groundTruthConcepts: ['Gradient descent', 'Hessian approximation', 'KKT optimality conditions'],
    groundTruthUseCases: ['Fit mathematical curves to experimental telemetry', 'Solve kinematic joint angles'],
    sampleQuery: 'find the minimum of a multivariate mathematical function with constraints',
    expectedRetrievalTerms: ['optimize', 'scipy', 'minimization', 'least-squares']
  },
  {
    id: 'doc-4-astral-uv',
    title: 'Features - uv Documentation',
    sourceUrl: 'https://docs.astral.sh/uv/',
    resourceType: 'documentation_site',
    expectedRole: 'documentation',
    domain: 'developer tools / build systems',
    isUnknownDomain: false,
    description: 'An extremely fast Python package and project manager written in Rust, replacing pip and virtualenv.',
    groundTruthCapabilities: ['Universal Python lockfile generation', 'Fast virtual environment creation', 'Cross-platform wheel caching'],
    groundTruthConcepts: ['PubGrub dependency resolution', 'Hardlink cache', 'Zero-dependency binary'],
    groundTruthUseCases: ['Speed up CI/CD Python dependency installation', 'Manage unified Python project environments'],
    sampleQuery: 'fast package resolver and environment manager for Python in Rust',
    expectedRetrievalTerms: ['uv', 'astral', 'python', 'resolver']
  },
  {
    id: 'doc-5-sgp4-heyoka',
    title: 'A differentiable SGP4 propagator - heyoka.py Documentation',
    sourceUrl: 'https://heyoka.readthedocs.io/en/latest/notebooks/sgp4_propagator.html',
    resourceType: 'documentation_site',
    expectedRole: 'documentation',
    domain: 'satellite systems / orbital mechanics',
    isUnknownDomain: true,
    description: 'High-order Taylor integration of SGP4 equations of motion with automatic differentiation in C++/Python.',
    groundTruthCapabilities: ['Differentiable SGP4 propagation', 'Taylor method numerical integration', 'State transition matrix computation'],
    groundTruthConcepts: ['Automatic differentiation', 'Taylor polynomial series', 'Orbital perturbation dynamics'],
    groundTruthUseCases: ['Satellite orbit determination via gradient descent', 'Space collision probability estimation'],
    sampleQuery: 'compute derivatives and state transition matrix of SGP4 satellite trajectory',
    expectedRetrievalTerms: ['sgp4', 'differentiable', 'propagator', 'heyoka']
  },

  // ==========================================
  // 4. YOUTUBE VIDEOS (5)
  // ==========================================
  {
    id: 'yt-1-rag',
    title: 'RAG Architecture Principles & Vector Search',
    sourceUrl: 'https://www.youtube.com/watch?v=0k_2hY5VvN0',
    resourceType: 'youtube_video',
    expectedRole: 'video',
    domain: 'AI / information retrieval',
    isUnknownDomain: false,
    description: 'Architectural video lecture on chunking, embedding generation, reciprocal rank fusion, and grounded answer synthesis.',
    groundTruthCapabilities: ['RAG architecture explanation', 'Vector similarity search walkthrough', 'Citation grounding mechanics'],
    groundTruthConcepts: ['Dense retrieval', 'Cosine similarity', 'Chunk boundaries'],
    groundTruthUseCases: ['Design search systems over private document collections'],
    sampleQuery: 'how to build a retrieval augmented generation system with vector database',
    expectedRetrievalTerms: ['rag', 'vector', 'retrieval', 'embedding']
  },
  {
    id: 'yt-2-hough',
    title: 'Hough Transform Line Detection in Computer Vision',
    sourceUrl: 'https://www.youtube.com/watch?v=kCCxevjyEbA',
    resourceType: 'youtube_video',
    expectedRole: 'video',
    domain: 'computer vision / image processing',
    isUnknownDomain: true,
    description: 'Mathematical derivation and walkthrough of parameter space voting for line and circle extraction.',
    groundTruthCapabilities: ['Hough parameter space transformation explanation', 'Edge voting accumulator array walkthrough'],
    groundTruthConcepts: ['Normal parameterization (rho, theta)', 'Accumulator array', 'Dual representation'],
    groundTruthUseCases: ['Lane detection in autonomous driving', 'Document skew detection'],
    sampleQuery: 'how does the Hough transform detect lines in edge images',
    expectedRetrievalTerms: ['hough', 'line', 'vision', 'transform']
  },
  {
    id: 'yt-3-fabrik',
    title: 'Inverse Kinematics with FABRIK Algorithm',
    sourceUrl: 'https://www.youtube.com/watch?v=IHZwWFHWa-w',
    resourceType: 'youtube_video',
    expectedRole: 'video',
    domain: 'robotics / kinematic chains',
    isUnknownDomain: true,
    description: 'Visual geometric walkthrough of Forward And Backward Reaching Inverse Kinematics (FABRIK) for multi-joint robotic arms.',
    groundTruthCapabilities: ['FABRIK inverse kinematics walkthrough', 'Multi-joint robotic arm reach calculation'],
    groundTruthConcepts: ['Forward and backward reaching passes', 'Joint angle constraints', 'Kinematic chain end-effector'],
    groundTruthUseCases: ['Position robotic manipulator end-effector at spatial target', 'Procedural character limb animation'],
    sampleQuery: 'how to calculate joint angles for a robotic arm reaching a target using FABRIK',
    expectedRetrievalTerms: ['fabrik', 'kinematics', 'joint', 'robotic']
  },
  {
    id: 'yt-4-gjk-tutorial',
    title: 'GJK Collision Detection Algorithm in 3D',
    sourceUrl: 'https://www.youtube.com/watch?v=ajv4XCls1KI',
    resourceType: 'youtube_video',
    expectedRole: 'video',
    domain: 'games / physics simulation',
    isUnknownDomain: true,
    description: 'Clear step-by-step 3D visual explanation of simplex building, support points, and origin containment.',
    groundTruthCapabilities: ['GJK 3D algorithm visual explanation', 'Simplex origin containment verification'],
    groundTruthConcepts: ['Minkowski Difference', 'Support function mapping', 'Simplex reduction'],
    groundTruthUseCases: ['Understand physics engine collision code', 'Implement game physics engine'],
    sampleQuery: 'step by step explanation of Gilbert Johnson Keerthi collision detection in 3D',
    expectedRetrievalTerms: ['gjk', 'collision', 'simplex', 'physics']
  },
  {
    id: 'yt-5-orbits',
    title: 'Satellite Orbits and Keplerian Orbital Elements',
    sourceUrl: 'https://www.youtube.com/watch?v=Air7Vb-NcfI',
    resourceType: 'youtube_video',
    expectedRole: 'video',
    domain: 'satellite systems / celestial mechanics',
    isUnknownDomain: true,
    description: 'Educational video explaining the 6 classical Keplerian orbital elements defining satellite orbits around Earth.',
    groundTruthCapabilities: ['Keplerian orbital element explanation', 'Semi-major axis, eccentricity, and inclination breakdown'],
    groundTruthConcepts: ['Kepler laws', 'Right ascension of ascending node (RAAN)', 'Argument of periapsis'],
    groundTruthUseCases: ['Interpret satellite orbit parameters from aerospace data'],
    sampleQuery: 'what are the six orbital elements that define a satellite orbit',
    expectedRetrievalTerms: ['orbit', 'keplerian', 'satellite', 'elements']
  },

  // ==========================================
  // 5. RESEARCH PAPERS & PDFS (5)
  // ==========================================
  {
    id: 'pdf-1-unet',
    title: 'Retinal Blood Vessel Segmentation Using U-Net',
    sourceUrl: 'https://cs229.stanford.edu/proj2017/final-reports/5243715.pdf',
    resourceType: 'pdf',
    expectedRole: 'research',
    domain: 'computer vision / biomedical imaging',
    isUnknownDomain: false,
    description: 'Stanford CS229 research paper implementing convolutional neural networks for semantic vessel segmentation.',
    groundTruthCapabilities: ['U-Net semantic image segmentation', 'Receiver Operating Characteristic (ROC) evaluation', 'Biomedical image preprocessing'],
    groundTruthConcepts: ['Encoder-decoder architecture with skip connections', 'Cross-entropy pixel loss', 'Dice coefficient'],
    groundTruthUseCases: ['Automated medical diagnosis', 'Binary mask segmentation on scientific imaging'],
    sampleQuery: 'segment blood vessels in medical eye scans using U-Net neural network',
    expectedRetrievalTerms: ['unet', 'segmentation', 'retinal', 'vessel']
  },
  {
    id: 'pdf-2-attention',
    title: 'Attention Is All You Need',
    sourceUrl: 'https://arxiv.org/pdf/1706.03762.pdf',
    resourceType: 'research_paper',
    expectedRole: 'research',
    domain: 'AI / deep learning architecture',
    isUnknownDomain: false,
    description: 'Foundational paper introducing the Transformer architecture based entirely on multi-head self-attention mechanisms.',
    groundTruthCapabilities: ['Multi-head self-attention mechanism', 'Scaled dot-product attention formula', 'Positional sinusoidal encoding'],
    groundTruthConcepts: ['Self-attention', 'Feedforward sublayers', 'Residual normalization'],
    groundTruthUseCases: ['Train foundational language models', 'Sequence transduction modeling'],
    sampleQuery: 'how does multi-head self attention work in the transformer architecture',
    expectedRetrievalTerms: ['attention', 'transformer', 'multi-head', 'sequence']
  },
  {
    id: 'pdf-3-sbert',
    title: 'Sentence-BERT: Sentence Embeddings using Siamese BERT-Networks',
    sourceUrl: 'https://arxiv.org/pdf/1908.10084.pdf',
    resourceType: 'research_paper',
    expectedRole: 'research',
    domain: 'AI / semantic retrieval',
    isUnknownDomain: false,
    description: 'Modification of pretrained BERT using siamese and triplet network structures to derive semantically meaningful sentence embeddings.',
    groundTruthCapabilities: ['Siamese network sentence embedding training', 'Semantic textual similarity (STS) scoring', 'Cosine distance vector clustering'],
    groundTruthConcepts: ['Triplet loss', 'Mean pooling over token representations', 'Semantic vector space'],
    groundTruthUseCases: ['Large-scale semantic search indexing', 'Clustering text documents by semantic similarity'],
    sampleQuery: 'derive semantically meaningful sentence embeddings using Siamese BERT networks',
    expectedRetrievalTerms: ['sentence-bert', 'siamese', 'embeddings', 'similarity']
  },
  {
    id: 'pdf-4-sfm-colmap-paper',
    title: 'Structure-from-Motion Revisited',
    sourceUrl: 'https://demuc.de/papers/schoenberger_cvpr2016.pdf',
    resourceType: 'research_paper',
    expectedRole: 'research',
    domain: 'computer vision / photogrammetry',
    isUnknownDomain: true,
    description: 'CVPR research paper detailing the robust incremental Structure-from-Motion algorithm powering COLMAP.',
    groundTruthCapabilities: ['Incremental Structure-from-Motion methodology', 'Geometric scene verification', 'Next best view selection algorithm'],
    groundTruthConcepts: ['Correspondence graph', 'Outlier filtering via RANSAC', 'Bundle adjustment convergence'],
    groundTruthUseCases: ['Implement robust 3D reconstruction algorithms', 'Filter false feature matches in photogrammetry'],
    sampleQuery: 'algorithm for incremental structure from motion and next best view selection',
    expectedRetrievalTerms: ['sfm', 'reconstruction', 'bundle', 'photogrammetry']
  },
  {
    id: 'pdf-5-rag-paper',
    title: 'Retrieval-Augmented Generation for Knowledge-Intensive NLP Tasks',
    sourceUrl: 'https://arxiv.org/pdf/2005.11401.pdf',
    resourceType: 'research_paper',
    expectedRole: 'research',
    domain: 'AI / natural language processing',
    isUnknownDomain: false,
    description: 'Original research paper introducing RAG models combining parametric memory (seq2seq) and non-parametric memory (dense vector index).',
    groundTruthCapabilities: ['RAG-Token and RAG-Sequence probabilistic modeling', 'End-to-end differentiable retriever-generator training'],
    groundTruthConcepts: ['Parametric vs non-parametric memory', 'Marginalization over top-K retrieved documents'],
    groundTruthUseCases: ['Grounding LLMs on factual external knowledge', 'Open-domain question answering'],
    sampleQuery: 'probabilistic formulation of retrieval augmented generation with dense passage retriever',
    expectedRetrievalTerms: ['rag', 'retrieval-augmented', 'parametric', 'dpr']
  },

  // ==========================================
  // 6. PUBLIC SOCIAL / PROFILES (3)
  // ==========================================
  {
    id: 'soc-1-torvalds',
    title: 'Linus Torvalds Public Profile',
    sourceUrl: 'https://github.com/torvalds',
    resourceType: 'generic_url',
    expectedRole: 'reference',
    domain: 'developer tools / operating systems',
    isUnknownDomain: false,
    description: 'Public open-source developer profile of Linus Torvalds hosting Linux kernel and Git repositories.',
    groundTruthCapabilities: ['Open source project leadership', 'Systems software maintenance'],
    groundTruthConcepts: ['Kernel development', 'Decentralized version control'],
    groundTruthUseCases: ['Reference source for Linux kernel and Git repositories'],
    sampleQuery: 'where are Linus Torvalds official public repositories hosted',
    expectedRetrievalTerms: ['torvalds', 'linux', 'git', 'kernel']
  },
  {
    id: 'soc-2-karpathy',
    title: 'Andrej Karpathy Public Profile',
    sourceUrl: 'https://github.com/karpathy',
    resourceType: 'generic_url',
    expectedRole: 'reference',
    domain: 'AI / education',
    isUnknownDomain: false,
    description: 'Public developer and research profile containing educational neural network repositories (micrograd, nanoGPT, minbpe).',
    groundTruthCapabilities: ['Educational neural network implementation', 'Minimalist transformer training scripts'],
    groundTruthConcepts: ['Autograd engine', 'Educational code simplicity', 'BPE tokenization'],
    groundTruthUseCases: ['Learn foundational deep learning implementation from scratch'],
    sampleQuery: 'minimal educational neural network and nanoGPT repositories by Andrej Karpathy',
    expectedRetrievalTerms: ['karpathy', 'nanogpt', 'micrograd', 'neural']
  },
  {
    id: 'soc-3-linkedin-blocked',
    title: 'LinkedIn Public URL Ingestion Check',
    sourceUrl: 'https://www.linkedin.com/posts/satyanadella_ai-activity-1234',
    resourceType: 'linkedin_post',
    expectedRole: 'opinion',
    domain: 'public social / enterprise',
    isUnknownDomain: false,
    description: 'LinkedIn public activity test verifying honest BLOCKED status detection when anti-bot paywall is encountered.',
    groundTruthCapabilities: ['Public post reference'],
    groundTruthConcepts: ['Honest status reporting', 'Anti-bot detection'],
    groundTruthUseCases: ['Verify Open Eye does not pretend blocked content was ingested'],
    sampleQuery: 'what is Satya Nadella view on enterprise AI',
    expectedRetrievalTerms: ['linkedin', 'satya', 'enterprise']
  }
];
