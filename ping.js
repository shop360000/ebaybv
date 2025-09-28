import express from "express";
import pkg from "pg";
import puppeteer from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";

puppeteer.use(StealthPlugin());
const { Client } = pkg;

const router = express.Router();

// DB connection
const DB_CONN =
  "postgresql://db_ghip_user:CuHnDo1hIo0RmtxDX28CbWs4sKX2lgQa@dpg-d3b3novfte5s739ejob0-a.oregon-postgres.render.com:5432/db_ghip";

const SCHEMA = "monitoring";
const CONFIGS = "ping_configs";
const LOGS = "ping_logs";

// Init DB + tables
async function initDB() {
  const client = new Client({ connectionString: DB_CONN, ssl: { rejectUnauthorized: false } });
  await client.connect();

  await client.query(`CREATE SCHEMA IF NOT EXISTS ${SCHEMA};`);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.${CONFIGS} (
      id SERIAL PRIMARY KEY,
      url TEXT NOT NULL,
      proxy TEXT,
      is_active BOOLEAN DEFAULT true,
      last_status TEXT,
      last_pinged TIMESTAMPTZ,
      response_time INT
    );
  `);
  await client.query(`
    CREATE TABLE IF NOT EXISTS ${SCHEMA}.${LOGS} (
      id SERIAL PRIMARY KEY,
      config_id INT REFERENCES ${SCHEMA}.${CONFIGS}(id) ON DELETE CASCADE,
      status TEXT,
      response_time INT,
      checked_at TIMESTAMPTZ DEFAULT NOW()
    );
  `);

  await client.end();
}
await initDB();

// function test ping
async function runPing(url, proxy) {
  const start = Date.now();
  let status = "error";
  let rt = null;

  try {
    const browser = await puppeteer.launch({
      headless: true,
      args: proxy ? [`--proxy-server=${proxy}`] : [],
    });
    const page = await browser.newPage();
    const res = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 15000 });
    rt = Date.now() - start;
    status = res?.status() || "ok";
    await browser.close();
  } catch {
    status = "error";
  }

  return { status, rt };
}

function dbClient() {
  return new Client({ connectionString: DB_CONN, ssl: { rejectUnauthorized: false } });
}

// --- API ---
// get list
router.get("/configs", async (req, res) => {
  const client = dbClient();
  await client.connect();
  const { rows } = await client.query(`SELECT * FROM ${SCHEMA}.${CONFIGS} ORDER BY id DESC`);
  await client.end();
  res.json({ data: rows });
});

// add new
router.post("/configs", async (req, res) => {
  const { url, proxy } = req.body;
  if (!url) return res.status(400).json({ error: "URL required" });

  const client = dbClient();
  await client.connect();
  const { rows } = await client.query(
    `INSERT INTO ${SCHEMA}.${CONFIGS} (url, proxy) VALUES ($1,$2) RETURNING *`,
    [url, proxy]
  );
  await client.end();
  res.json(rows[0]);
});

// update (toggle active)
router.put("/configs/:id", async (req, res) => {
  const { id } = req.params;
  const { is_active } = req.body;
  const client = dbClient();
  await client.connect();
  await client.query(`UPDATE ${SCHEMA}.${CONFIGS} SET is_active=$1 WHERE id=$2`, [is_active, id]);
  await client.end();
  res.json({ success: true });
});

// delete
router.delete("/configs/:id", async (req, res) => {
  const { id } = req.params;
  const client = dbClient();
  await client.connect();
  await client.query(`DELETE FROM ${SCHEMA}.${CONFIGS} WHERE id=$1`, [id]);
  await client.end();
  res.json({ success: true });
});

// test now
router.post("/test/:id", async (req, res) => {
  const { id } = req.params;
  const client = dbClient();
  await client.connect();
  const { rows } = await client.query(`SELECT * FROM ${SCHEMA}.${CONFIGS} WHERE id=$1`, [id]);
  if (rows.length === 0) {
    await client.end();
    return res.status(404).json({ error: "Not found" });
  }
  const cfg = rows[0];
  const result = await runPing(cfg.url, cfg.proxy);

  await client.query(
    `UPDATE ${SCHEMA}.${CONFIGS} SET last_status=$1, response_time=$2, last_pinged=NOW() WHERE id=$3`,
    [result.status, result.rt, id]
  );
  await client.query(
    `INSERT INTO ${SCHEMA}.${LOGS} (config_id,status,response_time) VALUES ($1,$2,$3)`,
    [id, result.status, result.rt]
  );
  await client.end();
  res.json(result);
});

export default router;
