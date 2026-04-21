import React, { useState, useEffect, useRef } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Search, Menu, X } from "lucide-react";
import { useDebounce } from "../../hooks/useDebounce";
import { api } from "../../services/api";
import "./Navbar.css";

const Navbar = () => {
  const [isSearchOpen, setIsSearchOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const debouncedTerm = useDebounce(searchQuery, 400);
  const navigate = useNavigate();
  const searchRef = useRef(null);

  useEffect(() => {
    if (!debouncedTerm) { setSearchResults([]); setShowDropdown(false); return; }
    api.search(debouncedTerm, 1).then(res => {
      setSearchResults(res.items || []);
      setShowDropdown(true);
    }).catch(() => {});
  }, [debouncedTerm]);

  useEffect(() => {
    const handler = (e) => {
      if (searchRef.current && !searchRef.current.contains(e.target)) setShowDropdown(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const handleSubmit = (e) => {
    e.preventDefault();
    if (searchQuery.trim()) {
      navigate(`/search?q=${encodeURIComponent(searchQuery)}`);
      setIsSearchOpen(false); setShowDropdown(false); setSearchQuery("");
    }
  };

  const NAV_LINKS = [
    { label: 'Home', to: '/' },
    { label: 'Movies', to: '/category/popular-movies' },
    { label: 'TV Shows', to: '/category/popular-tv' },
    { label: 'K-Drama', to: '/category/kdrama' },
    { label: 'Anime', to: '/category/anime' },
    { label: 'Indo', to: '/category/indonesian-movies' },
    { label: 'Categories', to: '/categories' },
  ];

  return (
    <nav className="navbar">
      <Link to="/" className="logo">
        <img src="/logo.png" alt="B3Flix" className="navbar-logo-img" onError={e => e.target.style.display='none'} />
        <span>B3Flix</span>
      </Link>

      <div className={`navLinks ${isMobileMenuOpen ? "open" : ""}`}>
        {NAV_LINKS.map(link => (
          <Link key={link.to} to={link.to} className="navLink" onClick={() => setIsMobileMenuOpen(false)}>
            {link.label}
          </Link>
        ))}
      </div>

      <div className="rightSection">
        <div ref={searchRef} style={{ position: "relative" }}>
          <form className={`searchContainer ${isSearchOpen ? "active" : ""}`} onSubmit={handleSubmit}>
            <button type="button" className="iconButton" onClick={() => {
              setIsSearchOpen(!isSearchOpen);
              if (!isSearchOpen) setTimeout(() => document.querySelector(".searchInput")?.focus(), 100);
            }}>
              <Search size={20} />
            </button>
            <input
              type="text"
              className={`searchInput ${isSearchOpen ? "open" : ""}`}
              placeholder="Search movies, TV shows..."
              value={searchQuery}
              onChange={e => setSearchQuery(e.target.value)}
              onFocus={() => { if (searchResults.length > 0) setShowDropdown(true); }}
            />
          </form>

          {showDropdown && searchResults.length > 0 && (
            <div style={{
              position: "absolute", top: "100%", right: 0, width: "300px",
              backgroundColor: "#141414", borderRadius: "0 0 8px 8px",
              boxShadow: "0 8px 24px rgba(0,0,0,0.7)", zIndex: 1001,
              maxHeight: "420px", overflowY: "auto", border: "1px solid #222"
            }}>
              {searchResults.slice(0, 6).map(item => (
                <Link
                  key={item.id}
                  to={`/detail/${item.detailPath}`}
                  onClick={() => { setShowDropdown(false); setIsSearchOpen(false); setSearchQuery(""); }}
                  style={{
                    display: "flex", gap: "12px", padding: "10px 12px",
                    borderBottom: "1px solid #1a1a1a", color: "white",
                    alignItems: "center", textDecoration: "none"
                  }}
                >
                  <img src={item.poster} alt={item.title}
                    style={{ width: "38px", height: "56px", objectFit: "cover", borderRadius: "4px", flexShrink: 0 }}
                    onError={e => e.target.style.display='none'}
                  />
                  <div>
                    <div style={{ fontWeight: 600, fontSize: "0.88rem", lineHeight: 1.3 }}>{item.title}</div>
                    <div style={{ fontSize: "0.75rem", color: "#888", marginTop: "2px" }}>
                      {item.year} • {item.type} • ⭐ {item.rating}
                    </div>
                  </div>
                </Link>
              ))}
              <div
                onClick={handleSubmit}
                style={{
                  padding: "10px", textAlign: "center", cursor: "pointer",
                  color: "var(--primary-color, #e50914)", fontWeight: 600, fontSize: "0.85rem",
                  borderTop: "1px solid #1a1a1a"
                }}
              >
                See all results for "{searchQuery}"
              </div>
            </div>
          )}
        </div>

        <button className="iconButton mobileMenuBtn" onClick={() => setIsMobileMenuOpen(!isMobileMenuOpen)}>
          {isMobileMenuOpen ? <X size={24} /> : <Menu size={24} />}
        </button>
      </div>
    </nav>
  );
};

export default Navbar;
