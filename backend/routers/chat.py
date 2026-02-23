"""Chat/Query endpoints"""
from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel
from typing import List, Optional, Literal  # ← ADDED Literal
from uuid import UUID
import time
from backend.db.database import get_db
from backend.core.models import ChatSession, Message
from backend.services.ollama_service import ollama_service
from backend.services.rag_manager import rag_manager  # ← CHANGED from rag_service
# from backend.services.rag_service import rag_service  # ← REMOVE/COMMENT OUT
from backend.routers.auth import get_current_user

router = APIRouter()

# Schemas
class ChatRequest(BaseModel):
    query: str
    session_id: Optional[UUID] = None
    use_rag: bool = True
    stream: bool = False
    db_scope: Literal["local", "shared"] = "local"  # ← NEW: database selection

class ChatResponse(BaseModel):
    answer: str
    sources: List[dict] = []
    session_id: UUID
    response_time_ms: int
    db_scope: str = "local"  # ← NEW: which DB was used

class SessionResponse(BaseModel):
    id: UUID
    title: str
    message_count: int
    created_at: str
    
class UpdateSessionRequest(BaseModel):
    title: str
    

@router.post("/query", response_model=ChatResponse)
async def chat_query(
    request: ChatRequest, 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Main chat endpoint with RAG - supports local and shared databases"""
    start_time = time.time()
    
    # Get or create session
    if request.session_id:
        session = db.query(ChatSession).filter(ChatSession.id == request.session_id).first()
        if not session:
            raise HTTPException(status_code=404, detail="Session not found")
    else:
        session = ChatSession(
            title=request.query[:50],
            user_id=current_user.id
        )
        db.add(session)
        db.commit()
        db.refresh(session)
    
    # Save user message
    user_message = Message(
        session_id=session.id,
        role="user",
        content=request.query
    )
    db.add(user_message)
    db.commit()
    
    # ── RAG retrieval with database selection ─────────────────────────────────
    sources = []
    context_docs = []
    
    if request.use_rag:
        # Check if the requested scope is available
        if request.db_scope == "local" and rag_manager.local.is_initialized:
            search_results = await rag_manager.search(
                query=request.query,
                k=5,
                scope="local"  # ← Search local ChromaDB
            )
        elif request.db_scope == "shared":
            # This will try to reach the shared server
            search_results = await rag_manager.search(
                query=request.query,
                k=5,
                scope="shared"  # ← Search shared ChromaDB via HTTP
            )
        else:
            search_results = []
        
        if search_results:
            context_docs = [result["content"] for result in search_results]
            sources = [
                {
                    "content": result["content"][:200] + "...",
                    "source": result.get("source", "unknown"),
                    "document_id": result.get("metadata", {}).get("document_id", "unknown")
                }
                for result in search_results
            ]
    
    # Get chat history
    chat_history = db.query(Message).filter(
        Message.session_id == session.id
    ).order_by(Message.created_at.desc()).limit(10).all()
    
    history = [
        {"role": msg.role, "content": msg.content}
        for msg in reversed(chat_history[1:])
    ]
    
    # ── Generate response with context ────────────────────────────────────────
    success = True
    error_msg = None
    
    try:
        if context_docs:
            # Enhanced prompt indicating which database was used
            db_label = "shared team" if request.db_scope == "shared" else "personal"
            
            answer = await ollama_service.generate_with_context(
                question=request.query,
                context=context_docs,
                chat_history=history
            )
        else:
            # No RAG results - just use Ollama directly
            if request.db_scope == "shared":
                system_prompt = "You are a helpful coding assistant. Note: No relevant documents were found in the shared team database."
            else:
                system_prompt = "You are a helpful coding assistant. Note: No relevant documents were found in your personal database."
            
            answer = await ollama_service.generate(
                prompt=request.query,
                system_prompt=system_prompt,
                temperature=0.7
            )
    except Exception as e:
        success = False
        error_msg = str(e)
        answer = f"Sorry, an error occurred: {str(e)}"
    
    response_time = int((time.time() - start_time) * 1000)
    
    # Save assistant message
    assistant_message = Message(
        session_id=session.id,
        role="assistant",
        content=answer,
        sources=sources,
        response_time_ms=response_time
    )
    db.add(assistant_message)
    db.commit()
    db.refresh(assistant_message)
    
    # Save Query Metrics
    from backend.core.models import QueryMetrics
    metrics = QueryMetrics(
        message_id=assistant_message.id,
        query=request.query,
        response_time_ms=response_time,
        num_sources=len(sources),
        model_used=ollama_service.model,
        success=success
    )
    db.add(metrics)
    db.commit()
    
    return ChatResponse(
        answer=answer,
        sources=sources,
        session_id=session.id,
        response_time_ms=response_time,
        db_scope=request.db_scope  # ← Return which DB was used
    )


@router.get("/sessions", response_model=List[SessionResponse])
def get_sessions(
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)  
):
    """Get all chat sessions for current user"""
    sessions = db.query(ChatSession).filter(
        ChatSession.user_id == current_user.id
    ).order_by(ChatSession.created_at.desc()).limit(20).all()
        
    result = []
    for session in sessions:
        message_count = db.query(Message).filter(Message.session_id == session.id).count()
        result.append({
            "id": session.id,
            "title": session.title,
            "message_count": message_count,
            "created_at": session.created_at.isoformat()
        })
    
    return result


@router.get("/sessions/{session_id}/messages")
def get_session_messages(
    session_id: UUID,
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Get messages for a session"""
    # Verify session belongs to user
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    messages = db.query(Message).filter(
        Message.session_id == session_id
    ).order_by(Message.created_at).all()
    
    return [
        {
            "id": msg.id,
            "role": msg.role,
            "content": msg.content,
            "sources": msg.sources,
            "response_time_ms": msg.response_time_ms,
            "created_at": msg.created_at.isoformat()
        }
        for msg in messages
    ]


@router.put("/sessions/{session_id}")
def update_session(
    session_id: UUID, 
    request: UpdateSessionRequest, 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)
):
    """Update a chat session (rename)"""
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    session.title = request.title
    db.commit()
    
    return {"message": "Session updated", "title": request.title}


@router.delete("/sessions/{session_id}")
def delete_session(
    session_id: UUID, 
    db: Session = Depends(get_db),
    current_user = Depends(get_current_user)  
):
    """Delete a chat session"""
    session = db.query(ChatSession).filter(
        ChatSession.id == session_id,
        ChatSession.user_id == current_user.id
    ).first()
    
    if not session:
        raise HTTPException(status_code=404, detail="Session not found")
    
    db.delete(session)
    db.commit()
    
    return {"message": "Session deleted"}


@router.post("/code/generate")
async def generate_code(
    description: str,
    language: str = "python"
):
    """Generate code snippet"""
    code = await ollama_service.generate_code(description, language)
    return {"code": code, "language": language}