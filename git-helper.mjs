import axios from 'axios';

// Hardcoded credentials from the original Python script
const GITHUB_TOKEN = "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";
const GITHUB_USER = "angadresmatomasante-spec";
const GITHUB_REPO = "RENDER";
const BRANCH = "main";

const api = axios.create({
    baseURL: `https://api.github.com/repos/${GITHUB_USER}/${GITHUB_REPO}`,
    headers: {
        Authorization: `token ${GITHUB_TOKEN}`,
        Accept: 'application/vnd.github.v3+json',
    },
});

/**
 * Commits multiple file changes to the GitHub repository in a single commit.
 * @param {Array<{path: string, content: string}>} files - Array of file objects to commit.
 * @param {string} message - The commit message.
 */
export const commitChanges = async (files, message) => {
    if (!files || files.length === 0) {
        console.log("No file changes to commit.");
        return;
    }

    try {
        // 1. Get the latest commit SHA of the branch
        const { data: refData } = await api.get(`/git/ref/heads/${BRANCH}`);
        const parentCommitSha = refData.object.sha;

        // 2. Get the tree SHA of that commit
        const { data: commitData } = await api.get(`/git/commits/${parentCommitSha}`);
        const baseTreeSha = commitData.tree.sha;

        // 4. Create a new tree with the file blobs
        const tree = await Promise.all(files.map(async (file) => {
            if (file.content === null) {
                // This signifies a file deletion
                return {
                    path: file.path,
                    mode: '100644',
                    type: 'blob',
                    sha: null, // Setting sha to null deletes the file
                };
            }
            // Create a blob for new/updated content
            const { data: blob } = await api.post('/git/blobs', {
                content: Buffer.from(file.content).toString('base64'),
                encoding: 'base64',
            });
            return {
                path: file.path,
                mode: '100644',
                type: 'blob',
                sha: blob.sha,
            };
        }));

        const { data: newTree } = await api.post('/git/trees', {
            base_tree: baseTreeSha,
            tree: tree,
        });

        // 5. Create a new commit
        const { data: newCommit } = await api.post('/git/commits', {
            message,
            tree: newTree.sha,
            parents: [parentCommitSha],
        });

        // 6. Update the branch reference to point to the new commit
        await api.patch(`/git/refs/heads/${BRANCH}`, {
            sha: newCommit.sha,
        });

        console.log(`Successfully committed ${files.length} files: ${message}`);

    } catch (error) {
        console.error('Failed to commit to GitHub via API:', error.response ? error.response.data : error.message);
    }
};
