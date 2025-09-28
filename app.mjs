import express from 'express';
import cors from 'cors';
import { promises as fs } from 'fs';
import path, { dirname } from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import multer from 'multer';
import https from 'https';
import pingRouter from './ping.js';   // ✅ import module ping

// --- Khởi tạo Express app ---
const app = express();

// --- Middleware ---
app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(dirname(fileURLToPath(import.meta.url))));

// --- Biến môi trường & __dirname ---
const PORT = process.env.PORT || 10000;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

// --- API routes ---
app.use("/api/ping", pingRouter);

// Giao diện ping.html
app.get("/ping", (req, res) => {
  res.sendFile(path.join(__dirname, "ping.html"));
});

// Thư mục data
const DATA_DIR = path.join(__dirname, 'data');
const URL_STORE_FILE = path.join(DATA_DIR, 'urls.json');

// Đảm bảo thư mục data tồn tại
(async () => {
    try {
        await fs.mkdir(DATA_DIR, { recursive: true });
        console.log(`Data directory '${DATA_DIR}' is ready.`);
    } catch (error) {
        console.error('Error creating data directory:', error);
        process.exit(1);
    }
})();

// --- Database config ---
const { Pool } = pg;
const pool = new Pool({
    user: 'db_ghip_user',
    host: 'dpg-d3b3novfte5s739ejob0-a.oregon-postgres.render.com',
    database: 'db_ghip',
    password: 'CuHnDo1hIo0RmtxDX28CbWs4sKX2lgQa',
    port: 5432,
    ssl: { rejectUnauthorized: false }
});

// Test kết nối database
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Error connecting to the database:', err);
    } else {
        console.log('Successfully connected to the database at', res.rows[0].now);
    }
});


// Khởi động server
app.listen(PORT, () => {
  console.log(`Server is running on http://localhost:${PORT}`);
});

// Test the database connection
pool.query('SELECT NOW()', (err, res) => {
    if (err) {
        console.error('Error connecting to the database:', err);
    } else {
        console.log('Successfully connected to the database at', res.rows[0].now);
    }
});

// Create tables if they don't exist
const initDB = async () => {
    try {
        await pool.query(`
            CREATE TABLE IF NOT EXISTS emails (
                id SERIAL PRIMARY KEY,
                email VARCHAR(255) NOT NULL,
                status VARCHAR(50) DEFAULT 'pending',
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
                updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
            
            CREATE TABLE IF NOT EXISTS urls (
                id SERIAL PRIMARY KEY,
                url TEXT NOT NULL,
                expires_at BIGINT NOT NULL,
                created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
            );
        `);
        console.log('Database tables initialized');
    } catch (error) {
        console.error('Error initializing database:', error);
    }
};

initDB();

/**
 * Saves changes to the database
 * @param {Array<{path: string, content: string}>} files - Array of file objects to save.
 * @param {string} message - The operation message (for logging).
 */
const saveChanges = async (files, message) => {
    if (!files || files.length === 0) {
        console.log("No changes to save.");
        return;
    }

    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        for (const file of files) {
            if (file.content === null) {
                // This is a delete operation
                const id = path.basename(file.path, '.json');
                await client.query('DELETE FROM emails WHERE id = $1', [id]);
            } else {
                // This is an insert/update operation
                const emailData = JSON.parse(file.content);
                const { id, email, status = 'pending' } = emailData;
                
                await client.query(
                    'INSERT INTO emails (id, email, status) VALUES ($1, $2, $3) ' +
                    'ON CONFLICT (id) DO UPDATE SET email = $2, status = $3, updated_at = CURRENT_TIMESTAMP',
                    [id, email, status]
                );
            }
        }
        
        await client.query('COMMIT');
        console.log(`Successfully saved changes: ${message}`);
    } catch (error) {
        await client.query('ROLLBACK');
        console.error('Error saving changes to database:', error.message);
        throw error;
    } finally {
        client.release();
    }
};

const URL_EXPIRATION_MS = 5 * 60 * 1000; // 5 minutes

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
// Tăng giới hạn kích thước request
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));
app.use(express.static(__dirname));

// Cấu hình multer cho việc upload file
const upload = multer({ dest: 'uploads/' });

// --- Helper Functions for Email Data ---
const readData = async () => {
    try {
        const result = await pool.query('SELECT * FROM emails ORDER BY created_at DESC');
        return result.rows.map(row => ({
            id: row.id.toString(),
            email: row.email,
            status: row.status,
            created_at: row.created_at,
            updated_at: row.updated_at
        }));
    } catch (error) {
        console.error("Error reading emails from database:", error);
        return [];
    }
};

const writeEmailFile = async (emailData) => {
    try {
        const { id, email, status = 'pending' } = emailData;
        await pool.query(
            'INSERT INTO emails (id, email, status) VALUES ($1, $2, $3) ON CONFLICT (id) DO UPDATE SET email = $2, status = $3, updated_at = CURRENT_TIMESTAMP',
            [id, email, status]
        );
    } catch (error) {
        console.error("Error saving email to database:", error);
        throw error;
    }
};

const deleteEmailFile = async (id) => {
    try {
        await pool.query('DELETE FROM emails WHERE id = $1', [id]);
    } catch (error) {
        console.error(`Error deleting email with id ${id}:`, error);
        throw error;
    }
};

// --- Helper Functions for URL Store ---
const readUrlStore = async () => {
    try {
        const now = Date.now();
        // Delete expired URLs
        await pool.query('DELETE FROM urls WHERE expires_at <= $1', [now]);
        
        // Return remaining URLs
        const result = await pool.query('SELECT * FROM urls ORDER BY created_at DESC');
        return result.rows.map(row => ({
            id: row.id,
            url: row.url,
            expiresAt: parseInt(row.expires_at, 10)
        }));
    } catch (error) {
        console.error("Error reading URL store from database:", error);
        return [];
    }
};

const writeUrlStore = async (urls) => {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        
        // Clear existing URLs
        await client.query('TRUNCATE TABLE urls');
        
        // Insert new URLs
        for (const url of urls) {
            await client.query(
                'INSERT INTO urls (url, expires_at) VALUES ($1, $2)',
                [url.url, url.expiresAt]
            );
        }
        
        await client.query('COMMIT');
    } catch (error) {
        await client.query('ROLLBACK');
        console.error("Error writing URL store to database:", error);
        throw error;
    } finally {
        client.release();
    }
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

    // Save to database
    await saveChanges(
        [{ path: `data/${newEmail.id}.json`, content: newEmailContent }],
        `Add email ${email}`
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
        await saveChanges(filesToCommit, `Import ${imported.length} new emails`);
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
    await saveChanges(
        [{ path: `data/${emailToUpdate.id}.json`, content: updatedContent }],
        `Update status for email ID ${emailId} to ${status}`
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
    // Delete the email from the database
    await saveChanges(
        [{ path: `data/${emailId}.json`, content: null }],
        `Delete email ID ${emailId}`
    );
});

app.delete('/api/emails', async (req, res) => {
    const emails = await readData();
    if (emails.length > 0) {
        const filesToDelete = emails.map(e => ({ path: `data/${e.id}.json`, content: null }));
        await Promise.all(emails.map(e => deleteEmailFile(e.id)));
        res.json({ deleted: emails.length });
        await saveChanges(filesToDelete, 'Delete all emails');
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
        await saveChanges(
            [{ path: `data/${emailToProcess.id}.json`, content: updatedContent }],
            `Set next email to processing for ID ${emailToProcess.id}`
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
    await saveChanges(
        [{ path: `data/${emailToUpdate.id}.json`, content: updatedContent }],
        `Update status for ${email} to ${status}`
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

// Endpoint để upload file .txt chứa danh sách email
app.post('/upload-emails', upload.single('emailFile'), async (req, res) => {
    try {
        if (!req.file) {
            return res.status(400).json({ success: false, message: 'Không có file được tải lên' });
        }

        // Đọc nội dung file
        const fileContent = await fs.readFile(req.file.path, 'utf-8');
        // Xóa file tạm sau khi đọc xong
        await fs.unlink(req.file.path);

        // Tách các email từ nội dung file (mỗi dòng là một email)
        const emails = fileContent
            .split('\n')
            .map(email => email.trim())
            .filter(email => {
                // Kiểm tra định dạng email đơn giản
                const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
                return email && emailRegex.test(email);
            });

        if (emails.length === 0) {
            return res.status(400).json({ 
                success: false, 
                message: 'Không tìm thấy email hợp lệ trong file' 
            });
        }

        // Lưu từng email vào file riêng biệt trong thư mục data
        const savedEmails = [];
        for (const email of emails) {
            const emailData = {
                id: Date.now() + Math.random().toString(36).substr(2, 9),
                email: email,
                status: 'pending',
                createdAt: new Date().toISOString()
            };
            
            const fileName = `${emailData.id}.json`;
            const filePath = path.join(DATA_DIR, fileName);
            await fs.writeFile(filePath, JSON.stringify(emailData, null, 2), 'utf-8');
            savedEmails.push(emailData);
            
            // Save the new email to database
            try {
                const fileContent = await fs.readFile(filePath, 'utf-8');
                await saveChanges(
                    [{
                        path: `data/${fileName}`,
                        content: fileContent
                    }],
                    `Add new email: ${emailData.email}`
                );
                console.log(`Successfully committed email: ${emailData.email}`);
            } catch (gitError) {
                console.error('Failed to commit to GitHub:', gitError.message);
                // Continue with the next email even if GitHub commit fails
            }
        }

        res.json({ 
            success: true, 
            message: `Đã thêm thành công ${savedEmails.length} email`, 
            data: savedEmails 
        });

    } catch (error) {
        console.error('Lỗi khi xử lý file email:', error);
        res.status(500).json({ 
            success: false, 
            message: 'Đã xảy ra lỗi khi xử lý file',
            error: error.message 
        });
    }
});

app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on http://localhost:${PORT}`);
});
