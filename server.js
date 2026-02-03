const express = require('express');
const fs = require('fs');
const { exec } = require('child_process');
const ical = require('node-ical');
const axios = require('axios');
const cron = require('node-cron');
const app = express();
const PORT = 3000;

app.use(express.json());
app.use(express.static('public'));
app.use(express.static('.')); // Keep this for other files if needed, but public takes precedence

const DATA_FILE = './stickers.json';
const CONFIG_FILE = './config.json';
const EXTERNAL_EVENTS_FILE = './external_events.json';
const SHOPPING_FILE = './shopping.json';
const MEALS_FILE = './meals.json';
const TASKS_FILE = './tasks.json';
const MEMBERS_FILE = './members.json';
const NOTES_FILE = './notes.json';

// CONFIGURATION GÉNÉRALE PAR DÉFAUT
const DEFAULT_CONFIG = {
    calendarUrls: [],
    photos: [
        'https://images.unsplash.com/photo-1511895426328-dc8714191300?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1492684223066-81342ee5ff30?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1506744038136-46273834b3fb?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1464822759023-fed622ff2c3b?auto=format&fit=crop&w=1200&q=80',
        'https://images.unsplash.com/photo-1501785888041-af3ef285b470?auto=format&fit=crop&w=1200&q=80'
    ],
    city: "Lavaltrie",
    lat: 45.88,
    lon: -73.28,
    wasteBlueStart: "2026-01-06",
    wasteGreenStart: "2026-01-09",
    wasteBlackStart: "2026-01-12"
};

if (!fs.existsSync(DATA_FILE)) fs.writeFileSync(DATA_FILE, JSON.stringify({}));

// Initialisation du fichier config avec les valeurs par défaut si manquantes
if (fs.existsSync(CONFIG_FILE)) {
    const current = JSON.parse(fs.readFileSync(CONFIG_FILE));
    const merged = { ...DEFAULT_CONFIG, ...current };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(merged));
} else {
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(DEFAULT_CONFIG));
}

if (!fs.existsSync(EXTERNAL_EVENTS_FILE)) fs.writeFileSync(EXTERNAL_EVENTS_FILE, JSON.stringify({}));
if (!fs.existsSync(SHOPPING_FILE)) fs.writeFileSync(SHOPPING_FILE, JSON.stringify([]));
if (!fs.existsSync(MEALS_FILE)) fs.writeFileSync(MEALS_FILE, JSON.stringify({}));
if (!fs.existsSync(TASKS_FILE)) fs.writeFileSync(TASKS_FILE, JSON.stringify([]));
if (!fs.existsSync(MEMBERS_FILE)) fs.writeFileSync(MEMBERS_FILE, JSON.stringify([]));
if (!fs.existsSync(NOTES_FILE)) fs.writeFileSync(NOTES_FILE, JSON.stringify({ text: "" }));

async function syncCalendars() {
    console.log('Syncing external calendars...');
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
    let allExternalEvents = {};

    for (const url of config.calendarUrls) {
        try {
            const events = await ical.fromURL(url);
            for (let k in events) {
                if (events.hasOwnProperty(k) && events[k].type === 'VEVENT') {
                    const ev = events[k];
                    const date = new Date(ev.start);
                    if (isNaN(date.getTime())) continue;

                    const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                    const day = date.getDate();

                    if (!allExternalEvents[monthKey]) allExternalEvents[monthKey] = {};
                    if (!allExternalEvents[monthKey][day]) allExternalEvents[monthKey][day] = [];

                    allExternalEvents[monthKey][day].push({
                        id: ev.uid || Date.now() + Math.random(),
                        name: ev.summary,
                        timeStart: ev.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                        timeEnd: ev.end ? new Date(ev.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
                        color: '#E2E8F0',
                        icon: 'calendar-days',
                        isExternal: true
                    });
                }
            }
        } catch (e) {
            console.error(`Error fetching calendar from ${url}:`, e);
        }
    }
    fs.writeFileSync(EXTERNAL_EVENTS_FILE, JSON.stringify(allExternalEvents));
    console.log('Sync complete.');
}

function parseICSContent(content) {
    const events = ical.parseICS(content);
    let newEvents = {};
    for (let k in events) {
        if (events.hasOwnProperty(k) && events[k].type === 'VEVENT') {
            const ev = events[k];
            const date = new Date(ev.start);
            if (isNaN(date.getTime())) continue;

            const monthKey = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
            const day = date.getDate();

            if (!newEvents[monthKey]) newEvents[monthKey] = {};
            if (!newEvents[monthKey][day]) newEvents[monthKey][day] = [];

            newEvents[monthKey][day].push({
                id: ev.uid || Date.now() + Math.random(),
                name: ev.summary,
                timeStart: ev.start.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }),
                timeEnd: ev.end ? new Date(ev.end).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : '',
                color: '#E2E8F0',
                icon: 'calendar-days',
                isExternal: true
            });
        }
    }
    return newEvents;
}

// Sync on startup and every hour
syncCalendars();
cron.schedule('0 * * * *', syncCalendars);

// CONFIGURATION SYSTÈME
app.post('/api/system/reboot', (req, res) => {
    console.log("Reboot requested via API");
    res.json({ success: true, message: "Rebooting in 2 seconds..." });
    setTimeout(() => {
        exec('sudo reboot');
    }, 2000);
});

app.post('/api/system/screen', (req, res) => {
    const { power } = req.body; // 0 or 1
    // Security: strictly validate input to prevent shell injection
    const p = parseInt(power);
    if (p !== 0 && p !== 1) {
        return res.status(400).json({ success: false, error: "Invalid power value. Must be 0 or 1." });
    }

    exec(`vcgencmd display_power ${p}`, (error) => {
        if (error) return res.status(500).json({ success: false, error: error.message });
        res.json({ success: true });
    });
});


app.get('/api/config', (req, res) => {
    const current = JSON.parse(fs.readFileSync(CONFIG_FILE));
    res.json(current);
});

app.post('/api/config', (req, res) => {
    const current = JSON.parse(fs.readFileSync(CONFIG_FILE));
    const updated = { ...current, ...req.body };
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(updated));
    res.json({ success: true });
});

// GESTION DES CALENDRIERS EXTERNES
app.get('/api/calendars', (req, res) => {
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
    res.json(config.calendarUrls || []);
});

app.post('/api/calendars', (req, res) => {
    const { url } = req.body;
    const config = JSON.parse(fs.readFileSync(CONFIG_FILE));
    if (!config.calendarUrls.includes(url)) {
        config.calendarUrls.push(url);
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
        syncCalendars();
    }
    res.json({ success: true });
});

app.delete('/api/calendars', (req, res) => {
    const { url } = req.body;
    let config = JSON.parse(fs.readFileSync(CONFIG_FILE));
    config.calendarUrls = config.calendarUrls.filter(u => u !== url);
    fs.writeFileSync(CONFIG_FILE, JSON.stringify(config));
    res.json({ success: true });
});

// SHOPPING LIST API
app.get('/api/shopping', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(SHOPPING_FILE)));
});

app.post('/api/shopping', (req, res) => {
    const { text } = req.body;
    const items = JSON.parse(fs.readFileSync(SHOPPING_FILE));
    items.push({ id: Date.now(), text, done: false });
    fs.writeFileSync(SHOPPING_FILE, JSON.stringify(items));
    res.json({ success: true });
});

app.put('/api/shopping/:id', (req, res) => {
    const { id } = req.params;
    const { done } = req.body;
    let items = JSON.parse(fs.readFileSync(SHOPPING_FILE));
    const index = items.findIndex(i => i.id == id);
    if (index !== -1) {
        items[index].done = done;
        fs.writeFileSync(SHOPPING_FILE, JSON.stringify(items));
    }
    res.json({ success: true });
});

app.delete('/api/shopping/:id', (req, res) => {
    const { id } = req.params;
    let items = JSON.parse(fs.readFileSync(SHOPPING_FILE));
    items = items.filter(i => i.id != id);
    fs.writeFileSync(SHOPPING_FILE, JSON.stringify(items));
    res.json({ success: true });
});

// MEAL PLANNER API
app.get('/api/meals', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(MEALS_FILE)));
});

app.post('/api/meals', (req, res) => {
    const { weekKey, day, meal } = req.body; // weekKey could be YYYY-WW or just something unique
    let meals = JSON.parse(fs.readFileSync(MEALS_FILE));
    if (!meals[weekKey]) meals[weekKey] = {};
    meals[weekKey][day] = meal;
    fs.writeFileSync(MEALS_FILE, JSON.stringify(meals));
    res.json({ success: true });
});

// TASKS API
app.get('/api/tasks', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(TASKS_FILE)));
});

app.post('/api/tasks', (req, res) => {
    const { text } = req.body;
    const tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
    tasks.push({ id: Date.now(), text, done: false });
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks));
    res.json({ success: true });
});

// MEMBERS API
app.get('/api/members', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(MEMBERS_FILE)));
});

app.post('/api/members', (req, res) => {
    const { name, color } = req.body;
    const members = JSON.parse(fs.readFileSync(MEMBERS_FILE));
    members.push({ id: Date.now(), name, color });
    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members));
    res.json({ success: true });
});

// NOTES API
app.get('/api/notes', (req, res) => {
    res.json(JSON.parse(fs.readFileSync(NOTES_FILE)));
});

app.post('/api/notes', (req, res) => {
    const { text } = req.body;
    fs.writeFileSync(NOTES_FILE, JSON.stringify({ text }));
    res.json({ success: true });
});

app.delete('/api/members/:id', (req, res) => {
    const { id } = req.params;
    let members = JSON.parse(fs.readFileSync(MEMBERS_FILE));
    members = members.filter(m => m.id != id);
    fs.writeFileSync(MEMBERS_FILE, JSON.stringify(members));
    res.json({ success: true });
});

app.put('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    const { done } = req.body;
    let tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
    const index = tasks.findIndex(t => t.id == id);
    if (index !== -1) {
        tasks[index].done = done;
        fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks));
    }
    res.json({ success: true });
});

app.delete('/api/tasks/:id', (req, res) => {
    const { id } = req.params;
    let tasks = JSON.parse(fs.readFileSync(TASKS_FILE));
    tasks = tasks.filter(t => t.id != id);
    fs.writeFileSync(TASKS_FILE, JSON.stringify(tasks));
    res.json({ success: true });
});

app.post('/api/calendars/import-manual', (req, res) => {
    try {
        const { content } = req.body;
        if (!content) return res.status(400).json({ success: false, error: "Contenu vide" });

        const newEvents = parseICSContent(content);
        let currentExternal = JSON.parse(fs.readFileSync(EXTERNAL_EVENTS_FILE));

        // Merge manual import into external events cache
        for (const mk in newEvents) {
            if (!currentExternal[mk]) currentExternal[mk] = {};
            for (const day in newEvents[mk]) {
                if (!currentExternal[mk][day]) currentExternal[mk][day] = [];
                currentExternal[mk][day] = [...currentExternal[mk][day], ...newEvents[mk][day]];
            }
        }

        fs.writeFileSync(EXTERNAL_EVENTS_FILE, JSON.stringify(currentExternal));
        res.json({ success: true });
    } catch (e) {
        console.error("Manual import error:", e);
        res.status(500).json({ success: false, error: e.message });
    }
});

// ROUTES STICKERS (Mis à jour pour isImportant)
app.get('/api/stickers/:monthKey', (req, res) => {
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    const external = JSON.parse(fs.readFileSync(EXTERNAL_EVENTS_FILE));

    const localEvents = data[req.params.monthKey] || {};
    const externalEvents = external[req.params.monthKey] || {};

    // Merge external events into local ones
    const merged = { ...localEvents };
    for (const day in externalEvents) {
        if (!merged[day]) merged[day] = [];
        merged[day] = [...merged[day], ...externalEvents[day]];
    }

    res.json(merged);
});

app.delete('/api/stickers/clear-all', (req, res) => {
    fs.writeFileSync(DATA_FILE, JSON.stringify({}));
    res.json({ success: true });
});

app.post('/api/stickers/:monthKey', (req, res) => {
    const { day, name, color, timeStart, timeEnd, icon, isImportant } = req.body;
    const { monthKey } = req.params;
    const data = JSON.parse(fs.readFileSync(DATA_FILE));
    if (!data[monthKey]) data[monthKey] = {};
    if (!data[monthKey][day]) data[monthKey][day] = [];
    data[monthKey][day].push({ id: Date.now(), name, color, timeStart, timeEnd, icon, isImportant: isImportant || false });
    fs.writeFileSync(DATA_FILE, JSON.stringify(data));
    res.json({ success: true });
});

app.put('/api/stickers/:monthKey/:day/:id', (req, res) => {
    const { monthKey, day, id } = req.params;
    const { name, color, timeStart, timeEnd, icon, isImportant } = req.body;
    let data = JSON.parse(fs.readFileSync(DATA_FILE));
    if (data[monthKey] && data[monthKey][day]) {
        const index = data[monthKey][day].findIndex(s => s.id == id);
        if (index !== -1) {
            data[monthKey][day][index] = { ...data[monthKey][day][index], name, color, timeStart, timeEnd, icon, isImportant };
            fs.writeFileSync(DATA_FILE, JSON.stringify(data));
        }
    }
    res.json({ success: true });
});

app.delete('/api/stickers/:monthKey/:day/:id', (req, res) => {
    const { monthKey, day, id } = req.params;
    let data = JSON.parse(fs.readFileSync(DATA_FILE));
    if (data[monthKey] && data[monthKey][day]) {
        data[monthKey][day] = data[monthKey][day].filter(s => s.id != id);
        fs.writeFileSync(DATA_FILE, JSON.stringify(data));
    }
    res.json({ success: true });
});

app.listen(PORT, () => console.log(`Serveur prêt sur port ${PORT}`));
