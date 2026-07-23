const express = require('express');
const cors = require('cors');
const fs = require('fs');
const path = require('path');

const app = express();
app.use(cors());
// Direct raw upload to bypass multer
app.post('/api/upload', express.raw({ type: '*/*', limit: '1gb' }), async (req, res) => {
    if (!req.body || req.body.length === 0) return res.status(400).json({ error: 'No file' });
    const id = Date.now() + Math.random().toString(36).substring(2, 6);
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const filePath = path.join(os.tmpdir(), id);
    fs.writeFileSync(filePath, req.body);
    const name = encodeURIComponent(req.query.name || 'audio.mp3');
    
    try {
        const mm = await import('music-metadata');
        const metadata = await mm.parseFile(filePath);
        const duration = metadata.format.duration || 0;
        const title = metadata.common.title;
        const artist = metadata.common.artist;
        
        if (duration < 480 && (!title || !artist)) {
            console.log('Missing metadata and duration < 8m, running Shazam...');
            const { exec } = require('child_process');
            await new Promise((resolve) => {
                exec(`python shazam_bridge.py "${filePath}"`, { cwd: __dirname }, (err, stdout) => {
                    if (!err && stdout) {
                        try {
                            const result = JSON.parse(stdout.trim());
                            if (result.title) {
                                console.log('Shazam found:', result.title, '-', result.artist);
                                const nodeid3 = require('node-id3');
                                const tags = {
                                    title: result.title,
                                    artist: result.artist || ''
                                };
                                nodeid3.update(tags, filePath);
                            }
                        } catch(e) {}
                    }
                    resolve();
                });
            });
        }
    } catch(e) {
        console.error('Metadata/Shazam error:', e.message);
    }
    
    res.json({ url: req.protocol + '://' + req.get('host') + '/api/download/' + id + '/' + name });
});

app.get('/api/download/:id/:name', (req, res) => {
    const fs = require('fs');
    const os = require('os');
    const path = require('path');
    const filePath = path.join(os.tmpdir(), req.params.id);
    if (fs.existsSync(filePath)) {
        res.download(filePath, req.params.name);
    } else {
        res.status(404).send('File not found or expired.');
    }
});


app.use(express.json());
app.use(express.static(__dirname));
app.use('/Metadata', express.static(path.join(__dirname, 'Metadata')));

const EXEC_PIN = '19731975';
const DB_FILE = path.join(__dirname, 'database.json');

// ---- Pure-JS JSON "database" ----
function loadDB() {
    if (!fs.existsSync(DB_FILE)) {
        const initial = {
            config: { global_url: 'https://releases-offering-tone-stage.trycloudflare.com' },
            users: {},
            bot_codes: {}
        };
        fs.writeFileSync(DB_FILE, JSON.stringify(initial, null, 2));
        return initial;
    }
    return JSON.parse(fs.readFileSync(DB_FILE, 'utf8'));
}

function saveDB(data) {
    fs.writeFileSync(DB_FILE, JSON.stringify(data, null, 2));
}

console.log('Server started. Using JSON database at', DB_FILE);

// ==========================================
// API ROUTES
// ==========================================

// --- Global Config ---
app.get('/api/config', (req, res) => {
    const db = loadDB();
    res.json({ global_url: db.config.global_url || '' });
});

app.post('/api/config/global-url', (req, res) => {
    const { pin, url } = req.body;
    if (pin !== EXEC_PIN) return res.status(403).json({ error: 'Invalid Executive PIN' });
    if (!url) return res.status(400).json({ error: 'URL is required' });
    const db = loadDB();
    db.config.global_url = url;
    saveDB(db);
    res.json({ status: 'success', global_url: url });
});

// --- Bot Integration ---
app.post('/api/bot/code', (req, res) => {
    const { discordId, code } = req.body;
    if (!discordId || !code) return res.status(400).json({ error: 'Missing discordId or code' });
    const db = loadDB();
    db.bot_codes[code] = { discord_id: discordId, created_at: Date.now() };
    saveDB(db);
    console.log(`Bot code stored: ${code} for Discord ID ${discordId}`);
    res.json({ status: 'success' });
});

// --- User Auth & Sync ---


// Register
app.post('/api/auth/register', (req, res) => {
    const { username, password, botCode, birthday } = req.body;
    if (!username || !password || !botCode) return res.status(400).json({ error: 'Missing fields' });

    const db = loadDB();

    const codeEntry = db.bot_codes[botCode];
    if (!codeEntry) return res.status(400).json({ error: 'Invalid Bot Code! Generate one using !getcode in Discord.' });
    if (Date.now() - codeEntry.created_at > 15 * 60 * 1000) {
        delete db.bot_codes[botCode];
        saveDB(db);
        return res.status(400).json({ error: 'Bot Code expired. Please generate a new one.' });
    }
    if (db.users[username]) return res.status(400).json({ error: 'Username already exists' });

    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    const initialSettings = birthday ? JSON.stringify({ birthday }) : '{}';

    db.users[username] = { password, bot_code: botCode, token, settings: initialSettings };
    delete db.bot_codes[botCode];
    saveDB(db);

    res.json({ status: 'success', token, username });
});

// Login
app.post('/api/auth/login', (req, res) => {
    const { username, password } = req.body;
    if (!username || !password) return res.status(400).json({ error: 'Missing fields' });

    const db = loadDB();
    const user = db.users[username];
    if (!user || user.password !== password) return res.status(401).json({ error: 'Invalid credentials' });

    const token = Math.random().toString(36).substring(2) + Date.now().toString(36);
    user.token = token;
    saveDB(db);

    res.json({ status: 'success', token, username, settings: user.settings });
});

// Sync Settings (Push)
app.post('/api/user/sync', (req, res) => {
    const { username, token, settings } = req.body;
    if (!username || !token || !settings) return res.status(400).json({ error: 'Missing fields' });

    const db = loadDB();
    const user = db.users[username];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.token !== token) return res.status(403).json({ error: 'Invalid token' });

    user.settings = JSON.stringify(settings);
    saveDB(db);
    res.json({ status: 'success' });
});

app.post('/api/user/data', (req, res) => {
    const { username, token, settings } = req.body;
    if (!username || !token || !settings) return res.status(400).json({ error: 'Missing fields' });

    const db = loadDB();
    const user = db.users[username];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.token !== token) return res.status(403).json({ error: 'Invalid token' });

    user.settings = JSON.stringify(settings);
    saveDB(db);
    res.json({ status: 'success' });
});

// Get Settings (Pull)
app.get('/api/user/sync/:username', (req, res) => {
    const { username } = req.params;
    const authHeader = req.headers.authorization;
    if (!authHeader) return res.status(401).json({ error: 'Missing token' });
    const token = authHeader.replace('Bearer ', '');

    const db = loadDB();
    const user = db.users[username];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.token !== token) return res.status(403).json({ error: 'Invalid token' });

    res.json({ status: 'success', settings: user.settings });
});

app.get('/api/user/data', (req, res) => {
    const username = req.query.username;
    const authHeader = req.headers.authorization;
    if (!username || !authHeader) return res.status(400).json({ error: 'Missing username or token' });
    const token = authHeader.replace('Bearer ', '');

    const db = loadDB();
    const user = db.users[username];
    if (!user) return res.status(401).json({ error: 'User not found' });
    if (user.token !== token) return res.status(403).json({ error: 'Invalid token' });

    res.json({ status: 'success', settings: user.settings });
});

// SPA fallback
app.get('*', (req, res) => {
    res.sendFile(path.join(__dirname, 'index.html'));
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
