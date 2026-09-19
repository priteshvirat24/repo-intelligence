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
    LLM_MODEL: str = os.getenv("LLM_MODEL", "mistral-small-latest")

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

    # Worker Tuning
    WORKER_POLL_INTERVAL_SECONDS: float = float(os.getenv("WORKER_POLL_INTERVAL_SECONDS", "2"))
    JOB_LOCK_TIMEOUT_MINUTES: int = int(os.getenv("JOB_LOCK_TIMEOUT_MINUTES", "10"))
    MAX_JOB_ATTEMPTS: int = int(os.getenv("MAX_JOB_ATTEMPTS", "3"))

    # Secret Redaction
    INTERNAL_API_SECRET: str = os.getenv("INTERNAL_API_SECRET", "dev-secret")

config = Config()
