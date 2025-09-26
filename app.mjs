import express from "express";
import fs from "fs/promises";
import axios from "axios";
import cors from "cors";
import path from "path";
import { fileURLToPath } from "url";

const app = express();
const PORT = process.env.PORT || 10000;
const SELF_URL = "https://server-ebay-database.onrender.com/";

// Lấy đường dẫn tuyệt đối tới thư mục hiện tại (vì dùng ES Module)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

app.use(cors());
app.use(express.json());

// ⚡ Route trả về giao diện index.html trong thư mục hiện tại
app.get("/", (req, res) => {
  res.sendFile(path.join(__dirname, "index.html"));
});


// ======================= CONFIG =======================
const app = express();
const PORT = process.env.PORT || 10000;
const SELF_URL = "https://server-ebay-database.onrender.com/";

// --- GitHub Credentials (giữ nguyên như code gốc) ---
const GITHUB_TOKEN = "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";
const GITHUB_USER = "angadresmatomasante-spec";
const GITHUB_REPO = "RENDER";
const BRANCH = "main";

// URL Store
const URL_STORE_FILE = "urls.json";
const URL_EXPIRATION_MS = 5 * 60 * 1000; // 5 phút
let lastUrlIndex = -1;

// ======================= GITHUB API =======================
const githubApi = axios.create({
  baseURL: `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`,
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`, // ✅ chuẩn GitHub token
    Accept: "application/vnd.github.v3+json",
  },
});

/**
 * Commit nhiều file vào GitHub trong 1 lần commit
 * @param {Array<{path: string, content: string|null, encoding?: string}>} files - File muốn commit (content=null nghĩa là xoá)
 * @param {string} message - Commit message
 */
export const commitChanges = async (files, message) => {
  if (!files || files.length === 0) {
    console.log("⚠️ Không có file nào để commit.");
    return;
  }

  try {
    // 1. Lấy SHA commit mới nhất của branch
    const { data: refData } = await githubApi.get(`/git/ref/heads/${BRANCH}`);
    const parentCommitSha = refData.object.sha;

    // 2. Lấy tree SHA từ commit đó
    const { data: commitData } = await githubApi.get(`/git/commits/${parentCommitSha}`);
    const baseTreeSha = commitData.tree.sha;

    // 3. Tạo tree mới cho các file thay đổi
    const tree = await Promise.all(
      files.map(async (file) => {
        if (file.content === null) {
          // Xoá file
          return { path: file.path, sha: null };
        }

        // Tạo blob cho file mới/cập nhật
        const { data: blob } = await githubApi.post("/git/blobs", {
          content: file.content,
          encoding: file.encoding || "utf-8", // mặc định text, có thể truyền "base64"
        });

        return {
          path: file.path,
          mode: "100644",
          type: "blob",
          sha: blob.sha,
        };
      })
    );

    const { data: newTree } = await githubApi.post("/git/trees", {
      base_tree: baseTreeSha,
      tree: tree,
    });

    // 4. Tạo commit mới
    const { data: newCommit } = await githubApi.post("/git/commits", {
      message,
      tree: newTree.sha,
      parents: [parentCommitSha],
    });

    // 5. Cập nhật branch trỏ về commit mới
    await githubApi.patch(`/git/refs/heads/${BRANCH}`, {
      sha: newCommit.sha,
      force: false,
    });

    console.log(`✅ Commit thành công ${files.length} file: ${message}`);
  } catch (error) {
    console.error("❌ Commit thất bại:");
    if (error.response) {
      console.error("Status:", error.response.status);
      console.error("Data:", error.response.data);
    } else {
      console.error("Error:", error.message);
    }
  }
};

// ======================= URL STORE =======================
async function readUrlStore() {
  try {
    const data = await fs.readFile(URL_STORE_FILE, "utf-8");
    const urls = JSON.parse(data);

    // Lọc URL còn hạn
    const now = Date.now();
    return urls.filter((u) => u.expiresAt > now);
  } catch {
    return [];
  }
}

async function writeUrlStore(urls) {
  await fs.writeFile(URL_STORE_FILE, JSON.stringify(urls, null, 2), "utf-8");
}

// ======================= API ROUTES =======================

// --- "Hidden" API for URL Management --- //

// API để thêm URL mới với thời gian sống 5 phút
app.get("/add-url", async (req, res) => {
  const { url } = req.query;
  if (!url) {
    return res.status(400).json({ error: "URL parameter is required." });
  }

  try {
    const validUrls = await readUrlStore();
    const expiresAt = Date.now() + URL_EXPIRATION_MS;
    validUrls.push({ url, expiresAt });
    await writeUrlStore(validUrls);
    res.json({ message: "URL received and will be stored for 5 minutes." });
  } catch (error) {
    console.error("Error adding URL:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// API để lấy URL theo kiểu xoay vòng
app.get("/get-url", async (req, res) => {
  try {
    const validUrls = await readUrlStore();
    if (validUrls.length === 0) {
      return res.status(404).json({ error: "No valid URLs available." });
    }

    lastUrlIndex = (lastUrlIndex + 1) % validUrls.length;
    const urlToServe = validUrls[lastUrlIndex];
    res.json({ url: urlToServe.url });
  } catch (error) {
    console.error("Error getting URL:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// API để chuyển tiếp (redirect) đến URL xoay vòng
app.get("/go", async (req, res) => {
  try {
    const validUrls = await readUrlStore();
    if (validUrls.length === 0) {
      return res
        .status(404)
        .send("<h1>404 - Not Found</h1><p>No valid URLs are available to redirect to.</p>");
    }

    lastUrlIndex = (lastUrlIndex + 1) % validUrls.length;
    const urlToRedirect = validUrls[lastUrlIndex].url;

    res.redirect(302, urlToRedirect);
  } catch (error) {
    console.error("Error redirecting to URL:", error);
    res.status(500).send("<h1>500 - Internal Server Error</h1>");
  }
});

// API để lấy số lượng URL hợp lệ
app.get("/api/urls/count", async (req, res) => {
  try {
    const validUrls = await readUrlStore();
    res.json({ count: validUrls.length });
  } catch (error) {
    console.error("Error getting URL count:", error);
    res.status(500).json({ error: "Internal server error." });
  }
});

// ======================= AUTO PING =======================
async function selfPing() {
  try {
    const res = await axios.get(SELF_URL);
    console.log("✅ Pinged:", SELF_URL, "Status:", res.status);
  } catch (err) {
    console.error("❌ Ping failed:", err.message);
  }
}

setInterval(selfPing, 1 * 60 * 1000); // Ping mỗi 4 phút



app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  selfPing(); // Ping ngay khi khởi động
});
