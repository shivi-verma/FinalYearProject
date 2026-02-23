import os
from pathlib import Path
from dotenv import load_dotenv

# Get the project root directory (parent of backend folder)
BASE_DIR = Path(__file__).resolve().parent.parent.parent
ENV_FILE = BASE_DIR / ".env"

# Load .env from project root
load_dotenv(dotenv_path=ENV_FILE)

# Database
DATABASE_URL = os.getenv("DATABASE_URL", "sqlite:///./code_assistant.db")

# Security
SECRET_KEY = os.getenv("SECRET_KEY", "your-secret-key")
ALGORITHM = os.getenv("ALGORITHM", "HS256")
ACCESS_TOKEN_EXPIRE_MINUTES = int(os.getenv("ACCESS_TOKEN_EXPIRE_MINUTES", "30"))

# Ollama
OLLAMA_BASE_URL = os.getenv("OLLAMA_BASE_URL", "http://localhost:11434")
OLLAMA_MODEL = os.getenv("OLLAMA_MODEL", "codellama:7b")

# Vector DB
CHROMA_PERSIST_DIR = os.getenv("CHROMA_PERSIST_DIR", "./vectordb")

# Uploads
UPLOAD_DIR = os.getenv("UPLOAD_DIR", "./uploads")
MAX_UPLOAD_SIZE_MB = int(os.getenv("MAX_UPLOAD_SIZE_MB", "10"))

# Create a settings object for compatibility with imports like "from core.config import settings"
class Settings:
    DATABASE_URL = DATABASE_URL
    SECRET_KEY = SECRET_KEY
    ALGORITHM = ALGORITHM
    ACCESS_TOKEN_EXPIRE_MINUTES = ACCESS_TOKEN_EXPIRE_MINUTES
    OLLAMA_BASE_URL = OLLAMA_BASE_URL
    OLLAMA_MODEL = OLLAMA_MODEL
    CHROMA_PERSIST_DIR = CHROMA_PERSIST_DIR
    UPLOAD_DIR = UPLOAD_DIR
    MAX_UPLOAD_SIZE_MB = MAX_UPLOAD_SIZE_MB

settings = Settings()

SHARED_UPLOAD_DIR = os.path.join(os.getcwd(), "shareduploads")
