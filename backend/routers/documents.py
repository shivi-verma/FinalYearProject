"""Document management endpoints"""
from fastapi import APIRouter, Depends, HTTPException, UploadFile, File, BackgroundTasks, Query
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Literal  # ← ADD Literal import
from uuid import UUID
import os
import shutil
from backend.db.database import get_db
from backend.core.models import Document
# ── CHANGE THIS LINE ──────────────────────────────────────────────────────
from backend.services.rag_manager import rag_manager  # ← CHANGED from rag_service
# from backend.services.rag_service import rag_service  # ← REMOVE/COMMENT OUT
# ──────────────────────────────────────────────────────────────────────────
from backend.services.ocr_service import ocr_service
from backend.core.config import UPLOAD_DIR, SHARED_UPLOAD_DIR, MAX_UPLOAD_SIZE_MB
from backend.routers.auth import get_current_user

router = APIRouter()

# Schemas
class DocumentResponse(BaseModel):
    id: UUID
    title: str
    filename: str
    chunk_count: int
    status: str
    uploaded_at: str
    scope: str = "local"  # ← ADD this field
    
    class Config:
        from_attributes = True

# ── UPDATED: Background task with scope ──────────────────────────────────────
async def process_document_task(document_id: UUID, file_path: str, db: Session, scope: str = "local"):
    """Background task to process uploaded document"""
    try:
        file_ext = os.path.splitext(file_path)[1].lower()
        
        # Check if it's an image file
        image_extensions = ['.png', '.jpg', '.jpeg', '.bmp', '.tiff']
        
        if file_ext in image_extensions:
            # Extract text from image using OCR
            print(f"🖼️ Processing image with OCR: {file_path}")
            extracted_text = ocr_service.extract_text_from_image(file_path)
            
            # Save extracted text to a temporary txt file
            txt_file_path = file_path + ".txt"
            with open(txt_file_path, 'w', encoding='utf-8') as f:
                f.write(extracted_text)
            
            # ── ADD scope parameter ──
            chunk_count = await rag_manager.add_document(
                file_path=txt_file_path,
                document_id=str(document_id),
                metadata={
                    "filename": os.path.basename(file_path),
                    "type": "image_ocr",
                    "original_image": file_path
                },
                scope=scope  # ← ADD THIS
            )
            
            print(f"✅ Extracted {len(extracted_text)} characters from image")
        else:
            # Regular document processing (PDF, TXT, etc.)
            # ── ADD scope parameter ──
            chunk_count = await rag_manager.add_document(
                file_path=file_path,
                document_id=str(document_id),
                metadata={"filename": os.path.basename(file_path)},
                scope=scope  # ← ADD THIS
            )
        
        # Update document status and scope in database
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            doc.chunk_count = chunk_count
            doc.status = "completed"
            # Note: You may need to add a 'scope' column to your Document model
            # For now, we'll track it via metadata
            db.commit()
        
        print(f"✅ Processed document {document_id} in {scope} scope")
        
    except Exception as e:
        print(f"❌ Error processing document {document_id}: {e}")
        doc = db.query(Document).filter(Document.id == document_id).first()
        if doc:
            doc.status = "failed"
            db.commit()

# ── UPDATED: Upload endpoint with scope ──────────────────────────────────────
@router.post("/upload", response_model=DocumentResponse)
async def upload_document(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    scope: Literal["local", "shared"] = Query("local"),  # ← ADD THIS PARAMETER
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Upload and process document"""
    
    # Validate file type
    allowed_extensions = ['.pdf', '.txt', '.md', '.docx', '.png', '.jpg', '.jpeg', '.bmp', '.tiff']
    file_ext = os.path.splitext(file.filename)[1].lower()
    
    if file_ext not in allowed_extensions:
        raise HTTPException(
            status_code=400,
            detail=f"File type not supported. Allowed: {', '.join(allowed_extensions)}"
        )
    
    # Create upload directory based on scope
    if scope == "local":
        os.makedirs(UPLOAD_DIR, exist_ok=True)
        file_path = os.path.join(UPLOAD_DIR, file.filename)
    else:
        os.makedirs(SHARED_UPLOAD_DIR, exist_ok=True)
        file_path = os.path.join(SHARED_UPLOAD_DIR, file.filename)
    
    with open(file_path, "wb") as buffer:
        shutil.copyfileobj(file.file, buffer)
    
    file_size = os.path.getsize(file_path)
    
    # Check size
    if file_size > MAX_UPLOAD_SIZE_MB * 1024 * 1024:
        os.remove(file_path)
        raise HTTPException(
            status_code=400,
            detail=f"File too large. Max size: {MAX_UPLOAD_SIZE_MB}MB"
        )
    
    # Create document record (only for local scope - shared docs don't go in DB)
    if scope == "local":
        document = Document(
            title=file.filename,
            filename=file.filename,
            file_path=file_path,
            status="processing",
            owner_id=current_user.id
        )
        
        db.add(document)
        db.commit()
        db.refresh(document)
        
        # Process in background
        background_tasks.add_task(process_document_task, document.id, file_path, db, scope)
        
        return DocumentResponse(
            id=document.id,
            title=document.title,
            filename=document.filename,
            chunk_count=document.chunk_count,
            status=document.status,
            uploaded_at=document.uploaded_at.isoformat(),
            scope=scope
        )
    else:
        # For shared scope, directly upload to shared server (no DB record)
        try:
            from uuid import uuid4
            temp_doc_id = uuid4()
            
            # Upload to shared server
            chunk_count = await rag_manager.add_document(
                file_path=file_path,
                document_id=str(temp_doc_id),
                metadata={
                    "filename": file.filename,
                    "uploaded_by": current_user.username
                },
                scope="shared"
            )
            
            return DocumentResponse(
                id=temp_doc_id,
                title=file.filename,
                filename=file.filename,
                chunk_count=chunk_count,
                status="completed",
                uploaded_at="",
                scope="shared"
            )
        except RuntimeError as e:
            os.remove(file_path)
            raise HTTPException(502, f"Shared server error: {e}")

# ── UPDATED: List documents with scope ───────────────────────────────────────
@router.get("/", response_model=List[DocumentResponse])
async def list_documents(
    scope: Literal["local", "shared"] = Query("local"),  # ← ADD THIS PARAMETER
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)  
):
    """Get all documents for current user"""
    
    if scope == "local":
        # Get from database (local documents)
        documents = db.query(Document).filter(
            Document.owner_id == current_user.id  
        ).order_by(Document.uploaded_at.desc()).all()
        
        return [
            DocumentResponse(
                id=doc.id,
                title=doc.title,
                filename=doc.filename,
                chunk_count=doc.chunk_count,
                status=doc.status,
                uploaded_at=doc.uploaded_at.isoformat(),
                scope="local"
            )
            for doc in documents
        ]
    else:
        # Get from shared server
        shared_docs = await rag_manager.list_documents(scope="shared")
        return [
            DocumentResponse(
                id=UUID(doc.get("document_id", "00000000-0000-0000-0000-000000000000")),
                title=doc.get("original_filename", "Unknown"),
                filename=doc.get("original_filename", "Unknown"),
                chunk_count=doc.get("total_chunks", 0),
                status="completed",
                uploaded_at="",
                scope="shared"
            )
            for doc in shared_docs
        ]

@router.get("/{document_id}", response_model=DocumentResponse)
def get_document(
    document_id: UUID,
    scope: Literal["local", "shared"] = Query("local"),  # ← ADD THIS
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)  
):
    """Get document by ID"""
    
    if scope == "local":
        doc = db.query(Document).filter(
            Document.id == document_id,
            Document.owner_id == current_user.id
        ).first()
        
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        return DocumentResponse(
            id=doc.id,
            title=doc.title,
            filename=doc.filename,
            chunk_count=doc.chunk_count,
            status=doc.status,
            uploaded_at=doc.uploaded_at.isoformat(),
            scope="local"
        )
    else:
        raise HTTPException(501, "Fetching individual shared documents not yet implemented")

# ── UPDATED: Delete with scope ───────────────────────────────────────────────
@router.delete("/{document_id}")
async def delete_document(
    document_id: UUID,
    scope: Literal["local", "shared"] = Query("local"),  # ← ADD THIS
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)  
):
    """Delete document"""
    
    if scope == "local":
        doc = db.query(Document).filter(
            Document.id == document_id,
            Document.owner_id == current_user.id
        ).first()
        
        if not doc:
            raise HTTPException(status_code=404, detail="Document not found")
        
        # Delete from vector store
        await rag_manager.delete_document(str(document_id), scope="local")
        
        # Delete file
        if os.path.exists(doc.file_path):
            os.remove(doc.file_path)
        
        # Delete from database
        db.delete(doc)
        db.commit()
        
        return {"message": "Document deleted successfully", "scope": "local"}
    else:
        # Delete from shared server
        deleted = await rag_manager.delete_document(str(document_id), scope="shared")
        if not deleted:
            raise HTTPException(404, "Document not found in shared database")
        return {"message": "Document deleted from shared database", "scope": "shared"}

@router.get("/{document_id}/status")
def get_document_status(
    document_id: UUID,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get document processing status"""
    doc = db.query(Document).filter(
        Document.id == document_id,
        Document.owner_id == current_user.id
    ).first()
    
    if not doc:
        raise HTTPException(status_code=404, detail="Document not found")
    
    return {
        "id": doc.id,
        "status": doc.status,
        "chunk_count": doc.chunk_count
    }

# ── NEW: Health check endpoint ───────────────────────────────────────────────
@router.get("/health")
async def health():
    """Check health of both local and shared RAG services"""
    return {
        "local": rag_manager.get_local_statistics(),
        "shared": await rag_manager.get_shared_statistics()
    }