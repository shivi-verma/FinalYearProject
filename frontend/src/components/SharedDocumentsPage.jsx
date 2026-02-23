import { useState, useEffect } from 'react'
import { Upload, Trash2, CheckCircle, Clock, XCircle, FileText, Globe, RefreshCw } from 'lucide-react'

function SharedDocumentsPage() {
  const [documents, setDocuments] = useState([])
  const [uploading, setUploading] = useState(false)
  const [selectedFile, setSelectedFile] = useState(null)
  const [serverStatus, setServerStatus] = useState(null)

  useEffect(() => {
    fetchDocuments()
    checkServerHealth()
  }, [])

  const checkServerHealth = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/documents/health', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      
      if (response.ok) {
        const data = await response.json()
        setServerStatus(data.shared)
      }
    } catch (error) {
      console.error('Health check failed:', error)
      setServerStatus({ status: 'unreachable' })
    }
  }

  const fetchDocuments = async () => {
    try {
      const response = await fetch('http://localhost:8000/api/documents?scope=shared', {
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      const data = await response.json()
      setDocuments(data.documents || data || [])
    } catch (error) {
      console.error('Error fetching documents:', error)
    }
  }

  const handleFileSelect = (e) => {
    setSelectedFile(e.target.files[0])
  }

  const uploadDocument = async () => {
    if (!selectedFile) return

    setUploading(true)
    const formData = new FormData()
    formData.append('file', selectedFile)

    try {
      const response = await fetch('http://localhost:8000/api/documents/upload?scope=shared', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        },
        body: formData
      })

      if (response.ok) {
        const data = await response.json()
        alert(`✅ Uploaded to shared database!\n\nIndexed ${data.chunk_count || data.chunks_indexed} chunks`)
        setSelectedFile(null)
        fetchDocuments()
        checkServerHealth()
      } else {
        const error = await response.json()
        alert(`❌ Upload failed: ${error.detail}`)
      }
    } catch (error) {
      console.error('Error uploading:', error)
      alert('❌ Upload failed. Is the shared server running?')
    } finally {
      setUploading(false)
    }
  }

  const deleteDocument = async (id) => {
    if (!confirm('⚠️ Delete from SHARED database?\n\nThis will affect all team members!')) return

    try {
      await fetch(`http://localhost:8000/api/documents/${id}?scope=shared`, {
        method: 'DELETE',
        headers: {
          'Authorization': `Bearer ${localStorage.getItem('token')}`
        }
      })
      alert('✅ Document deleted from shared database')
      fetchDocuments()
      checkServerHealth()
    } catch (error) {
      console.error('Error deleting:', error)
      alert('❌ Delete failed')
    }
  }

  const getStatusIcon = (status) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="status-icon completed" size={20} />
      case 'processing':
        return <Clock className="status-icon processing" size={20} />
      case 'failed':
        return <XCircle className="status-icon failed" size={20} />
      default:
        return <CheckCircle className="status-icon completed" size={20} />
    }
  }

  return (
    <div className="documents-page">
      <div className="page-header">
        <h2>
          <Globe size={28} style={{ verticalAlign: 'middle', marginRight: '8px' }} />
          Shared Document Management
        </h2>
        <p>Company-wide documents — visible and searchable by your entire team</p>
      </div>

      {/* Server Status Banner */}
      {serverStatus && (
        <div className={`server-status ${serverStatus.status === 'ok' ? 'online' : 'offline'}`}>
          {serverStatus.status === 'ok' ? (
            <>
              ✅ Connected to shared server
              {serverStatus.total_chunks !== undefined && (
                <span> — {serverStatus.total_chunks} chunks indexed</span>
              )}
            </>
          ) : (
            <>⚠️ Shared server unreachable. Make sure it's running on port 8001.</>
          )}
          <button
            onClick={() => { checkServerHealth(); fetchDocuments(); }}
            className="refresh-btn"
          >
            <RefreshCw size={14} /> Refresh
          </button>
        </div>
      )}

      {/* Upload Section */}
      <div className="upload-section">
        <div className="upload-card">
          <Globe size={48} />
          <h3>Upload to Shared Database</h3>
          <p>Supported: PDF, TXT, MD, DOCX, PNG, JPG, JPEG</p>
          
          <input
            type="file"
            onChange={handleFileSelect}
            accept=".pdf,.txt,.md,.docx,.png,.jpg,.jpeg,.bmp,.tiff"
            id="file-input-shared"
            style={{ display: 'none' }}
          />
          
          <label htmlFor="file-input-shared" className="file-select-btn">
            {selectedFile ? selectedFile.name : 'Choose File'}
          </label>

          <button
            onClick={uploadDocument}
            disabled={!selectedFile || uploading}
            className="upload-btn"
          >
            {uploading ? 'Uploading to Shared...' : 'Upload to Shared'}
          </button>
        </div>
      </div>

      {/* Documents List */}
      <div className="documents-list">
        <h3>Shared Documents ({documents.length})</h3>
        
        {documents.length === 0 ? (
          <div className="empty-state">
            <Globe size={64} />
            <p>No shared documents yet</p>
            <p style={{ fontSize: '14px', color: '#888', marginTop: '8px' }}>
              Upload documents here to make them searchable by your entire team
            </p>
          </div>
        ) : (
          <div className="documents-grid">
            {documents.map(doc => (
              <div key={doc.id || doc.document_id} className="document-card">
                <div className="document-header">
                  {getStatusIcon(doc.status)}
                  <h4>{doc.title || doc.filename || doc.original_filename}</h4>
                </div>
                
                <div className="document-info">
                  <p><strong>Filename:</strong> {doc.filename || doc.original_filename}</p>
                  <p><strong>Chunks:</strong> {doc.chunk_count || doc.total_chunks || 0}</p>
                  <p><strong>Status:</strong> {doc.status || 'completed'}</p>
                  <p className="upload-date">
                    {doc.uploaded_at ? new Date(doc.uploaded_at).toLocaleString() : 'Shared Document'}
                  </p>
                </div>

                <button
                  onClick={() => deleteDocument(doc.id || doc.document_id)}
                  className="delete-btn"
                >
                  <Trash2 size={16} />
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default SharedDocumentsPage