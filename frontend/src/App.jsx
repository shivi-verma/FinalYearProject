import { useState, useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import ChatPage from './components/ChatPage'
import DocumentsPage from './components/DocumentsPage'
import SharedDocumentsPage from './components/SharedDocumentsPage'  // ← NEW IMPORT
import AdminPage from './components/AdminPage'
import LoginPage from './components/LoginPage'
import DashboardPage from './components/DashboardPage'
import Sidebar from './components/Sidebar'
import './App.css'

function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false)
  const [user, setUser] = useState(null)
  const [currentSessionId, setCurrentSessionId] = useState(null)

  useEffect(() => {
    // CHECK IF USER IS LOGGED IN
    const token = localStorage.getItem('token')
    if (token) {
      setIsAuthenticated(true)
      // fetch user info
      fetchUserInfo(token)
    }
  }, [])

  const fetchUserInfo = async (token) => {
    try {
      const response = await fetch('http://localhost:8000/api/auth/me', {
        headers: {
          'Authorization': `Bearer ${token}`
        }
      })
      if (response.ok) {
        const data = await response.json()
        setUser(data)
      }
    } catch (error) {
      console.error('Error fetching user:', error)
    }
  }

  const handleLogin = (token, userData) => {
    localStorage.setItem('token', token)
    setIsAuthenticated(true)
    setUser(userData)
  }

  const handleLogout = () => {
    localStorage.removeItem('token')
    localStorage.removeItem('lastSessionId')
    setIsAuthenticated(false)
    setUser(null)
    setCurrentSessionId(null)
  }

  const handleSessionSelect = (sessionId) => {
    setCurrentSessionId(sessionId)
    if (sessionId) {
      localStorage.setItem('lastSessionId', sessionId)
    } else {
      localStorage.removeItem('lastSessionId')
    }
  }

  if (!isAuthenticated) {
    return <LoginPage onLogin={handleLogin} />
  }

  return (
    <BrowserRouter>
      <div className="app">
        <Sidebar
          user={user}
          onLogout={handleLogout}
          currentSessionId={currentSessionId}
          onSessionSelect={handleSessionSelect}
        />

        <main className="main-content">
          <Routes>
            {/* Dashboard as landing page */}
            <Route
              path="/"
              element={<DashboardPage user={user} />}
            />
            
            {/* Chat page */}
            <Route
              path="/chat"
              element={
                <ChatPage
                  sessionId={currentSessionId}
                  onSessionChange={setCurrentSessionId}
                />
              }
            />
            
            {/* Documents page (LOCAL) */}
            <Route path="/documents" element={<DocumentsPage />} />
            
            {/* Shared Documents page (NEW) */}
            <Route path="/shared-documents" element={<SharedDocumentsPage />} />
            
            {/* Admin page */}
            <Route path="/admin" element={<AdminPage />} />
            
            {/* Redirect unknown routes to chat*/}
            <Route path="*" element={<Navigate to="/chat" replace />} />
          </Routes>
        </main>
      </div>
    </BrowserRouter>
  )
}

export default App