import { useState, useEffect, useRef } from 'react'
import { Send, Code, FileText, Check, X, RefreshCw, Download, Mic, MicOff, Database, Globe, User } from 'lucide-react'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { vscDarkPlus } from 'react-syntax-highlighter/dist/esm/styles/prism'

function ChatPage() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [sessionId, setSessionId] = useState(null)
  const [loadingHistory, setLoadingHistory] = useState(false)

  // Database selection state
  const [selectedDb, setSelectedDb] = useState('local')  // 'local' or 'shared'

  // Editing states
  const [editingIndex, setEditingIndex] = useState(null)
  const [editingText, setEditingText] = useState("")
  const [isRegenerating, setIsRegenerating] = useState(false)

  // Voice input states
  const [isListening, setIsListening] = useState(false)
  const [speechSupported, setSpeechSupported] = useState(false)

  const messagesEndRef = useRef(null)
  const previousSessionRef = useRef(null)
  const recognitionRef = useRef(null)

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }

  useEffect(() => {
    scrollToBottom()
  }, [messages])

  // Initialize Speech Recognition
  useEffect(() => {
    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition
    
    if (SpeechRecognition) {
      setSpeechSupported(true)
      const recognition = new SpeechRecognition()
      
      recognition.continuous = false
      recognition.interimResults = false
      recognition.lang = 'en-US'

      recognition.onstart = () => {
        setIsListening(true)
        console.log('🎤 Voice recognition started')
      }

      recognition.onresult = (event) => {
        let finalTranscript = ''
        for (let i = 0; i < event.results.length; i++) {
          if (event.results[i].isFinal) {
            finalTranscript += event.results[i][0].transcript + ' '
          }
        }
        if (finalTranscript.trim()) {
          setInput(prev => prev + finalTranscript)
        }
      }

      recognition.onerror = (event) => {
        console.error('❌ Speech recognition error:', event.error)
        setIsListening(false)
        if (event.error === 'not-allowed') {
          alert('Microphone access denied. Please allow microphone access in your browser settings.')
        }
      }

      recognition.onend = () => {
        setIsListening(false)
        console.log('🛑 Voice recognition stopped')
      }

      recognitionRef.current = recognition
    }

    return () => {
      if (recognitionRef.current) {
        recognitionRef.current.stop()
      }
    }
  }, [])

  const toggleVoiceInput = () => {
    if (!speechSupported) {
      alert('Speech recognition is not supported in your browser. Please use Chrome, Edge, or Safari.')
      return
    }
    if (isListening) {
      recognitionRef.current.stop()
    } else {
      try {
        recognitionRef.current.start()
      } catch (error) {
        console.error('Error starting recognition:', error)
      }
    }
  }

  // Monitor sessionId changes
  useEffect(() => {
    const checkSessionChange = () => {
      const savedSessionId = localStorage.getItem('lastSessionId')
      if (savedSessionId !== previousSessionRef.current) {
        previousSessionRef.current = savedSessionId
        setSessionId(savedSessionId)
        setMessages([])
        setEditingIndex(null)
        setEditingText("")
      }
    }
    checkSessionChange()
    const interval = setInterval(checkSessionChange, 500)
    return () => clearInterval(interval)
  }, [])

  // Load chat history
  useEffect(() => {
    const loadChatHistory = async () => {
      if (!sessionId) {
        setMessages([])
        return
      }
      setLoadingHistory(true)
      try {
        const response = await fetch(
          `http://localhost:8000/api/chat/sessions/${sessionId}/messages`,
          {
            headers: {
              'Authorization': `Bearer ${localStorage.getItem('token')}`
            }
          }
        )
        if (response.ok) {
          const data = await response.json()
          const loadedMessages = data.map(msg => ({
            role: msg.role,
            content: msg.content,
            sources: msg.sources || [],
            responseTime: msg.response_time_ms,
            dbScope: msg.db_scope || 'local'  // Track which DB was used
          }))
          setMessages(loadedMessages)
        }
      } catch (error) {
        console.error('❌ Failed to load chat history:', error)
      } finally {
        setLoadingHistory(false)
      }
    }
    loadChatHistory()
  }, [sessionId])

  // SEND NEW MESSAGE (with database selection)
  const sendMessage = async () => {
    if (!input.trim()) return

    if (isListening) {
      recognitionRef.current.stop()
    }

    const userMessage = { role: 'user', content: input, dbScope: selectedDb }
    setMessages(prev => [...prev, userMessage])
    setInput('')
    setLoading(true)

    try {
      const response = await fetch('http://localhost:8000/api/chat/query', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          query: input,
          session_id: sessionId,
          use_rag: true,
          db_scope: selectedDb  // ← NEW: tell backend which DB to search
        })
      })

      const data = await response.json()
      
      if (!sessionId) {
        setSessionId(data.session_id)
        localStorage.setItem('lastSessionId', data.session_id)
        previousSessionRef.current = data.session_id
        window.dispatchEvent(new CustomEvent('newChatSession'))
      }

      const assistantMessage = {
        role: 'assistant',
        content: data.answer,
        sources: data.sources,
        responseTime: data.response_time_ms,
        dbScope: selectedDb
      }

      setMessages(prev => [...prev, assistantMessage])
    } catch (error) {
      console.error('Error:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, there was an error. Please try again.',
        dbScope: selectedDb
      }])
    } finally {
      setLoading(false)
    }
  }

  const handleKeyPress = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      sendMessage()
    }
  }

  // Edit message
  const saveEditedMessage = async () => {
    if (!editingText.trim()) return

    const newQuery = editingText
    const editIdx = editingIndex
    const dbScopeForEdit = messages[editIdx].dbScope || selectedDb

    setIsRegenerating(true)
    
    const updated = [...messages]
    updated[editIdx].content = newQuery

    if (updated[editIdx + 1] && updated[editIdx + 1].role === 'assistant') {
      updated.splice(editIdx + 1, 1)
    }
    
    setMessages(updated)
    setEditingIndex(null)
    setEditingText("")

    try {
      const response = await fetch('http://localhost:8000/api/chat/query', {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: JSON.stringify({
          query: newQuery,
          session_id: sessionId,
          use_rag: true,
          db_scope: dbScopeForEdit  // Use original DB scope
        })
      })

      const data = await response.json()

      const newAssistantMessage = {
        role: "assistant",
        content: data.answer,
        sources: data.sources,
        responseTime: data.response_time_ms,
        dbScope: dbScopeForEdit
      }

      setMessages(prev => [...prev, newAssistantMessage])
    } catch (error) {
      console.error('Error regenerating response:', error)
      setMessages(prev => [...prev, {
        role: 'assistant',
        content: 'Sorry, there was an error regenerating the response. Please try again.',
        dbScope: dbScopeForEdit
      }])
    } finally {
      setIsRegenerating(false)
    }
  }

  const startNewChat = () => {
    setMessages([])
    setSessionId(null)
    localStorage.removeItem('lastSessionId')
    previousSessionRef.current = null
    window.dispatchEvent(new CustomEvent('newChatSession'))
  }

  const exportChatAsMarkdown = () => {
    if (messages.length === 0) {
      alert('No messages to export!')
      return
    }

    let markdown = `# Chat Export\n\n`
    markdown += `**Exported on:** ${new Date().toLocaleString()}\n\n`
    markdown += `**Total Messages:** ${messages.length}\n\n`
    markdown += `---\n\n`

    messages.forEach((msg, index) => {
      const role = msg.role === 'user' ? '👤 User' : '🤖 Assistant'
      const dbLabel = msg.dbScope === 'shared' ? ' (Shared DB)' : ' (Local DB)'
      markdown += `## ${role}${msg.role === 'user' ? dbLabel : ''}\n\n`
      markdown += `${msg.content}\n\n`
      
      if (msg.sources && msg.sources.length > 0) {
        markdown += `**Sources:**\n`
        msg.sources.forEach(source => {
          markdown += `- ${source.source}\n`
        })
        markdown += `\n`
      }
      
      if (msg.responseTime) {
        markdown += `*Response time: ${msg.responseTime}ms*\n\n`
      }
      
      markdown += `---\n\n`
    })

    const blob = new Blob([markdown], { type: 'text/markdown' })
    const url = URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `chat-export-${new Date().toISOString().split('T')[0]}.md`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    URL.revokeObjectURL(url)
    
    console.log('✅ Chat exported as Markdown')
  }

  return (
    <div className="chat-page">
      <div className="chat-header">
        <div>
          <h2>Code Assistant Chat</h2>
          <p>Ask questions about your codebase</p>
        </div>
        <div className="chat-header-buttons">
          <button 
            onClick={exportChatAsMarkdown} 
            className="export-button" 
            disabled={messages.length === 0}
          >
            <Download size={16} />
            Export
          </button>
          <button onClick={startNewChat} className="new-chat-button">
            + New Chat
          </button>
        </div>
      </div>

      <div className="messages-container">
        {loadingHistory ? (
          <div className="empty-state">
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
            <p>Loading chat history...</p>
          </div>
        ) : messages.length === 0 ? (
          <div className="empty-state">
            <Code size={64} />
            <h3>Start a conversation</h3>
            <p>Ask me anything about your company's code or documentation</p>
            <p style={{ fontSize: '14px', color: '#888', marginTop: '12px' }}>
              Choose between your local documents or shared team documents below
            </p>
          </div>
        ) : null}

        {messages.map((msg, idx) => (
          <div key={idx} className={`message ${msg.role}`}>
            {/* DB Scope Badge */}
            {msg.dbScope && (
              <div className={`db-badge ${msg.dbScope}`}>
                {msg.dbScope === 'shared' ? (
                  <><Globe size={12} /> Shared</>
                ) : (
                  <><User size={12} /> Local</>
                )}
              </div>
            )}

            <div className="message-content">
              {editingIndex === idx && msg.role === "user" ? (
                <>
                  <textarea
                    className="edit-box"
                    value={editingText}
                    onChange={(e) => setEditingText(e.target.value)}
                    autoFocus
                  />
                  <div className="edit-buttons">
                    <button 
                      onClick={saveEditedMessage} 
                      className="save-btn"
                      disabled={isRegenerating || !editingText.trim()}
                    >
                      {isRegenerating ? (
                        <>
                          <RefreshCw size={16} className="spinning" />
                          Regenerating...
                        </>
                      ) : (
                        <>
                          <Check size={16} />
                          Submit
                        </>
                      )}
                    </button>
                    <button 
                      onClick={() => { setEditingIndex(null); setEditingText("") }}
                      className="cancel-btn"
                      disabled={isRegenerating}
                    >
                      <X size={16} />
                      Cancel
                    </button>
                  </div>
                </>
              ) : (
                <>
                  <ReactMarkdown
                    components={{
                      code({node, inline, className, children, ...props}) {
                        const match = /language-(\w+)/.exec(className || '')
                        return !inline && match ? (
                          <SyntaxHighlighter
                            style={vscDarkPlus}
                            language={match[1]}
                            PreTag="div"
                            {...props}
                          >
                            {String(children).replace(/\n$/, '')}
                          </SyntaxHighlighter>
                        ) : (
                          <code className={className} {...props}>
                            {children}
                          </code>
                        )
                      }
                    }}
                  >
                    {msg.content}
                  </ReactMarkdown>

                  {msg.role === "user" && (
                    <button
                      className="inline-edit-btn"
                      onClick={() => {
                        setEditingIndex(idx)
                        setEditingText(msg.content)
                      }}
                    >
                      Edit
                    </button>
                  )}
                </>
              )}

              {msg.sources && msg.sources.length > 0 && (
                <div className="sources">
                  <FileText size={16} />
                  <span>Sources:</span>
                  {msg.sources.map((source, i) => (
                    <span key={i} className="source-tag">
                      {source.source}
                    </span>
                  ))}
                </div>
              )}

              {msg.responseTime && (
                <div className="response-time">
                  Response time: {msg.responseTime}ms
                </div>
              )}
            </div>
          </div>
        ))}

        {loading && (
          <div className="message assistant">
            <div className="typing-indicator">
              <span></span><span></span><span></span>
            </div>
          </div>
        )}

        {isRegenerating && (
          <div className="message assistant">
            <div className="message-content">
              <div className="typing-indicator">
                <span></span><span></span><span></span>
              </div>
              <p style={{ marginTop: '8px', fontSize: '14px', color: '#94a3b8' }}>
                Regenerating response...
              </p>
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* INPUT AREA WITH DATABASE SELECTOR */}
      <div className="input-container">
        {/* Database Selector */}
        <div className="db-selector">
          <button
            className={`db-option ${selectedDb === 'local' ? 'active' : ''}`}
            onClick={() => setSelectedDb('local')}
            title="Search your personal documents"
          >
            <User size={16} />
            My Documents
          </button>
          <button
            className={`db-option ${selectedDb === 'shared' ? 'active' : ''}`}
            onClick={() => setSelectedDb('shared')}
            title="Search shared team documents"
          >
            <Globe size={16} />
            Shared Documents
          </button>
        </div>

        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyPress={handleKeyPress}
          placeholder={isListening ? "Listening... Speak now!" : `Ask a question about ${selectedDb === 'shared' ? 'shared team' : 'your personal'} documents...`}
          rows={3}
          disabled={loading}
          className={isListening ? 'listening' : ''}
        />
        
        {speechSupported && (
          <button
            onClick={toggleVoiceInput}
            disabled={loading}
            className={`voice-button ${isListening ? 'listening' : ''}`}
            title={isListening ? 'Stop listening' : 'Start voice input'}
          >
            {isListening ? <MicOff size={20} /> : <Mic size={20} />}
          </button>
        )}

        <button 
          onClick={sendMessage} 
          disabled={loading || !input.trim()}
          className="send-button"
        >
          <Send size={20} />
        </button>
      </div>
    </div>
  )
}

export default ChatPage