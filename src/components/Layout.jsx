import { Link } from 'react-router-dom'

export default function Layout({ children, title, showBack = false }) {
  return (
    <div className="layout">
      <header className="header">
        <div className="header-left">
          {showBack ? (
            <Link to="/" className="back-link">
              ← Back
            </Link>
          ) : (
            <Link to="/" className="brand">
              JobSnap Scraper
            </Link>
          )}
        </div>
        <h1 className="page-title">{title}</h1>
        <div className="header-right">
          {!showBack && (
            <Link to="/settings" className="settings-link">
              Settings
            </Link>
          )}
        </div>
      </header>
      <main className="main">{children}</main>
    </div>
  )
}
