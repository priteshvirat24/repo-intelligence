import os
from pathlib import Path
from dotenv import load_dotenv

# Load root .env
root_env = Path(__file__).resolve().parent.parent.parent / ".env"
load_dotenv(dotenv_path=root_env)
load_dotenv()

class Config:
    # Database
    DATABASE_URL: str = os.getenv(
        "DATABASE_URL",
        "postgresql://priteshhome@localhost:5432/repo_intelligence"
    )

    # AI - LLM
    LLM_PROVIDER: str = os.getenv("LLM_PROVIDER", "mistral").lower()
    LLM_API_KEY: str = os.getenv("LLM_API_KEY", "")
    LLM_MODEL: str = os.getenv("LLM_MODEL", "")  # empty: provider-specific default in get_llm_provider()

    # AI - Embeddings
    EMBEDDING_PROVIDER: str = os.getenv("EMBEDDING_PROVIDER", "mistral").lower()
    EMBEDDING_API_KEY: str = os.getenv("EMBEDDING_API_KEY", "")
    EMBEDDING_MODEL: str = os.getenv("EMBEDDING_MODEL", "mistral-embed")
    EMBEDDING_DIMENSIONS: int = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))

    # GitHub
    GITHUB_TOKEN: str = os.getenv("GITHUB_TOKEN", "")

    # Processing Limits
    MAX_REPOSITORY_SIZE_MB: int = int(os.getenv("MAX_REPOSITORY_SIZE_MB", "100"))
    MAX_FILE_SIZE_KB: int = int(os.getenv("MAX_FILE_SIZE_KB", "500"))
    MAX_TOTAL_TEXT_MB: int = int(os.getenv("MAX_TOTAL_TEXT_MB", "20"))
    MAX_FILES: int = int(os.getenv("MAX_FILES", "2000"))
    # Analysis depth: text excerpts embedded for search, and subsystems studied individually by the LLM
    MAX_CHUNKS: int = int(os.getenv("MAX_CHUNKS", "1500"))
    MAX_SUBSYSTEMS: int = int(os.getenv("MAX_SUBSYSTEMS", "8"))

    # Briefs: shortlisted repositories indexed to verify the blueprint, and how long it waits for them
    BRIEF_VERIFY_COUNT: int = int(os.getenv("BRIEF_VERIFY_COUNT", "3"))
    BLUEPRINT_MAX_WAIT_MINUTES: int = int(os.getenv("BLUEPRINT_MAX_WAIT_MINUTES", "60"))

    # Worker Tuning
    WORKER_POLL_INTERVAL_SECONDS: float = float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "2"))
    JOB_LOCK_TIMEOUT_MINUTES: int = int(os.getenv("JOB_LOCK_TIMEOUT_MINUTES", "10"))
    MAX_JOB_ATTEMPTS: int = int(os.getenv("MAX_JOB_ATTEMPTS", "3"))

    # Sandboxed execution (Phase 6): third-party code runs only inside a sandbox, never on this host.
    # docker (local development) or e2b (managed microVMs, needs E2B_API_KEY); anything else disables execution
    SANDBOX_PROVIDER: str = os.getenv("SANDBOX_PROVIDER", "docker").lower()
    E2B_API_KEY: str = os.getenv("E2B_API_KEY", "")
    SANDBOX_MEMORY: str = os.getenv("SANDBOX_MEMORY", "2g")
    SANDBOX_CPUS: str = os.getenv("SANDBOX_CPUS", "1")
    SANDBOX_PIDS: int = int(os.getenv("SANDBOX_PIDS", "256"))
    SANDBOX_PYTHON_IMAGE: str = os.getenv("SANDBOX_PYTHON_IMAGE", "python:3.12-slim")
    SANDBOX_NODE_IMAGE: str = os.getenv("SANDBOX_NODE_IMAGE", "node:22-slim")
    # E1 checks per brief (when the brief opts in): candidates and verified claims per candidate
    EXECUTE_MAX_CANDIDATES: int = int(os.getenv("EXECUTE_MAX_CANDIDATES", "2"))
    EXECUTE_MAX_CLAIMS: int = int(os.getenv("EXECUTE_MAX_CLAIMS", "2"))
    # Build mode: coding iterations and total sandbox time per build
    BUILD_MAX_ITERATIONS: int = int(os.getenv("BUILD_MAX_ITERATIONS", "4"))
    BUILD_MAX_SANDBOX_SECONDS: int = int(os.getenv("BUILD_MAX_SANDBOX_SECONDS", "1800"))

    # Secret Redaction
    INTERNAL_API_SECRET: str = os.getenv("INTERNAL_API_SECRET", "dev-secret")

config = Config()
