import os
import sys
import hashlib
from pathlib import Path
from apps.worker.db.repository import DatabaseRepository
from apps.worker.analyzer.ast_parser import TreeSitterAnalyzer
from apps.worker.analyzer.evidence import EvidenceVerificationGate
from apps.worker.providers.embeddings import MockEmbeddingProvider

def seed_fixtures():
    db = DatabaseRepository()
    embedder = MockEmbeddingProvider()

    fixtures = [
        {
            "owner": "aerospace-labs",
            "name": "satellite-sgp4-core",
            "url": "https://github.com/aerospace-labs/satellite-sgp4-core",
            "description": "High-precision satellite orbit propagation implementing the SGP4 mathematical model.",
            "stars": 1240,
            "primary_language": "Python",
            "domain_tags": ["satellite-systems", "astrodynamics", "simulation"],
            "fixture_dir": Path("tests/fixtures/satellite_orbital_repo"),
            "open_knowledge": {
                "domains": ["satellite-systems", "astrodynamics"],
                "purpose": "High-precision satellite orbit propagation from Two-Line Element sets using SGP4.",
                "problemSpace": "Calculating real-time ephemeris and orbital state vectors for satellites in Low Earth Orbit.",
                "architecture": {
                    "patternType": "analytical-physics-engine",
                    "description": "State vector propagator using Keplerian element perturbation theory."
                }
            },
            "knowledge_objects": [
                {
                    "object_type": "capability",
                    "name": "SGP4 orbital propagation",
                    "description": "Propagates satellite state vectors using the SGP4 mathematical model.",
                    "category": "astrodynamics",
                    "importance": "critical",
                    "confidence": 0.98,
                    "evidence": [
                        {
                            "file_path": "orbit/sgp4.py",
                            "start_line": 1,
                            "end_line": 20,
                            "symbol_name": "SGP4Propagator",
                            "quote_snippet": "class SGP4Propagator:\n    \"\"\"Propagates satellite state vectors using the SGP4 mathematical model.\"\"\"",
                            "evidence_type": "code_ast",
                            "verified": True
                        }
                    ]
                },
                {
                    "object_type": "capability",
                    "name": "Satellite ephemeris trajectory simulation",
                    "description": "Simulates continuous orbital trajectories over given mission time spans.",
                    "category": "astrodynamics",
                    "importance": "high",
                    "confidence": 0.95,
                    "evidence": [
                        {
                            "file_path": "orbit/sgp4.py",
                            "start_line": 9,
                            "end_line": 22,
                            "symbol_name": "propagate_orbit",
                            "quote_snippet": "def propagate_orbit(self, timestamp: float) -> dict:",
                            "evidence_type": "code_ast",
                            "verified": True
                        }
                    ]
                },
                {
                    "object_type": "concept",
                    "name": "Keplerian orbital elements",
                    "description": "Eccentricity, inclination, right ascension of ascending node, and mean anomaly.",
                    "category": "orbital-mechanics",
                    "importance": "high",
                    "confidence": 0.94
                },
                {
                    "object_type": "output",
                    "name": "ECI state vector coordinates",
                    "description": "Earth-Centered Inertial (ECI) position (km) and velocity (km/s) vectors.",
                    "category": "data-output",
                    "importance": "high",
                    "confidence": 0.96
                }
            ],
            "dependencies": [
                {"package_name": "numpy", "ecosystem": "pypi", "version_spec": ">=1.24.0", "is_runtime": True, "is_heavyweight": False},
                {"package_name": "scipy", "ecosystem": "pypi", "version_spec": ">=1.10.0", "is_runtime": True, "is_heavyweight": False}
            ],
            "limitations": [
                {"category": "accuracy", "description": "SGP4 analytical accuracy degrades for orbits with extreme atmospheric drag below 180 km.", "file_path": "README.md"}
            ]
        },
        {
            "owner": "gis-tools",
            "name": "geospatial-transforms",
            "url": "https://github.com/gis-tools/geospatial-transforms",
            "description": "Coordinate transformation library converting satellite ECI vectors to WGS84 Geodetic coordinates.",
            "stars": 860,
            "primary_language": "Python",
            "domain_tags": ["geospatial", "coordinate-systems", "gis"],
            "fixture_dir": Path("tests/fixtures/geospatial_coords_repo"),
            "open_knowledge": {
                "domains": ["geospatial", "coordinate-systems"],
                "purpose": "Transforms satellite ECI vectors to WGS84 geodetic latitude, longitude, and altitude.",
                "problemSpace": "Bridging inertial orbital reference frames with Earth-fixed geospatial maps.",
                "architecture": {
                    "patternType": "transformation-pipeline",
                    "description": "High-throughput vector rotation and geoid projection matrix calculations."
                }
            },
            "knowledge_objects": [
                {
                    "object_type": "capability",
                    "name": "Geospatial coordinate transformation",
                    "description": "Transforms coordinates between inertial, terrestrial, and geodetic reference frames.",
                    "category": "geospatial",
                    "importance": "critical",
                    "confidence": 0.96,
                    "evidence": [
                        {
                            "file_path": "transform/geodetic.py",
                            "start_line": 1,
                            "end_line": 15,
                            "symbol_name": "GeodeticTransformer",
                            "quote_snippet": "class GeodeticTransformer:\n    \"\"\"Transforms Earth-Centered Inertial (ECI) coordinate vectors into WGS84 Geodetic coordinates.\"\"\"",
                            "evidence_type": "code_ast",
                            "verified": True
                        }
                    ]
                },
                {
                    "object_type": "input",
                    "name": "ECI state vector coordinates",
                    "description": "Earth-Centered Inertial (ECI) coordinate vectors {x_km, y_km, z_km}.",
                    "category": "data-input",
                    "importance": "high",
                    "confidence": 0.95
                },
                {
                    "object_type": "output",
                    "name": "WGS84 geospatial coordinate set",
                    "description": "WGS84 geodetic coordinates {latitude_deg, longitude_deg, altitude_km}.",
                    "category": "data-output",
                    "importance": "high",
                    "confidence": 0.96
                }
            ],
            "dependencies": [],
            "limitations": []
        },
        {
            "owner": "viz-team",
            "name": "webgl-globe-renderer",
            "url": "https://github.com/viz-team/webgl-globe-renderer",
            "description": "Interactive hardware-accelerated 3D globe visualization in WebGL using Three.js.",
            "stars": 2520,
            "primary_language": "TypeScript",
            "domain_tags": ["spatial-visualization", "computer-graphics", "webgl"],
            "fixture_dir": Path("tests/fixtures/webgl_globe_repo"),
            "open_knowledge": {
                "domains": ["spatial-visualization", "computer-graphics"],
                "purpose": "Renders interactive hardware-accelerated 3D globe visualizations and real-time spatial trajectories.",
                "problemSpace": "Rendering satellite orbits and ground tracks smoothly in modern web browsers.",
                "architecture": {
                    "patternType": "client-side-rendering-engine",
                    "description": "Three.js WebGL scene graph with customized shader pipelines for spherical geometry."
                }
            },
            "knowledge_objects": [
                {
                    "object_type": "capability",
                    "name": "Interactive WebGL globe rendering",
                    "description": "Renders real-time geospatial coordinate sets onto an interactive 3D WebGL globe.",
                    "category": "visualization",
                    "importance": "critical",
                    "confidence": 0.97,
                    "evidence": [
                        {
                            "file_path": "src/globe.ts",
                            "start_line": 7,
                            "end_line": 20,
                            "symbol_name": "GlobeRenderer",
                            "quote_snippet": "export class GlobeRenderer {\n  private canvas: HTMLCanvasElement;",
                            "evidence_type": "code_ast",
                            "verified": True
                        }
                    ]
                },
                {
                    "object_type": "capability",
                    "name": "3D spatial trajectory visualization",
                    "description": "Projects and renders real-time 3D flight paths and orbital tracks.",
                    "category": "visualization",
                    "importance": "high",
                    "confidence": 0.94,
                    "evidence": [
                        {
                            "file_path": "src/globe.ts",
                            "start_line": 13,
                            "end_line": 22,
                            "symbol_name": "renderSpatialTrajectory",
                            "quote_snippet": "public renderSpatialTrajectory(coords: GeodeticCoordinate[]): void {",
                            "evidence_type": "code_ast",
                            "verified": True
                        }
                    ]
                },
                {
                    "object_type": "input",
                    "name": "WGS84 geospatial coordinate set",
                    "description": "Array of geodetic coordinates {latitude_deg, longitude_deg, altitude_km}.",
                    "category": "data-input",
                    "importance": "high",
                    "confidence": 0.95
                }
            ],
            "dependencies": [
                {"package_name": "three", "ecosystem": "npm", "version_spec": "^0.158.0", "is_runtime": True, "is_heavyweight": False}
            ],
            "limitations": [
                {"category": "hardware", "description": "Requires WebGL2 support on target browser device.", "file_path": "README.md"}
            ]
        }
    ]

    conn = db.get_connection()
    try:
        with conn.cursor() as cur:
            for item in fixtures:
                # 1. Insert or update repository
                cur.execute(
                    """
                    INSERT INTO repositories (owner, name, url, description, stars, primary_language, status, domain_tags)
                    VALUES (%s, %s, %s, %s, %s, %s, 'PENDING', %s)
                    ON CONFLICT (owner, name) DO UPDATE
                    SET description = EXCLUDED.description,
                        stars = EXCLUDED.stars,
                        primary_language = EXCLUDED.primary_language,
                        domain_tags = EXCLUDED.domain_tags
                    RETURNING id;
                    """,
                    (item["owner"], item["name"], item["url"], item["description"], item["stars"], item["primary_language"], item["domain_tags"])
                )
                repo_id = cur.fetchone()[0]

                # Create dummy job
                cur.execute(
                    """
                    INSERT INTO ingestion_jobs (repository_id, status, step, attempts)
                    VALUES (%s, 'RUNNING', 'INDEXING', 1)
                    RETURNING id;
                    """,
                    (repo_id,)
                )
                job_id = cur.fetchone()[0]
                conn.commit()

                # Read documents from fixture_dir
                documents = []
                chunks = []
                doc_idx = 0
                for fpath in item["fixture_dir"].rglob("*"):
                    if fpath.is_file() and not fpath.name.startswith("."):
                        rel_p = str(fpath.relative_to(item["fixture_dir"]))
                        content = fpath.read_text(errors="ignore")
                        doc_type = "code" if fpath.suffix in (".py", ".ts", ".js") else "doc"
                        documents.append({
                            "file_path": rel_p,
                            "doc_type": doc_type,
                            "language": fpath.suffix.replace(".", ""),
                            "token_count": len(content) // 4,
                            "content_hash": hashlib.sha256(content.encode()).hexdigest()
                        })
                        chunks.append({
                            "file_path": rel_p,
                            "chunk_index": 0,
                            "content": content,
                            "chunk_hash": hashlib.sha256(content.encode()).hexdigest(),
                            "metadata": {"file_path": rel_p}
                        })

                # Compute embeddings
                chunk_texts = [c["content"] for c in chunks]
                chunk_embs = embedder.embed_texts(chunk_texts)

                ko_texts = [f"{ko['name']}: {ko['description']}" for ko in item["knowledge_objects"]]
                ko_embs = embedder.embed_texts(ko_texts)
                for idx, ko in enumerate(item["knowledge_objects"]):
                    ko["embedding"] = ko_embs[idx]

                # Persist atomic
                capabilities_relational = [
                    {
                        "slug": ko["name"].lower().replace(" ", "-"),
                        "name": ko["name"],
                        "category": ko.get("category", "Domain"),
                        "confidence": ko.get("confidence", 0.95),
                        "notes": ko["description"],
                        "evidence": ko.get("evidence", [])
                    }
                    for ko in item["knowledge_objects"] if ko["object_type"] == "capability"
                ]

                db.persist_ingestion_atomic(
                    job_id=job_id,
                    repo_id=repo_id,
                    commit_hash="c0ffee1234567890abcdef",
                    documents=documents,
                    chunks=chunks,
                    embeddings=chunk_embs,
                    capabilities=capabilities_relational,
                    dependencies=item["dependencies"],
                    limitations=item["limitations"],
                    stage_metrics={"seeded": True},
                    domain_tags=item["domain_tags"],
                    open_knowledge_json=item["open_knowledge"],
                    knowledge_objects=item["knowledge_objects"],
                    knowledge_relationships=[]
                )

                print(f"Successfully seeded fixture: {item['owner']}/{item['name']} ({len(item['knowledge_objects'])} KOs, {len(chunks)} chunks)")

    finally:
        conn.close()

if __name__ == "__main__":
    seed_fixtures()
