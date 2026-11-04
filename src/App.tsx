import { BrowserRouter, Link, Navigate, Route, Routes } from 'react-router-dom'
import { AuthProvider, useAuth } from './auth'
import HomePage from './pages/HomePage'
import NewDebatePage from './pages/NewDebatePage'
import DebatePage from './pages/DebatePage'
import InvitePage from './pages/InvitePage'
import SamplePage from './pages/SamplePage'
import ImportPage from './pages/ImportPage'
import LibraryPage from './pages/LibraryPage'
import AdminPage from './pages/AdminPage'

export default function App() {
  return (
    <AuthProvider>
      <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '')}>
        <Shell />
      </BrowserRouter>
    </AuthProvider>
  )
}

function Shell() {
  const { user, loading, signOut, isSuperAdmin } = useAuth()
  return (
    <div className="app">
      <nav className="topbar">
        <div className="row">
          <Link to="/" className="brand">
            Parrhesia
          </Link>
          <Link to="/library" className="small nav-link">
            Library
          </Link>
          {isSuperAdmin && (
            <Link to="/admin" className="small nav-link">
              Admins
            </Link>
          )}
        </div>
        {user && (
          <div className="row-sm">
            {user.photoURL && <img className="avatar" src={user.photoURL} alt="" referrerPolicy="no-referrer" />}
            <span className="small">{user.displayName}</span>
            <button className="btn small-btn" type="button" onClick={() => signOut()}>
              Sign out
            </button>
          </div>
        )}
      </nav>
      {loading ? (
        <p className="page narrow muted">Loading…</p>
      ) : (
        <Routes>
          <Route path="/" element={<HomePage />} />
          <Route path="/sample" element={<SamplePage />} />
          <Route path="/invite/:token" element={<InvitePage />} />
          <Route path="/new" element={user ? <NewDebatePage /> : <Navigate to="/" replace />} />
          <Route path="/library" element={<LibraryPage />} />
          <Route path="/admin" element={user ? <AdminPage /> : <Navigate to="/" replace />} />
          <Route path="/import" element={user ? <ImportPage /> : <Navigate to="/" replace />} />
          <Route path="/d/:id" element={<DebatePage />} />
          <Route path="*" element={<p className="page narrow">This page doesn’t exist. <Link to="/">Go home</Link></p>} />
        </Routes>
      )}
    </div>
  )
}
