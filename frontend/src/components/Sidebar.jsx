import { useState, useEffect } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Home, MessageSquare, FileText, BarChart3, LogOut, Edit2, Trash2, Globe } from 'lucide-react'

function Sidebar({ user, onLogout, currentSessionId, onSessionSelect }) {
  const [chatSessions, setChatSessions] = useState([])
  const [editingSessionId, setEditingSessionId] = useState(null)
  const [editTitle, setEditTitle] = useState('')
  const location = useLocation()

  // Load chat sessions
  useEffect(() => {
    loadChatSessions()
  }, [])

  const loadChatSessions = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/chat/sessions', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      
      if (response.ok) {
        const sessions = await response.json()
        setChatSessions(sessions)
      }
    } catch (error) {
      console.error('Failed to load chat sessions:', error)
    }
  }

  // Reload sessions when currentSessionId changes
  useEffect(() => {
    loadChatSessions()
  }, [currentSessionId])

  const handleRename = async (sessionId) => {
    if (!editTitle.trim()) return

    try {
      const response = await fetch(
        `http://localhost:8000/api/chat/sessions/${sessionId}`,
        {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          },
          body: JSON.stringify({ title: editTitle })
        }
      )

      if (response.ok) {
        loadChatSessions()
        setEditingSessionId(null)
        setEditTitle('')
      }
    } catch (error) {
      console.error('Failed to rename session:', error)
    }
  }

  const handleDelete = async (sessionId) => {
    if (!confirm('Delete this chat?')) return

    try {
      const response = await fetch(
        `http://localhost:8000/api/chat/sessions/${sessionId}`,
        {
          method: 'DELETE',
          headers: {
            'Authorization': `Bearer ${localStorage.getItem('token')}`
          }
        }
      )

      if (response.ok) {
        loadChatSessions()
        // If deleted current session, clear it
        if (sessionId === currentSessionId) {
          onSessionSelect(null)
        }
      }
    } catch (error) {
      console.error('Failed to delete session:', error)
    }
  }

  const startEditing = (session) => {
    setEditingSessionId(session.id)
    setEditTitle(session.title)
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-header">
        <h1>Code Assistant</h1>
        {user && <p className="user-name">{user.username}</p>}
      </div>

      <nav className="sidebar-nav">

        {/* Home Button */}
        <Link
          to="/"
          className={`nav-item ${location.pathname === '/' ? 'active' : ''}`}
        >
          <Home size={20} />
          <span>Home</span>
        </Link>

        <Link
          to="/chat"
          className={`nav-item ${location.pathname === '/chat' ? 'active' : ''}`}
        >
          <MessageSquare size={20} />
          <span>Chat</span>
        </Link>

        {/* Chat Sessions List - Only show on Chat page */}
        {location.pathname === '/chat' && chatSessions.length > 0 && (
          <div className="chat-sessions-list">
            {chatSessions.map((session) => (
              <div
                key={session.id}
                className={`chat-session-item ${
                  currentSessionId === session.id ? 'active' : ''
                }`}
              >
                {editingSessionId === session.id ? (
                  <div className="edit-session">
                    <input
                      type="text"
                      value={editTitle}
                      onChange={(e) => setEditTitle(e.target.value)}
                      onKeyPress={(e) => {
                        if (e.key === 'Enter') handleRename(session.id)
                      }}
                      autoFocus
                    />
                    <button onClick={() => handleRename(session.id)}>✓</button>
                    <button onClick={() => setEditingSessionId(null)}>✕</button>
                  </div>
                ) : (
                  <>
                    <span
                      className="session-title"
                      onClick={() => onSessionSelect(session.id)}
                    >
                      {session.title || 'Untitled Chat'}
                    </span>
                    <div className="session-actions">
                      <button
                        onClick={() => startEditing(session)}
                        className="action-btn"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => handleDelete(session.id)}
                        className="action-btn delete"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </>
                )}
              </div>
            ))}
          </div>
        )}

        {/* ── DOCUMENTS SECTION ── */}
        {/* My Documents (Local/Private) */}
        <Link
          to="/documents"
          className={`nav-item ${location.pathname === '/documents' ? 'active' : ''}`}
        >
          <FileText size={20} />
          <span>My Documents</span>
        </Link>

        {/* Shared Documents (NEW) */}
        <Link
          to="/shared-documents"
          className={`nav-item ${location.pathname === '/shared-documents' ? 'active' : ''}`}
        >
          <Globe size={20} />
          <span>Shared Documents</span>
        </Link>

        <Link
          to="/admin"
          className={`nav-item ${location.pathname === '/admin' ? 'active' : ''}`}
        >
          <BarChart3 size={20} />
          <span>Admin</span>
        </Link>
      </nav>

      <button className="logout-btn" onClick={onLogout}>
        <LogOut size={20} />
        <span>Logout</span>
      </button>
    </aside>
  )
}

export default Sidebar