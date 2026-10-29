const express = require("express");
const multer = require("multer");
const path = require("path");
const crypto = require("crypto");
const { one, many, query } = require("../db");
const { requireAuth, requireAdmin } = require("../middleware/auth");
const { findMatches } = require("../utils/matching");

const router = express.Router();

// ---------- Cloudinary (permanent photo storage) ----------
// Set CLOUDINARY_CLOUD_NAME, CLOUDINARY_API_KEY, CLOUDINARY_API_SECRET on Render
// Free account: https://cloudinary.com
let cloudinary = null;
const useCloudinary =
  process.env.CLOUDINARY_CLOUD_NAME &&
  process.env.CLOUDINARY_API_KEY &&
  process.env.CLOUDINARY_API_SECRET;

if (useCloudinary) {
  cloudinary = require("cloudinary").v2;
  cloudinary.config({
    cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
    api_key: process.env.CLOUDINARY_API_KEY,
    api_secret: process.env.CLOUDINARY_API_SECRET,
    secure: true,
  });
  console.log("Photo storage: Cloudinary (permanent)");
} else {
  console.log(
    "Photo storage: local uploads/ (EPHEMERAL on Render free — set Cloudinary env vars to keep photos)"
  );
}

// Memory storage when using Cloudinary; disk when local
const storage = useCloudinary
  ? multer.memoryStorage()
  : multer.diskStorage({
      destination: (req, file, cb) => cb(null, path.join(__dirname, "..", "uploads")),
      filename: (req, file, cb) => {
        const unique = crypto.randomBytes(8).toString("hex");
        cb(null, `${Date.now()}-${unique}${path.extname(file.originalname)}`);
      },
    });

const upload = multer({
  storage,
  limits: { fileSize: 8 * 1024 * 1024 }, // 8MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith("image/")) {
      return cb(new Error("Only image files are allowed"));
    }
    cb(null, true);
  },
});

async function savePhoto(file) {
  if (!file) return null;

  if (useCloudinary) {
    // Upload buffer to Cloudinary
    const result = await new Promise((resolve, reject) => {
      const stream = cloudinary.uploader.upload_stream(
        {
          folder: "lost-found",
          resource_type: "image",
          // Auto-optimize for web
          transformation: [{ quality: "auto", fetch_format: "auto" }],
        },
        (err, res) => (err ? reject(err) : resolve(res))
      );
      stream.end(file.buffer);
    });
    return result.secure_url; // full https URL that never expires
  }

  // Local disk fallback (dev only — wiped on Render restart)
  return `/uploads/${file.filename}`;
}

// POST /api/reports  (create a lost or found report, photo optional)
router.post("/", requireAuth, (req, res) => {
  upload.single("photo")(req, res, async (err) => {
    if (err) return res.status(400).json({ error: err.message });

    try {
      const { type, category, title, description, location } = req.body;
      if (!type || !category || !title || !description || !location) {
        return res
          .status(400)
          .json({ error: "Type, category, title, description, and location are all required" });
      }
      if (type !== "lost" && type !== "found") {
        return res.status(400).json({ error: "Type must be 'lost' or 'found'" });
      }

      let photoPath = null;
      if (req.file) {
        try {
          photoPath = await savePhoto(req.file);
        } catch (uploadErr) {
          console.error("Photo upload failed:", uploadErr.message);
          return res.status(500).json({
            error: "Photo upload failed. Try a smaller image or try again.",
          });
        }
      }

      const result = await query(
        `INSERT INTO reports (user_id, type, category, title, description, location, photo_path, status)
         VALUES ($1, $2, $3, $4, $5, $6, $7, 'Open')
         RETURNING *`,
        [req.user.id, type, category, title, description, location, photoPath]
      );

      res.status(201).json(result.rows[0]);
    } catch (e) {
      console.error(e);
      res.status(500).json({ error: "Failed to create report" });
    }
  });
});

// GET /api/reports?type=lost|found  (browse all open reports, optionally filtered)
router.get("/", requireAuth, async (req, res) => {
  try {
    const { type, category } = req.query;
    let sql = `SELECT reports.*, users.name AS reporter_name FROM reports
               JOIN users ON reports.user_id = users.id WHERE reports.status != 'Returned'`;
    const params = [];
    let i = 1;

    if (type === "lost" || type === "found") {
      sql += ` AND reports.type = $${i++}`;
      params.push(type);
    }
    if (category) {
      sql += ` AND reports.category = $${i++}`;
      params.push(category);
    }
    sql += " ORDER BY reports.created_at DESC";

    const rows = await many(sql, params);
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch reports" });
  }
});

// GET /api/reports/mine  (the logged-in user's own reports)
router.get("/mine", requireAuth, async (req, res) => {
  try {
    const rows = await many(
      "SELECT * FROM reports WHERE user_id = $1 ORDER BY created_at DESC",
      [req.user.id]
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch your reports" });
  }
});

// GET /api/reports/:id  (single report detail)
router.get("/:id", requireAuth, async (req, res) => {
  try {
    const report = await one(
      `SELECT reports.*, users.name AS reporter_name FROM reports
       JOIN users ON reports.user_id = users.id WHERE reports.id = $1`,
      [req.params.id]
    );
    if (!report) return res.status(404).json({ error: "Report not found" });
    res.json(report);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch report" });
  }
});

// GET /api/reports/:id/matches  (AI-suggested matches from the opposite list)
router.get("/:id/matches", requireAuth, async (req, res) => {
  try {
    const target = await one("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    if (!target) return res.status(404).json({ error: "Report not found" });

    const oppositeType = target.type === "lost" ? "found" : "lost";
    const candidates = await many(
      "SELECT * FROM reports WHERE type = $1 AND status != 'Returned' AND id != $2",
      [oppositeType, target.id]
    );

    const matches = findMatches(target, candidates, 30);
    res.json(matches.map((m) => ({ ...m.report, matchScore: m.score })));
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to find matches" });
  }
});

// PATCH /api/reports/:id/status  (owner or admin updates status)
router.patch("/:id/status", requireAuth, async (req, res) => {
  try {
    const { status } = req.body;
    const allowed = ["Open", "Matched", "Returned"];
    if (!allowed.includes(status)) {
      return res.status(400).json({ error: "Status must be one of: " + allowed.join(", ") });
    }

    const report = await one("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    if (!report) return res.status(404).json({ error: "Report not found" });

    const isOwner = report.user_id === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "You can only update your own reports" });
    }

    const resolvedAt = status === "Returned" ? new Date().toISOString() : null;
    await query("UPDATE reports SET status = $1, resolved_at = $2 WHERE id = $3", [
      status,
      resolvedAt,
      req.params.id,
    ]);

    const updated = await one("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    res.json(updated);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to update status" });
  }
});

// GET /api/reports/admin/all  (admin: see every report regardless of status)
router.get("/admin/all", requireAuth, requireAdmin, async (req, res) => {
  try {
    const rows = await many(
      `SELECT reports.*, users.name AS reporter_name FROM reports
       JOIN users ON reports.user_id = users.id ORDER BY reports.created_at DESC`
    );
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to fetch admin reports" });
  }
});

// DELETE /api/reports/:id  (owner or admin can delete)
router.delete("/:id", requireAuth, async (req, res) => {
  try {
    const report = await one("SELECT * FROM reports WHERE id = $1", [req.params.id]);
    if (!report) return res.status(404).json({ error: "Report not found" });

    const isOwner = report.user_id === req.user.id;
    const isAdmin = req.user.role === "admin";
    if (!isOwner && !isAdmin) {
      return res.status(403).json({ error: "You can only delete your own reports" });
    }

    await query("DELETE FROM reports WHERE id = $1", [req.params.id]);
    res.json({ message: "Report deleted successfully" });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: "Failed to delete report" });
  }
});

module.exports = router;
