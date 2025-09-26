import axios from 'axios';

// Hardcoded credentials from the original Python script
const GITHUB_TOKEN = "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";
const GITHUB_USER = "angadresmatomasante-spec";
const GITHUB_REPO = "RENDER";
const BRANCH = "main";

// Khởi tạo axios instance
const api = axios.create({
  baseURL: `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`,
  headers: {
    Authorization: `Bearer ${GITHUB_TOKEN}`, // ✅ Dùng Bearer thay vì token
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
    const { data: refData } = await api.get(`/git/ref/heads/${BRANCH}`);
    const parentCommitSha = refData.object.sha;

    // 2. Lấy tree SHA từ commit đó
    const { data: commitData } = await api.get(`/git/commits/${parentCommitSha}`);
    const baseTreeSha = commitData.tree.sha;

    // 3. Tạo tree mới cho các file thay đổi
    const tree = await Promise.all(
      files.map(async (file) => {
        if (file.content === null) {
          // Xoá file
          return { path: file.path, sha: null };
        }

        // Tạo blob cho file mới/cập nhật
        const { data: blob } = await api.post("/git/blobs", {
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

    const { data: newTree } = await api.post("/git/trees", {
      base_tree: baseTreeSha,
      tree: tree,
    });

    // 4. Tạo commit mới
    const { data: newCommit } = await api.post("/git/commits", {
      message,
      tree: newTree.sha,
      parents: [parentCommitSha],
    });

    // 5. Cập nhật branch trỏ về commit mới
    await api.patch(`/git/refs/heads/${BRANCH}`, {
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
