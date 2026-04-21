import React from "react";
import { Link } from "react-router-dom";

const Footer = () => {
  return (
    <footer
      style={{
        padding: "30px 20px",
        textAlign: "center",
        color: "var(--text-secondary)",
        marginTop: "auto",
        borderTop: "1px solid var(--surface-color)",
        backgroundColor: "var(--bg-color)",
      }}
    >
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
        <p
          style={{
            fontSize: "0.9rem",
            marginBottom: "15px",
            lineHeight: "1.6",
          }}
        >
          Semua konten di website ini bajakan dan tidak resmi. Kami tidak
          memiliki afiliasi dengan studio atau pembuat film manapun. Situs ini
          hanya untuk hiburan dan edukasi. Jika Anda menyukai filmnya, dukunglah
          dengan menonton di platform resmi!
        </p>
        <p style={{ marginBottom: "10px" }}>
          <Link
            to="/disclaimer"
            style={{ color: "var(--primary-color)", textDecoration: "none" }}
          >
            Disclaimer
          </Link>
        </p>
        <p style={{ fontSize: "0.85rem" }}>
          &copy; {new Date().getFullYear()} B3Flix. By Seseorang yang malas buat
          deskripsi. All rights reserved.
        </p>
      </div>
    </footer>
  );
};

export default Footer;
