const { Pool } = require("pg");

if (!process.env.DATABASE_URL) {
  console.error(
    "\n❌  DATABASE_URL is missing.\n" +
      "   Create a free Postgres database on https://supabase.com (or Neon / Render)\n" +
      "   then put the connection string in your .env / Render environment variables.\n"
  );
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // Supabase / Neon / Render all need SSL in production
  ssl: process.env.DATABASE_URL.includes("localhost")
    ? false
    : { rejectUnauthorized: false },
});

/** Run a query and return the full result object */
async function query(text, params = []) {
  return pool.query(text, params);
}

/** Run a query and return the first row (or null) */
async function one(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows[0] || null;
}

/** Run a query and return all rows */
async function many(text, params = []) {
  const res = await pool.query(text, params);
  return res.rows;
}

async function initDb() {
  // Create tables (Postgres syntax)
  await query(`
    CREATE TABLE IF NOT EXISTS users (
      id              SERIAL PRIMARY KEY,
      name            TEXT NOT NULL,
      register_no     TEXT UNIQUE,
      roll_no         INTEGER,
      email           TEXT UNIQUE NOT NULL,
      password        TEXT NOT NULL,
      role            TEXT NOT NULL DEFAULT 'student',
      verified        INTEGER NOT NULL DEFAULT 0,
      verify_token    TEXT,
      verify_token_expires TIMESTAMPTZ,
      reset_token     TEXT,
      reset_token_expires  TIMESTAMPTZ,
      created_at      TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS students (
      register_no TEXT PRIMARY KEY,
      roll_no     INTEGER NOT NULL,
      name        TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS reports (
      id          SERIAL PRIMARY KEY,
      user_id     INTEGER NOT NULL REFERENCES users(id),
      type        TEXT NOT NULL,
      category    TEXT NOT NULL,
      title       TEXT NOT NULL,
      description TEXT NOT NULL,
      location    TEXT NOT NULL,
      photo_path  TEXT,
      status      TEXT NOT NULL DEFAULT 'Open',
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      resolved_at TIMESTAMPTZ
    );
  `);

  // Seed the class roster (only if empty)
  const { rows: studentRows } = await query("SELECT COUNT(*)::int AS c FROM students");
  if (studentRows[0].c === 0) {
    const ROSTER = [
      [1, "2401150517", "ABHIJITH.P.V"],
      [2, "2401150518", "ABHINANDHU P J"],
      [3, "2401150519", "ABHINAV A S"],
      [4, "2401150520", "ABIN M J"],
      [5, "2401150521", "ABINAV BABU"],
      [6, "2401150523", "AJITH C"],
      [7, "2401150524", "ALBI P S"],
      [8, "2401150525", "ALFIN P J"],
      [9, "2401150526", "ANSIL. S"],
      [10, "2401150528", "ARAVIND U R"],
      [11, "2401150529", "ARJUN KRISHNA P S"],
      [12, "2401150530", "ASWATHY B S"],
      [13, "2401150531", "ASWIN K V"],
      [14, "2401150534", "JOVAN SOLOMON JOY"],
      [15, "2401150535", "MANOJ KUMAR M"],
      [16, "2401150538", "MUHAMMAD ASHIK"],
      [17, "2401150539", "MUHAMMAD SINAN A Y"],
      [18, "2401150540", "MUHAMMED ANSHIL K S"],
      [19, "2401150541", "MUHAMMED LABEEB K M"],
      [20, "2401150542", "MUHAMMED SHAMEEM F"],
      [21, "2401150544", "NIDHIN N"],
      [22, "2401150547", "NIRANJAN K S"],
      [23, "2401150549", "RAHUL. C"],
      [24, "2401150550", "RAMZAN N C"],
      [25, "2401150552", "RINZIYA. P A"],
      [26, "2401150556", "SAJINMADHAV K S"],
      [27, "2401150557", "SANGEETH P M"],
      [28, "2401150558", "SAYOOJ GEO"],
      [29, "2401150561", "SHOVAN SAMANTA"],
      [30, "2401150562", "SIDHARTH P S"],
      [31, "2401150564", "SREEHARI K"],
      [32, "2401150565", "STELAN N T"],
      [33, "2401150569", "VIGNESH V"],
      [34, "2401150571", "VISHNU KRISHNAN"],
      [35, "2401150723", "ABHINANDH. K"],
      [36, "2401150724", "AZEEM FIRAS P"],
      [37, "2401150725", "FARSHAD T M"],
      [38, "2401150726", "HRISHIKESH K P"],
      [39, "2401150727", "MUHAMMMED AMEEN. P. P"],
      [40, "2401150728", "MUHSIN K M"],
      [41, "2401150729", "SREEKUTTAN AR"],
      [43, "2401150731", "SURYADEV I U"],
      [44, "2401150732", "VISWANATHAN K"],
    ];

    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      for (const [roll_no, register_no, name] of ROSTER) {
        await client.query(
          "INSERT INTO students (register_no, roll_no, name) VALUES ($1, $2, $3)",
          [register_no, roll_no, name]
        );
      }
      await client.query("COMMIT");
      console.log(`Seeded class roster: ${ROSTER.length} students`);
    } catch (e) {
      await client.query("ROLLBACK");
      throw e;
    } finally {
      client.release();
    }
  }

  // Seed default admin (only if no users exist)
  const { rows: userRows } = await query("SELECT COUNT(*)::int AS c FROM users");
  if (userRows[0].c === 0) {
    const bcrypt = require("bcryptjs");
    const hash = bcrypt.hashSync("admin123", 10);
    await query(
      `INSERT INTO users (name, email, password, role, verified)
       VALUES ($1, $2, $3, 'admin', 1)`,
      ["Admin", "admin@college.edu", hash]
    );
    console.log("Seeded default admin -> email: admin@college.edu | password: admin123");
  }
}

module.exports = { pool, query, one, many, initDb };
