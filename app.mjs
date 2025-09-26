import express from "express";
import fs from "fs";
import cors from "cors";
import path from "path";
import axios from "axios";
import bodyParser from "body-parser";

// ================== Cấu hình ==================
const PORT = process.env.PORT || 10000;
const DATA_FILE = "emails.json";

const GITHUB_TOKEN = "ghp_xxxxx"; // ⚠️ thay bằng token của bạn
const USERNAME = "angadresmatomasante-spec";
const REPO = "RENDER";
const BRANCH = "main";
const FILEPATH = "emails.json";

// ================== Khởi tạo server ==================
const app = express();
app.use(cors());
app.use(bodyParser.json());
app.use(express.static(".")); // phục vụ index.html

// ================== Hàm đọc/ghi file ==================
function readData() {
  if (fs.existsSync(DATA_FILE)) {
    try {
      return JSON.parse(fs.readFileSync(DATA_FILE, "utf-8"));
    } catch (e) {
      return [];
    }
  }
  return [];
}

function writeData(data) {
  fs.writeFileSync(DATA_FILE, JSON.stringify(data, null, 2), "utf-8");
  updateGithubFile().catch((err) =>
    console.error("❌ Lỗi cập nhật GitHub:", err.message)
  );
}

// ================== API ==================

// Lấy toàn bộ email
app.get("/api/emails", (req, res) => {
  res.json(readData());
});

// Lấy 1 email theo ID
app.get("/api/emails/:id", (req, res) => {
  const emails = readData();
  const email = emails.find((e) => e.id === parseInt(req.params.id));
  if (!email) return res.status(404).json({ error: "Email không tồn tại" });
  res.json(email);
});

// Thêm email
app.post("/api/emails", (req, res) => {
  const emails = readData();
  const { email } = req.body;
  if (!email) return res.status(400).json({ error: "Thiếu email" });

  if (emails.some((e) => e.email === email))
    return res.status(400).json({ error: "Email đã tồn tại" });

  const newId = emails.length ? Math.max(...emails.map((e) => e.id)) + 1 : 1;
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");

  const newEmail = {
    id: newId,
    email,
    proxy: null,
    cookie: null,
    status: "pending",
    created_at: now,
    updated_at: now,
  };
  emails.push(newEmail);
  writeData(emails);

  res.status(201).json(newEmail);
});

// Import nhiều email
app.post("/api/emails/import", (req, res) => {
  const { emails: importList } = req.body;
  if (!Array.isArray(importList))
    return res.status(400).json({ error: "Dữ liệu không hợp lệ" });

  const emails = readData();
  const now = new Date().toISOString().slice(0, 19).replace("T", " ");
  const existing = new Set(emails.map((e) => e.email));
  let currentId = emails.length ? Math.max(...emails.map((e) => e.id)) + 1 : 1;

  const newEmails = [];
  for (const email of importList) {
    if (!email || existing.has(email)) continue;
    newEmails.push({
      id: currentId++,
      email,
      proxy: null,
      cookie: null,
      status: "pending",
      created_at: now,
      updated_at: now,
    });
    existing.add(email);
  }

  emails.push(...newEmails);
  writeData(emails);

  res.status(201).json(newEmails);
});

// Update trạng thái email theo ID
app.put("/api/emails/:id", (req, res) => {
  const { status } = req.body;
  const valid = ["pending", "processing", "completed", "failed"];
  if (!valid.includes(status))
    return res.status(400).json({ error: "Trạng thái không hợp lệ" });

  const emails = readData();
  const idx = emails.findIndex((e) => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Email không tồn tại" });

  emails[idx].status = status;
  emails[idx].updated_at = new Date()
    .toISOString()
    .slice(0, 19)
    .replace("T", " ");
  writeData(emails);

  res.json(emails[idx]);
});

// Xóa email theo ID
app.delete("/api/emails/:id", (req, res) => {
  let emails = readData();
  const idx = emails.findIndex((e) => e.id === parseInt(req.params.id));
  if (idx === -1) return res.status(404).json({ error: "Email không tồn tại" });
  const deleted = emails.splice(idx, 1)[0];
  writeData(emails);
  res.json(deleted);
});

// Xóa toàn bộ email
app.delete("/api/emails", (req, res) => {
  const count = readData().length;
  writeData([]);
  res.json({ deleted: count });
});

// Lấy 1 email pending và lock ngay
app.get("/api/emails/next", (req, res) => {
  const emails = readData();
  const idx = emails.findIndex(
    (e) => e.status === "pending" || e.status === "đang chờ"
  );
  if (idx === -1) return res.status(204).json("");
  emails[idx].status = "processing";
  emails[idx].updated_at = new Date().toISOString().slice(0, 19).replace("T", " ");
  writeData(emails);
  res.json(emails[idx].email);
});

// Cập nhật trạng thái theo email
app.post("/api/emails/status", (req, res) => {
  const { email, status } = req.body;
  if (!email || !status)
    return res.status(400).json({ error: "Thiếu email hoặc trạng thái" });

  const valid = ["pending", "processing", "completed", "failed"];
  if (!valid.includes(status))
    return res.status(400).json({ error: "Trạng thái không hợp lệ" });

  const emails = readData();
  const idx = emails.findIndex((e) => e.email === email);
  if (idx === -1) return res.status(404).json({ error: "Email không tồn tại" });

  emails[idx].status = status;
  emails[idx].updated_at = new Date().toISOString().slice(0, 19).replace("T", " ");
  writeData(emails);

  res.json(emails[idx]);
});

// ================== Hàm update GitHub ==================
async function updateGithubFile() {
  if (!fs.existsSync(FILEPATH)) return;
  const content = fs.readFileSync(FILEPATH, "utf-8");
  const b64Content = Buffer.from(content).toString("base64");

  const url = `https://api.github.com/repos/${USERNAME}/${REPO}/contents/${FILEPATH}`;
  const headers = { Authorization: `Bearer ${GITHUB_TOKEN}` };

  const { data: fileData } = await axios.get(url, { headers });
  const sha = fileData?.sha;

  const res = await axios.put(
    url,
    {
      message: "Update emails.json via API",
      content: b64Content,
      branch: BRANCH,
      sha,
    },
    { headers }
  );

  if (![200, 201].includes(res.status)) {
    throw new Error("Update GitHub failed: " + res.statusText);
  }

  console.log("✅ Cập nhật GitHub thành công!");
}

// ================== Self ping ==================
setInterval(() => {
  const url = process.env.PING_URL || `http://localhost:${PORT}`;
  axios
    .get(url)
    .then(() => console.log("Pinged:", url))
    .catch((err) => console.log("Ping error:", err.message));
}, 100000); // 5 phút

// ================== Start ==================
app.listen(PORT, () => console.log(`🚀 Server chạy tại http://localhost:${PORT}`));
