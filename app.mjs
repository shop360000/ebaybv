import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { commitChanges } from './git-helper.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT = process.env.PORT || 10000;
const DATA_DIR = path.join(__dirname, 'data');
const URL_STORE_FILE = path.join(__dirname, 'urls.json');
const URL_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes
const SELF_URL="https://server-ebay-database.onrender.com";
let lastUrlIndex = -1; // Biến toàn cục để theo dõi URL xoay vòng

// --- Initialization: Ensure data directory exists ---
(async () => {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log(`Data directory '${DATA_DIR}' is ready.`);
    } catch (error) {
        console.error('Error creating data directory:', error);
        process.exit(1);
    }
})();


app.use(cors());
app.use(express.json());
app.use(express.static(__dirname));

// --- Helper Functions for Email Data ---
const readData = async () => {
    try {
        const files = await fs.readdir(DATA_DIR);
        const jsonFiles = files.filter(file => file.endsWith('.json'));
        const emails = await Promise.all(
            jsonFiles.map(async (file) => {
                const filePath = path.join(DATA_DIR, file);
                const data = await fs.readFile(filePath, 'utf-8');
                return JSON.parse(data);
            })
        );
        return emails;
    } catch (error) {
        console.error("Could not read data directory:", error);
        return [];
    }
};

const writeEmailFile = async (emailData) => {
    const filePath = path.join(DATA_DIR, `${emailData.id}.json`);
    await fs.writeFile(filePath, JSON.stringify(emailData, null, 2), 'utf-8');
};

const deleteEmailFile = async (id) => {
    const filePath = path.join(DATA_DIR, `${id}.json`);
    try {
        await fs.unlink(filePath);
    } catch (error) {
        if (error.code !== 'ENOENT') {
            console.error(`Error deleting file ${filePath}:`, error);
        }
    }
};

// --- Helper Functions for URL Store ---
const readUrlStore = async () => {
    try {
        const data = await fs.readFile(URL_STORE_FILE, 'utf-8');
        const urls = JSON.parse(data);
        // Lọc ra các URL đã hết hạn
        const now = Date.now();
        return urls.filter(item => item.expiresAt > now);
    } catch (error) {
        if (error.code === 'ENOENT') return []; // File không tồn tại, trả về mảng rỗng
        console.error("Could not read URL store:", error);
        return [];
    }
};

const writeUrlStore = async (urls) => {
    await fs.writeFile(URL_STORE_FILE, JSON.stringify(urls, null, 2), 'utf-8');
};


// --- "Hidden" API for URL Management ---

// API để thêm URL mới với thời gian sống 5 phút
app.get('/add-url', async (req, res) => {
    const { url } = req.query;
    if (!url) {
        return res.status(400).json({ error: 'URL parameter is required.' });
    }

    try {
        // Đọc, lọc các URL cũ và thêm URL mới
        const validUrls = await readUrlStore();
        const expiresAt = Date.now() + URL_EXPIRATION_MS;
        
        validUrls.push({ url, expiresAt });
        
        await writeUrlStore(validUrls);
        
        res.json({ message: 'URL received and will be stored for 5 minutes.' });
    } catch (error) {
        console.error('Error adding URL:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// API để lấy URL theo kiểu xoay vòng
app.get('/get-url', async (req, res) => {
    try {
        const validUrls = await readUrlStore();

        if (validUrls.length === 0) {
            return res.status(404).json({ error: 'No valid URLs available.' });
        }

        // Logic xoay vòng
        lastUrlIndex = (lastUrlIndex + 1) % validUrls.length;
        const urlToServe = validUrls[lastUrlIndex];

        res.json({ url: urlToServe.url });
    } catch (error) {
        console.error('Error getting URL:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// API để chuyển tiếp (redirect) đến URL xoay vòng
app.get('/go', async (req, res) => {
    try {
        const validUrls = await readUrlStore();

        if (validUrls.length === 0) {
            return res.status(404).send('<h1>404 - Not Found</h1><p>No valid URLs are available to redirect to.</p>');
        }

        // Logic xoay vòng
        lastUrlIndex = (lastUrlIndex + 1) % validUrls.length;
        const urlToRedirect = validUrls[lastUrlIndex].url;

        // Chuyển tiếp người dùng đến URL
        res.redirect(302, urlToRedirect);
    } catch (error) {
        console.error('Error redirecting to URL:', error);
        res.status(500).send('<h1>500 - Internal Server Error</h1>');
    }
});

// API để lấy số lượng URL hợp lệ
app.get('/api/urls/count', async (req, res) => {
    try {
        const validUrls = await readUrlStore();
        res.json({ count: validUrls.length });
    } catch (error) {
        console.error('Error getting URL count:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});

// API để lấy số lượng URL hợp lệ
app.get('/api/urls/count', async (req, res) => {
    try {
        const validUrls = await readUrlStore();
        res.json({ count: validUrls.length });
    } catch (error) {
        console.error('Error getting URL count:', error);
        res.status(500).json({ error: 'Internal server error.' });
    }
});




// --- API Routes for Emails (Unchanged) ---

app.get('/api/emails', async (req, res) => {
    const emails = await readData();
    res.json(emails);
});

app.post('/api/emails', async (req, res) => {
    const { email } = req.body;
    if (!email) {
        return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }

    const emails = await readData();
    if (emails.some(e => e.email === email)) {
        return res.status(400).json({ error: 'Email đã tồn tại' });
    }

    const newId = emails.length > 0 ? Math.max(...emails.map(e => e.id)) + 1 : 1;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const newEmail = {
        id: newId,
        email,
        proxy: null,
        cookie: null,
        status: 'pending',
        created_at: now,
        updated_at: now,
    };

    const newEmailContent = JSON.stringify(newEmail, null, 2);
    await writeEmailFile(newEmail);
    res.status(201).json(newEmail);

    // Git push in background
    commitChanges(
        [{ path: `data/${newEmail.id}.json`, content: newEmailContent }],
        `feat: Add email ${email}`
    );
});

app.post('/api/emails/import', async (req, res) => {
    const { emails: newEmailsList } = req.body;
    if (!newEmailsList || !Array.isArray(newEmailsList)) {
        return res.status(400).json({ error: 'Dữ liệu không hợp lệ' });
    }

    const emails = await readData();
    const existingEmails = new Set(emails.map(e => e.email));
    let currentId = emails.length > 0 ? Math.max(...emails.map(e => e.id)) + 1 : 1;
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');

    const imported = [];
    for (const emailAddress of newEmailsList) {
        if (emailAddress && !existingEmails.has(emailAddress)) {
            const newEmail = {
                id: currentId++,
                email: emailAddress,
                proxy: null,
                cookie: null,
                status: 'pending',
                created_at: now,
                updated_at: now,
            };
            imported.push(newEmail);
            existingEmails.add(emailAddress);
        }
    }
    
    if (imported.length > 0) {
        const filesToCommit = imported.map(e => ({
            path: `data/${e.id}.json`,
            content: JSON.stringify(e, null, 2)
        }));
        await Promise.all(imported.map(e => writeEmailFile(e)));
        res.status(201).json(imported);
        commitChanges(filesToCommit, `feat: Import ${imported.length} new emails`);
    } else {
        res.status(200).json([]);
    }
});


app.put('/api/emails/:id', async (req, res) => {
    const { status } = req.body;
    const emailId = parseInt(req.params.id);
    const validStatuses = ['pending', 'processing', 'completed', 'failed'];
    if (!status || !validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }

    const emails = await readData();
    const emailToUpdate = emails.find(e => e.id === emailId);

    if (!emailToUpdate) {
        return res.status(404).json({ error: 'Email không tồn tại' });
    }

    emailToUpdate.status = status;
    emailToUpdate.updated_at = new Date().toISOString().slice(0, 19).replace('T', ' ');
    
    const updatedContent = JSON.stringify(emailToUpdate, null, 2);
    await writeEmailFile(emailToUpdate);
    res.json(emailToUpdate);

    commitChanges(
        [{ path: `data/${emailToUpdate.id}.json`, content: updatedContent }],
        `fix: Update status for email ID ${emailId} to ${status}`
    );
});

app.delete('/api/emails/:id', async (req, res) => {
    const emailId = parseInt(req.params.id);
    const emails = await readData();
    const emailExists = emails.some(e => e.id === emailId);

    if (!emailExists) {
        return res.status(404).json({ error: 'Email không tồn tại' });
    }
    
    await deleteEmailFile(emailId);
    res.json({ id: emailId, message: "Deleted successfully" });

    // To delete a file via the API, we commit a change where the file path exists but the content is null.
    // The helper needs to be adapted to handle this. For now, let's represent deletion by path.
    // NOTE: The current helper creates blobs. Deleting requires a different tree structure.
    // A simpler way for now is to just push an empty commit message, though not ideal.
    // Let's adapt the helper to handle deletions.

    // Re-reading helper... okay, the tree API needs `sha: null` for deletion. Let's adjust the helper and this call.
    commitChanges(
        [{ path: `data/${emailId}.json`, content: null }], // content: null signifies deletion
        `refactor: Delete email ID ${emailId}`
    );
});

if (SELF_URL)
  setInterval(async () => {
    try {
      await axios.get(`${SELF_URL}/`);
    } catch (e) {
      console.error(e.message);
    }
  }, 1 * 60 * 1000);

app.delete('/api/emails', async (req, res) => {
    const emails = await readData();
    if (emails.length > 0) {
        const filesToDelete = emails.map(e => ({ path: `data/${e.id}.json`, content: null }));
        await Promise.all(emails.map(e => deleteEmailFile(e.id)));
        res.json({ deleted: emails.length });
        commitChanges(filesToDelete, 'refactor: Delete all emails');
    } else {
        res.json({ deleted: 0 });
    }
});

app.get('/api/emails/next', async (req, res) => {
    const emails = await readData();
    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const emailToProcess = emails.find(e => e.status === 'pending' || e.status === 'đang chờ');

    if (emailToProcess) {
        emailToProcess.status = 'processing';
        emailToProcess.status_en = 'processing';
        emailToProcess.updated_at = now;
        const updatedContent = JSON.stringify(emailToProcess, null, 2);
        await writeEmailFile(emailToProcess);
        res.json(emailToProcess.email);
        commitChanges(
            [{ path: `data/${emailToProcess.id}.json`, content: updatedContent }],
            `chore: Set next email to processing for ID ${emailToProcess.id}`
        );
    } else {
        res.status(204).send();
    }
});

app.post('/api/emails/status', async (req, res) => {
    const { email, status } = req.body;
    if (!email || !status) {
        return res.status(400).json({ error: 'Thiếu email hoặc trạng thái' });
    }

    const validStatuses = ['pending', 'processing', 'completed', 'failed', 'đang chờ', 'đang xử lý', 'hoàn thành', 'thất bại'];
    if (!validStatuses.includes(status)) {
        return res.status(400).json({ error: 'Trạng thái không hợp lệ' });
    }

    const emails = await readData();
    const emailToUpdate = emails.find(e => e.email === email);

    if (!emailToUpdate) {
        return res.status(404).json({ error: 'Email không tồn tại' });
    }

    const now = new Date().toISOString().slice(0, 19).replace('T', ' ');
    const status_en = ['pending', 'processing', 'completed', 'failed'].includes(status) ? status : translateStatus(status, false);
    const status_vi = ['đang chờ', 'đang xử lý', 'hoàn thành', 'thất bại'].includes(status) ? status : translateStatus(status, true);

    emailToUpdate.status = status_en;
    emailToUpdate.status_vi = status_vi;
    emailToUpdate.updated_at = now;

    const updatedContent = JSON.stringify(emailToUpdate, null, 2);
    await writeEmailFile(emailToUpdate);

    const result = { ...emailToUpdate, status: status_vi };
    res.json(result);
    commitChanges(
        [{ path: `data/${emailToUpdate.id}.json`, content: updatedContent }],
        `fix: Update status for ${email} to ${status}`
    );
});


function translateStatus(status, to_vi = true) {
    const statusMap = {
        'pending': 'đang chờ',
        'processing': 'đang xử lý',
        'completed': 'hoàn thành',
        'failed': 'thất bại',
        'đang chờ': 'pending',
        'đang xử lý': 'processing',
        'hoàn thành': 'completed',
        'thất bại': 'failed'
    };
    return statusMap[status] || status;
}

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
