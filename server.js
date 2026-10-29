require("dotenv").config();
const express = require("express");
const cors = require("cors");
const helmet = require("helmet");
const path = require("path");
const fs = require("fs");

const { initDb } = require("./db");
const { authLimiter } = require("./middleware/rateLimiter");
const authRoutes = require("./routes/auth");
const reportRoutes = require("./routes/reports");

const app = express();
const PORT = process.env.PORT || 3000;

// Ensure uploads folder exists (still ephemeral on Render free – see README)
const uploadsDir = path.join(__dirname, "uploads");
if (!fs.existsSync(uploadsDir)) fs.mkdirSync(uploadsDir, { recursive: true });

app.use(helmet({ contentSecurityPolicy: false, crossOriginResourcePolicy: false }));
app.use(cors());
app.use(express.json());

// Serve the website (public folder)
app.use(express.static(path.join(__dirname, "public")));

// Serve uploaded photos
app.use("/uploads", express.static(uploadsDir));

app.use("/api/auth/login", authLimiter);
app.use("/api/auth/register", authLimiter);
app.use("/api/auth", authRoutes);
app.use("/api/reports", reportRoutes);

// Health check (useful on Render)
app.get("/api/health", (req, res) => res.json({ ok: true }));

async function start() {
  try {
    await initDb();
    app.listen(PORT, () => {
      console.log(`Server running at http://localhost:${PORT}`);
      console.log(`Open that address in your browser to use the site.`);
    });
  } catch (err) {
    console.error("Failed to start server:", err);
    process.exit(1);
  }
}

start();
