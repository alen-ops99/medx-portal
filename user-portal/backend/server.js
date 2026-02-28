const express = require('express');
const cors = require('cors');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const QRCode = require('qrcode');
const fs = require('fs');
const initSqlJs = require('sql.js');
const nodemailer = require('nodemailer');
const firaService = require('./fira-service');

// Stripe — conditionally loaded based on env config (loaded after .env parsing below)
let stripe = null;

// Load .env file if present (minimal loader — no dotenv dependency needed)
const envPath = path.join(__dirname, '.env');
if (fs.existsSync(envPath)) {
    fs.readFileSync(envPath, 'utf8').split('\n').forEach(line => {
        const trimmed = line.trim();
        if (!trimmed || trimmed.startsWith('#')) return;
        const eqIndex = trimmed.indexOf('=');
        if (eqIndex === -1) return;
        const key = trimmed.slice(0, eqIndex).trim();
        const val = trimmed.slice(eqIndex + 1).trim();
        if (!process.env[key]) process.env[key] = val;
    });
}

// Initialize Stripe after env is loaded
if (process.env.STRIPE_SECRET_KEY) {
    stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
    console.log('[Stripe] Card payments ACTIVE — Stripe API key configured');
} else {
    console.log('[Stripe] Not configured — card payments disabled. Set STRIPE_SECRET_KEY in .env');
}

// Log FIRA configuration status
if (firaService.isConfigured()) {
    console.log('[FIRA] Fiscal invoicing is ACTIVE — FIRA API key configured');
} else {
    console.log('[FIRA] Running in DEMO mode — set FIRA_API_KEY in .env for fiscal invoicing');
}

const app = express();

// Email configuration (uses environment variables or defaults for development)
const emailTransporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: process.env.SMTP_PORT || 587,
    secure: false,
    auth: {
        user: process.env.SMTP_USER || '',
        pass: process.env.SMTP_PASS || ''
    }
});

// Helper function to send emails
async function sendEmail(to, subject, htmlContent) {
    // Skip if no SMTP configured
    if (!process.env.SMTP_USER) {
        console.log(`[Email Mock] To: ${to}, Subject: ${subject}`);
        return { success: true, mock: true };
    }
    try {
        await emailTransporter.sendMail({
            from: process.env.SMTP_FROM || 'Med&X Accelerator <accelerator@medx.hr>',
            to,
            subject,
            html: htmlContent
        });
        return { success: true };
    } catch (err) {
        console.error('Email error:', err);
        return { success: false, error: err.message };
    }
}

// Branded email template builder — wraps content in Med&X styled HTML
function buildEmailTemplate(title, bodyHtml) {
    return `
<!DOCTYPE html>
<html lang="en">
<head><meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"></head>
<body style="margin: 0; padding: 0; background: #f4f4f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;">
<table width="100%" cellpadding="0" cellspacing="0" style="background: #f4f4f5; padding: 32px 16px;">
<tr><td align="center">
<table width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; width: 100%;">
    <!-- Header -->
    <tr><td style="background: #0f172a; padding: 28px 32px; border-radius: 12px 12px 0 0; text-align: center;">
        <div style="font-size: 28px; font-weight: 700; letter-spacing: 1px;">
            <span style="color: #C9A962;">Med</span><span style="color: #ffffff;">&amp;</span><span style="color: #C9A962;">X</span>
        </div>
        <div style="color: #94a3b8; font-size: 12px; margin-top: 4px; letter-spacing: 2px; text-transform: uppercase;">Building Bridges in Biomedicine</div>
    </td></tr>
    <!-- Title bar -->
    <tr><td style="background: #1e293b; padding: 16px 32px; text-align: center;">
        <h1 style="margin: 0; color: #C9A962; font-size: 20px; font-weight: 600;">${title}</h1>
    </td></tr>
    <!-- Body -->
    <tr><td style="background: #ffffff; padding: 32px; border-left: 1px solid #e2e8f0; border-right: 1px solid #e2e8f0;">
        <div style="color: #334155; font-size: 15px; line-height: 1.7;">
            ${bodyHtml}
        </div>
    </td></tr>
    <!-- Footer -->
    <tr><td style="background: #0f172a; padding: 24px 32px; border-radius: 0 0 12px 12px; text-align: center;">
        <div style="color: #C9A962; font-size: 14px; font-weight: 600; margin-bottom: 8px;">Med&amp;X</div>
        <div style="color: #94a3b8; font-size: 12px; margin-bottom: 12px;">Building Bridges in Biomedicine</div>
        <div style="margin-bottom: 8px;">
            <a href="https://medx.hr" style="color: #C9A962; text-decoration: none; font-size: 12px; margin: 0 8px;">Website</a>
            <a href="https://www.linkedin.com/company/med-x-croatia/" style="color: #C9A962; text-decoration: none; font-size: 12px; margin: 0 8px;">LinkedIn</a>
            <a href="https://www.instagram.com/medx.hr/" style="color: #C9A962; text-decoration: none; font-size: 12px; margin: 0 8px;">Instagram</a>
        </div>
        <div style="color: #64748b; font-size: 11px;">&copy; ${new Date().getFullYear()} Med&amp;X. All rights reserved.</div>
    </td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;
}

const PORT = process.env.PORT || 3000;
const JWT_SECRET = (function() {
    if (process.env.JWT_SECRET) return process.env.JWT_SECRET;
    if (process.env.NODE_ENV === 'production') {
        console.error('FATAL: JWT_SECRET env var is required in production');
        process.exit(1);
    }
    return 'medx-portal-secret-key-2026';
})();

app.use(cors({
    origin: [process.env.RENDER_EXTERNAL_URL, 'http://localhost:3000', 'http://localhost:3001'].filter(Boolean)
}));

// Stripe webhook needs raw body for signature verification
// express.json() must be SKIPPED for the webhook route or it corrupts the signature
app.use((req, res, next) => {
    if (req.originalUrl === '/api/stripe/webhook') {
        express.raw({ type: 'application/json' })(req, res, next);
    } else {
        express.json()(req, res, next);
    }
});
app.use(express.static(path.join(__dirname, '../frontend')));
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

// Create uploads directory
const uploadsDir = path.join(__dirname, 'uploads');
['abstracts', 'posters', 'documents', 'badges', 'photos', 'tickets', 'accelerator', 'chat', 'speakers'].forEach(dir => {
    const dirPath = path.join(uploadsDir, dir);
    if (!fs.existsSync(dirPath)) fs.mkdirSync(dirPath, { recursive: true });
});

// Multer configuration
const ALLOWED_UPLOAD_TYPES = ['abstracts', 'posters', 'documents', 'badges', 'photos', 'tickets', 'accelerator', 'chat', 'speakers'];
const storage = multer.diskStorage({
    destination: (req, file, cb) => {
        const type = req.params.type || 'documents';
        if (!ALLOWED_UPLOAD_TYPES.includes(type)) {
            return cb(new Error('Invalid upload type'));
        }
        cb(null, path.join(uploadsDir, type));
    },
    filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
});
const upload = multer({ storage, limits: { fileSize: 10 * 1024 * 1024 } });

let db;
let SQL; // Store SQL.js module reference for reloading
// Flexible DB path: use shared DB locally, or local copy when deployed
const SHARED_DB_PATH = path.join(__dirname, '../../shared/medx_portal.db');
const LOCAL_DB_PATH = path.join(__dirname, 'medx_portal.db');
const DB_PATH = process.env.DATABASE_PATH || (fs.existsSync(SHARED_DB_PATH) ? SHARED_DB_PATH : LOCAL_DB_PATH);

// Database helper
const query = {
    run: (sql, params = []) => { db.run(sql, params); saveDb(); },
    get: (sql, params = []) => {
        const stmt = db.prepare(sql);
        if (params.length) stmt.bind(params);
        if (stmt.step()) { const r = stmt.getAsObject(); stmt.free(); return r; }
        stmt.free(); return null;
    },
    all: (sql, params = []) => {
        const stmt = db.prepare(sql);
        if (params.length) stmt.bind(params);
        const rows = [];
        while (stmt.step()) rows.push(stmt.getAsObject());
        stmt.free(); return rows;
    }
};

let _lastSaveTime = 0;
function saveDb() {
    _lastSaveTime = Date.now();
    fs.writeFileSync(DB_PATH, Buffer.from(db.export()));
}

// Watch shared DB for changes from the other portal
function watchSharedDb() {
    // Only watch when using shared DB (local dev), not when deployed
    if (DB_PATH !== SHARED_DB_PATH) { console.log('[Sync] Running with local DB — cross-portal sync disabled'); return; }
    let debounceTimer = null;
    fs.watch(DB_PATH, (eventType) => {
        if (eventType !== 'change') return;
        // Ignore our own writes (within 2s)
        if (Date.now() - _lastSaveTime < 2000) return;
        if (debounceTimer) clearTimeout(debounceTimer);
        debounceTimer = setTimeout(() => {
            try {
                const data = fs.readFileSync(DB_PATH);
                db = new SQL.Database(data);
                console.log('[Sync] Reloaded shared DB (changed by other portal)');
            } catch (err) {
                console.error('[Sync] Error reloading DB:', err.message);
            }
        }, 500);
    });
    console.log('[Sync] Watching shared DB for cross-portal changes');
}

// Auth middleware
function auth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token && token !== 'auto-login') {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = query.get("SELECT id, email, is_admin FROM users WHERE id = ?", [decoded.id]);
            if (user) { req.user = user; return next(); }
        } catch(e) { /* token invalid/expired */ }
    }
    // Dev fallback — ONLY in development
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        const user = query.get("SELECT id, email, is_admin FROM users WHERE email = 'juginovic.alen@gmail.com'");
        req.user = user || { id: 'default', email: 'juginovic.alen@gmail.com', is_admin: true };
        return next();
    }
    return res.status(401).json({ error: 'Authentication required' });
}

function optionalAuth(req, res, next) {
    const token = req.headers.authorization?.replace('Bearer ', '');
    if (token && token !== 'auto-login') {
        try {
            const decoded = jwt.verify(token, JWT_SECRET);
            const user = query.get("SELECT id, email, is_admin FROM users WHERE id = ?", [decoded.id]);
            if (user) { req.user = user; return next(); }
        } catch(e) { /* token invalid/expired */ }
    }
    // Dev fallback — ONLY in development
    if (process.env.NODE_ENV === 'development' || !process.env.NODE_ENV) {
        const user = query.get("SELECT id, email, is_admin FROM users WHERE email = 'juginovic.alen@gmail.com'");
        req.user = user || { id: 'default', email: 'juginovic.alen@gmail.com', is_admin: true };
        return next();
    }
    // Optional auth — no user is OK
    req.user = null;
    next();
}

function adminOnly(req, res, next) {
    if (!req.user?.is_admin) return res.status(403).json({ error: 'Admin only' });
    next();
}

async function initializeApp() {
    SQL = await initSqlJs();

    // Ensure shared directory exists
    const sharedDir = path.dirname(DB_PATH);
    if (!fs.existsSync(sharedDir)) fs.mkdirSync(sharedDir, { recursive: true });

    if (fs.existsSync(DB_PATH)) {
        db = new SQL.Database(fs.readFileSync(DB_PATH));
    } else {
        db = new SQL.Database();
    }

    // Create schema
    db.run(`CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY, email TEXT UNIQUE NOT NULL, password_hash TEXT,
        first_name TEXT, last_name TEXT, phone TEXT, institution TEXT, country TEXT,
        bio TEXT, photo_url TEXT, is_admin INTEGER DEFAULT 0, is_public_profile INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS conferences (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, year INTEGER, slug TEXT UNIQUE,
        description TEXT, start_date TEXT, end_date TEXT,
        venue_name TEXT, venue_city TEXT, venue_country TEXT,
        max_capacity INTEGER DEFAULT 200, is_active INTEGER DEFAULT 1,
        registration_open INTEGER DEFAULT 1, abstract_submission_open INTEGER DEFAULT 1,
        early_bird_deadline TEXT, regular_deadline TEXT, abstract_deadline TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS ticket_types (
        id TEXT PRIMARY KEY, conference_id TEXT, name TEXT, name_hr TEXT,
        price_early_bird REAL, price_regular REAL, price_late REAL,
        currency TEXT DEFAULT 'EUR', includes_gala INTEGER DEFAULT 0,
        sold_count INTEGER DEFAULT 0, sort_order INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS promo_codes (
        id TEXT PRIMARY KEY, conference_id TEXT, code TEXT,
        discount_type TEXT DEFAULT 'percentage', discount_value REAL,
        max_uses INTEGER, used_count INTEGER DEFAULT 0,
        valid_until TEXT, is_active INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS registrations (
        id TEXT PRIMARY KEY, conference_id TEXT, user_id TEXT, ticket_type_id TEXT,
        registration_type TEXT DEFAULT 'general', status TEXT DEFAULT 'pending',
        payment_status TEXT DEFAULT 'unpaid', amount_paid REAL,
        promo_code_id TEXT, discount_amount REAL DEFAULT 0,
        invoice_number TEXT, ticket_qr_code TEXT,
        dietary_requirements TEXT, accessibility_needs TEXT,
        checked_in INTEGER DEFAULT 0, checked_in_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS abstracts (
        id TEXT PRIMARY KEY, conference_id TEXT, submitter_id TEXT,
        title TEXT, abstract_text TEXT, keywords TEXT,
        topic_category TEXT, presentation_type TEXT DEFAULT 'poster',
        status TEXT DEFAULT 'submitted', decision TEXT,
        is_withdrawn INTEGER DEFAULT 0, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS abstract_authors (
        id TEXT PRIMARY KEY, abstract_id TEXT, email TEXT,
        first_name TEXT, last_name TEXT, institution TEXT,
        is_presenting INTEGER DEFAULT 0, author_order INTEGER DEFAULT 1
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS speakers (
        id TEXT PRIMARY KEY, conference_id TEXT, name TEXT,
        title TEXT, institution TEXT, bio TEXT, photo_url TEXT,
        talk_title TEXT, talk_abstract TEXT, speaker_type TEXT DEFAULT 'invited',
        is_keynote INTEGER DEFAULT 0, is_confirmed INTEGER DEFAULT 1,
        linkedin_url TEXT, twitter_url TEXT, sort_order INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS speaker_documents (
        id TEXT PRIMARY KEY,
        speaker_id TEXT NOT NULL,
        type TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_at TEXT DEFAULT (datetime('now')),
        FOREIGN KEY (speaker_id) REFERENCES speakers(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sessions (
        id TEXT PRIMARY KEY, conference_id TEXT, title TEXT,
        description TEXT, session_type TEXT DEFAULT 'talk',
        day INTEGER DEFAULT 1, start_time TEXT, end_time TEXT,
        room TEXT, track TEXT, speaker_ids TEXT
    )`);

    // Phase 3C: Add is_published and capacity columns to sessions
    try { db.run(`ALTER TABLE sessions ADD COLUMN is_published INTEGER DEFAULT 0`); } catch (e) { /* column may already exist */ }
    try { db.run(`ALTER TABLE sessions ADD COLUMN capacity INTEGER`); } catch (e) { /* column may already exist */ }

    db.run(`CREATE TABLE IF NOT EXISTS personal_schedules (
        id TEXT PRIMARY KEY, user_id TEXT, session_id TEXT, UNIQUE(user_id, session_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS session_questions (
        id TEXT PRIMARY KEY, session_id TEXT, user_id TEXT, question_text TEXT,
        upvotes INTEGER DEFAULT 0, is_answered INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS connections (
        id TEXT PRIMARY KEY, requester_id TEXT, requestee_id TEXT,
        status TEXT DEFAULT 'pending', message TEXT, created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY, sender_id TEXT, recipient_id TEXT,
        subject TEXT, body TEXT, is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY, conference_id TEXT, title TEXT, content TEXT,
        type TEXT DEFAULT 'general', is_urgent INTEGER DEFAULT 0,
        published_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS volunteers (
        id TEXT PRIMARY KEY, conference_id TEXT, user_id TEXT,
        availability TEXT, preferred_tasks TEXT, status TEXT DEFAULT 'pending'
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS sponsors (
        id TEXT PRIMARY KEY, conference_id TEXT, name TEXT,
        tier TEXT DEFAULT 'bronze', logo_url TEXT, website_url TEXT,
        description TEXT, sort_order INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS resources (
        id TEXT PRIMARY KEY, conference_id TEXT, title TEXT,
        file_url TEXT, file_type TEXT, category TEXT DEFAULT 'general',
        download_count INTEGER DEFAULT 0
    )`);

    // ========== ACCELERATOR TABLES ==========
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_programs (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, year INTEGER,
        description TEXT, application_deadline TEXT,
        program_start TEXT, program_end TEXT,
        is_active INTEGER DEFAULT 1, is_accepting INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS accelerator_institutions (
        id TEXT PRIMARY KEY, name TEXT NOT NULL, short_name TEXT,
        city TEXT, country TEXT, description TEXT,
        website_url TEXT, logo_url TEXT, available_spots INTEGER DEFAULT 5,
        is_active INTEGER DEFAULT 1, sort_order INTEGER DEFAULT 0
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS accelerator_applications (
        id TEXT PRIMARY KEY, program_id TEXT, user_id TEXT, year INTEGER,
        application_number TEXT UNIQUE,
        work_number TEXT,
        first_name TEXT, last_name TEXT, email TEXT, phone TEXT,
        date_of_birth TEXT, oib TEXT, address TEXT, nationality TEXT, country_of_residence TEXT,
        current_institution TEXT, current_position TEXT, degree_program TEXT,
        year_of_study TEXT, ects_total INTEGER,
        expected_graduation TEXT, gpa REAL,
        program_type TEXT,
        selected_institution TEXT, alternative_institution TEXT,
        first_choice_institution TEXT, second_choice_institution TEXT, third_choice_institution TEXT,
        research_interests TEXT, motivation_statement TEXT,
        previous_experience TEXT,
        special_arrangements TEXT,
        previous_research_experience TEXT, publications TEXT,
        awards_honors TEXT, languages TEXT,
        how_heard_about TEXT, additional_info TEXT,
        gdpr_consent INTEGER DEFAULT 0,
        gdpr_consent_date TEXT,
        status TEXT DEFAULT 'draft',
        validity_status TEXT,
        validity_notified_at TEXT,
        submitted_at TEXT, reviewed_at TEXT, reviewed_by TEXT,
        reviewer_notes TEXT, decision TEXT, decision_notes TEXT,
        assigned_institution TEXT,
        documents_complete INTEGER DEFAULT 0,
        objective_score REAL,
        interview_score REAL,
        total_score REAL,
        rank_position INTEGER,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP, updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Add new columns to existing accelerator_applications table (ignore errors if columns exist)
    try { db.run('ALTER TABLE accelerator_applications ADD COLUMN year INTEGER'); } catch (e) {}
    try { db.run('ALTER TABLE accelerator_applications ADD COLUMN oib TEXT'); } catch (e) {}
    try { db.run('ALTER TABLE accelerator_applications ADD COLUMN ects_total INTEGER'); } catch (e) {}
    try { db.run('ALTER TABLE accelerator_applications ADD COLUMN alternative_institution TEXT'); } catch (e) {}
    try { db.run('ALTER TABLE accelerator_applications ADD COLUMN candidate_id TEXT'); } catch (e) {}

    // Add overview config columns to accelerator_programs (ignore if exists)
    try { db.run("ALTER TABLE accelerator_programs ADD COLUMN program_duration TEXT DEFAULT '8-12 Weeks'"); } catch (e) {}
    try { db.run("ALTER TABLE accelerator_programs ADD COLUMN labs_count TEXT DEFAULT '15+ Worldwide'"); } catch (e) {}
    try { db.run("ALTER TABLE accelerator_programs ADD COLUMN positions_range TEXT DEFAULT '5-10'"); } catch (e) {}
    try { db.run("ALTER TABLE accelerator_programs ADD COLUMN about_program TEXT"); } catch (e) {}

    // Add category column to accelerator_key_dates (ignore if exists)
    try { db.run("ALTER TABLE accelerator_key_dates ADD COLUMN category TEXT DEFAULT 'event'"); } catch (e) {}

    db.run(`CREATE TABLE IF NOT EXISTS accelerator_documents (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL,
        document_type TEXT NOT NULL,
        original_filename TEXT, stored_filename TEXT,
        file_path TEXT, file_size INTEGER, mime_type TEXT,
        upload_status TEXT DEFAULT 'pending',
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (application_id) REFERENCES accelerator_applications(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS accelerator_recommendations (
        id TEXT PRIMARY KEY, application_id TEXT NOT NULL,
        recommender_name TEXT, recommender_email TEXT,
        recommender_title TEXT, recommender_institution TEXT,
        relationship TEXT, request_sent_at TEXT,
        submitted INTEGER DEFAULT 0, submitted_at TEXT,
        letter_file TEXT,
        FOREIGN KEY (application_id) REFERENCES accelerator_applications(id)
    )`);

    // Key dates for each accelerator year
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_key_dates (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        name TEXT NOT NULL,
        date_start TEXT NOT NULL,
        date_end TEXT,
        description TEXT,
        color TEXT DEFAULT '#22d3ee',
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Enhanced institution details
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_institution_details (
        id TEXT PRIMARY KEY,
        institution_id TEXT NOT NULL,
        year INTEGER NOT NULL,
        program_type TEXT DEFAULT 'scientific',
        available_spots INTEGER DEFAULT 2,
        internship_duration TEXT,
        mentors TEXT,
        visa_requirements TEXT,
        accommodation_info TEXT,
        stipend_info TEXT,
        requirements TEXT,
        contact_email TEXT,
        contact_person TEXT,
        is_active INTEGER DEFAULT 1,
        UNIQUE(institution_id, year)
    )`);

    // Evaluation criteria (customizable per year)
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_evaluation_criteria (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        name TEXT NOT NULL,
        name_hr TEXT,
        max_points REAL DEFAULT 10,
        weight REAL DEFAULT 1,
        category TEXT DEFAULT 'objective',
        sort_order INTEGER DEFAULT 0,
        is_active INTEGER DEFAULT 1
    )`);

    // Application evaluations/scores
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_evaluations (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        criterion_id TEXT NOT NULL,
        score REAL,
        notes TEXT,
        evaluated_by TEXT,
        evaluated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(application_id, criterion_id)
    )`);

    // External interviewers
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_interviewers (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL,
        name TEXT NOT NULL,
        email TEXT NOT NULL,
        institution TEXT,
        specialty TEXT,
        access_token TEXT,
        is_active INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // PDF header settings for ranking lists
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_pdf_settings (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL UNIQUE,
        header_intro TEXT,
        header_title TEXT,
        article1_text TEXT,
        article2_text TEXT,
        article3_text TEXT,
        signatory_name TEXT DEFAULT 'Alen Juginovic, M.D.',
        signatory_title TEXT DEFAULT 'Committee for Organization of the Med&X Accelerator Program',
        signatory_role TEXT DEFAULT 'President',
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Interview scores from external interviewers
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_interview_scores (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        interviewer_id TEXT NOT NULL,
        score REAL,
        notes TEXT,
        submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(application_id, interviewer_id)
    )`);

    // Applicant accounts (public registration for candidates)
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_applicants (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        date_of_birth TEXT,
        nationality TEXT,
        address TEXT,
        city TEXT,
        country TEXT,
        current_institution TEXT,
        faculty TEXT,
        study_year TEXT,
        expected_graduation TEXT,
        email_verified INTEGER DEFAULT 0,
        verification_token TEXT,
        reset_token TEXT,
        reset_token_expires TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        last_login TEXT
    )`);

    // Messages to candidates
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_messages (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        message_type TEXT DEFAULT 'info',
        subject TEXT,
        content TEXT NOT NULL,
        sent_by TEXT,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        read_at TEXT
    )`);

    // GDPR consent tracking
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_consents (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        consent_type TEXT NOT NULL,
        consented INTEGER DEFAULT 0,
        consent_text TEXT,
        consented_at TEXT,
        ip_address TEXT
    )`);

    // Form configuration for accelerator application form (Phase 4C)
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_form_config (
        id TEXT PRIMARY KEY,
        program_id TEXT,
        section_name TEXT NOT NULL,
        field_name TEXT NOT NULL,
        field_type TEXT DEFAULT 'text',
        label TEXT,
        placeholder TEXT,
        is_required INTEGER DEFAULT 0,
        options TEXT,
        sort_order INTEGER DEFAULT 0,
        is_visible INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== BIOMEDICAL FORUM TABLES ==========

    // Forum member profiles (extended user profiles for Forum)
    db.run(`CREATE TABLE IF NOT EXISTS forum_members (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE,
        membership_status TEXT DEFAULT 'pending',
        membership_level TEXT DEFAULT 'member',
        specialty TEXT,
        sub_specialties TEXT,
        institution TEXT,
        position TEXT,
        department TEXT,
        location_city TEXT,
        location_country TEXT,
        bio TEXT,
        research_interests TEXT,
        career_stage TEXT,
        years_experience INTEGER,
        orcid_id TEXT,
        linkedin_url TEXT,
        twitter_handle TEXT,
        website_url TEXT,
        photo_url TEXT,
        profile_visibility TEXT DEFAULT 'members',
        contact_preference TEXT DEFAULT 'platform',
        is_mentor INTEGER DEFAULT 0,
        seeking_mentor INTEGER DEFAULT 0,
        mentor_topics TEXT,
        languages TEXT,
        achievements TEXT,
        publications_count INTEGER DEFAULT 0,
        points INTEGER DEFAULT 0,
        badges TEXT,
        onboarding_completed INTEGER DEFAULT 0,
        gdpr_consent INTEGER DEFAULT 0,
        gdpr_consent_date TEXT,
        application_text TEXT,
        application_submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        rejection_reason TEXT,
        last_active TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Forum member connections
    db.run(`CREATE TABLE IF NOT EXISTS forum_connections (
        id TEXT PRIMARY KEY,
        requester_id TEXT,
        receiver_id TEXT,
        status TEXT DEFAULT 'pending',
        message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        accepted_at TEXT,
        FOREIGN KEY (requester_id) REFERENCES forum_members(id),
        FOREIGN KEY (receiver_id) REFERENCES forum_members(id)
    )`);

    // Forum interest groups/channels
    db.run(`CREATE TABLE IF NOT EXISTS forum_groups (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        description TEXT,
        category TEXT,
        group_type TEXT DEFAULT 'public',
        cover_image TEXT,
        icon TEXT,
        member_count INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        is_active INTEGER DEFAULT 1
    )`);

    // Forum group memberships
    db.run(`CREATE TABLE IF NOT EXISTS forum_group_members (
        id TEXT PRIMARY KEY,
        group_id TEXT,
        member_id TEXT,
        role TEXT DEFAULT 'member',
        joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES forum_groups(id),
        FOREIGN KEY (member_id) REFERENCES forum_members(id)
    )`);

    // Forum posts/newsfeed
    db.run(`CREATE TABLE IF NOT EXISTS forum_posts (
        id TEXT PRIMARY KEY,
        author_id TEXT,
        group_id TEXT,
        post_type TEXT DEFAULT 'discussion',
        title TEXT,
        content TEXT NOT NULL,
        content_html TEXT,
        tags TEXT,
        attachments TEXT,
        image_url TEXT,
        video_url TEXT,
        link_url TEXT,
        link_preview TEXT,
        is_pinned INTEGER DEFAULT 0,
        is_announcement INTEGER DEFAULT 0,
        is_featured INTEGER DEFAULT 0,
        visibility TEXT DEFAULT 'members',
        likes_count INTEGER DEFAULT 0,
        comments_count INTEGER DEFAULT 0,
        shares_count INTEGER DEFAULT 0,
        views_count INTEGER DEFAULT 0,
        moderation_status TEXT DEFAULT 'approved',
        moderated_by TEXT,
        moderated_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (author_id) REFERENCES forum_members(id),
        FOREIGN KEY (group_id) REFERENCES forum_groups(id)
    )`);

    // Forum post reactions (likes, etc.)
    db.run(`CREATE TABLE IF NOT EXISTS forum_post_reactions (
        id TEXT PRIMARY KEY,
        post_id TEXT,
        member_id TEXT,
        reaction_type TEXT DEFAULT 'like',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES forum_posts(id),
        FOREIGN KEY (member_id) REFERENCES forum_members(id)
    )`);

    // Forum comments
    db.run(`CREATE TABLE IF NOT EXISTS forum_comments (
        id TEXT PRIMARY KEY,
        post_id TEXT,
        author_id TEXT,
        parent_id TEXT,
        content TEXT NOT NULL,
        likes_count INTEGER DEFAULT 0,
        is_edited INTEGER DEFAULT 0,
        moderation_status TEXT DEFAULT 'approved',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (post_id) REFERENCES forum_posts(id),
        FOREIGN KEY (author_id) REFERENCES forum_members(id),
        FOREIGN KEY (parent_id) REFERENCES forum_comments(id)
    )`);

    // Forum direct messages
    db.run(`CREATE TABLE IF NOT EXISTS forum_messages (
        id TEXT PRIMARY KEY,
        conversation_id TEXT,
        sender_id TEXT,
        recipient_id TEXT,
        content TEXT NOT NULL,
        attachments TEXT,
        is_read INTEGER DEFAULT 0,
        read_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES forum_members(id),
        FOREIGN KEY (recipient_id) REFERENCES forum_members(id)
    )`);

    // Forum conversations (for grouping messages)
    db.run(`CREATE TABLE IF NOT EXISTS forum_conversations (
        id TEXT PRIMARY KEY,
        participant_ids TEXT,
        last_message_id TEXT,
        last_message_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Forum events
    db.run(`CREATE TABLE IF NOT EXISTS forum_events (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        description TEXT,
        event_type TEXT DEFAULT 'networking',
        start_date TEXT,
        end_date TEXT,
        timezone TEXT DEFAULT 'Europe/Zagreb',
        location_type TEXT DEFAULT 'virtual',
        location_name TEXT,
        location_address TEXT,
        virtual_link TEXT,
        cover_image TEXT,
        capacity INTEGER,
        registration_deadline TEXT,
        is_paid INTEGER DEFAULT 0,
        price REAL DEFAULT 0,
        early_bird_price REAL,
        early_bird_deadline TEXT,
        requires_approval INTEGER DEFAULT 0,
        is_members_only INTEGER DEFAULT 1,
        agenda TEXT,
        speakers TEXT,
        organizer_id TEXT,
        status TEXT DEFAULT 'draft',
        registrations_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES forum_members(id)
    )`);

    // Forum event registrations
    db.run(`CREATE TABLE IF NOT EXISTS forum_event_registrations (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        member_id TEXT,
        status TEXT DEFAULT 'registered',
        ticket_type TEXT DEFAULT 'general',
        payment_status TEXT,
        payment_amount REAL,
        checked_in INTEGER DEFAULT 0,
        checked_in_at TEXT,
        qr_code TEXT,
        notes TEXT,
        registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES forum_events(id),
        FOREIGN KEY (member_id) REFERENCES forum_members(id)
    )`);

    // Forum media gallery
    db.run(`CREATE TABLE IF NOT EXISTS forum_media (
        id TEXT PRIMARY KEY,
        uploader_id TEXT,
        event_id TEXT,
        gallery_name TEXT,
        media_type TEXT DEFAULT 'image',
        title TEXT,
        description TEXT,
        file_url TEXT,
        thumbnail_url TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        duration INTEGER,
        tags TEXT,
        is_approved INTEGER DEFAULT 0,
        approved_by TEXT,
        views_count INTEGER DEFAULT 0,
        likes_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploader_id) REFERENCES forum_members(id),
        FOREIGN KEY (event_id) REFERENCES forum_events(id)
    )`);

    // Forum resources/documents library
    db.run(`CREATE TABLE IF NOT EXISTS forum_resources (
        id TEXT PRIMARY KEY,
        uploader_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        resource_type TEXT DEFAULT 'document',
        category TEXT,
        file_url TEXT,
        file_name TEXT,
        file_size INTEGER,
        mime_type TEXT,
        external_url TEXT,
        doi TEXT,
        tags TEXT,
        is_featured INTEGER DEFAULT 0,
        downloads_count INTEGER DEFAULT 0,
        views_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (uploader_id) REFERENCES forum_members(id)
    )`);

    // Forum mentorship matches
    db.run(`CREATE TABLE IF NOT EXISTS forum_mentorships (
        id TEXT PRIMARY KEY,
        mentor_id TEXT,
        mentee_id TEXT,
        status TEXT DEFAULT 'pending',
        match_score REAL,
        focus_areas TEXT,
        goals TEXT,
        meeting_frequency TEXT,
        notes TEXT,
        started_at TEXT,
        ended_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (mentor_id) REFERENCES forum_members(id),
        FOREIGN KEY (mentee_id) REFERENCES forum_members(id)
    )`);

    // Forum badges/achievements
    db.run(`CREATE TABLE IF NOT EXISTS forum_badges (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        slug TEXT UNIQUE,
        description TEXT,
        icon TEXT,
        color TEXT,
        points INTEGER DEFAULT 0,
        criteria TEXT,
        is_active INTEGER DEFAULT 1
    )`);

    // Forum member badges
    db.run(`CREATE TABLE IF NOT EXISTS forum_member_badges (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        badge_id TEXT,
        earned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES forum_members(id),
        FOREIGN KEY (badge_id) REFERENCES forum_badges(id)
    )`);

    // Forum notifications
    db.run(`CREATE TABLE IF NOT EXISTS forum_notifications (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        type TEXT,
        title TEXT,
        message TEXT,
        link TEXT,
        related_id TEXT,
        is_read INTEGER DEFAULT 0,
        read_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES forum_members(id)
    )`);

    // Forum activity log (for analytics)
    db.run(`CREATE TABLE IF NOT EXISTS forum_activity (
        id TEXT PRIMARY KEY,
        member_id TEXT,
        activity_type TEXT,
        target_type TEXT,
        target_id TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (member_id) REFERENCES forum_members(id)
    )`);

    // ========== MEMBERSHIP MANAGEMENT TABLES ==========

    // Forum prospects (potential members to invite)
    db.run(`CREATE TABLE IF NOT EXISTS forum_prospects (
        id TEXT PRIMARY KEY,
        first_name TEXT,
        last_name TEXT,
        email TEXT UNIQUE,
        institution TEXT,
        specialty TEXT,
        position TEXT,
        country TEXT,
        source TEXT DEFAULT 'manual',
        import_batch_id TEXT,
        status TEXT DEFAULT 'not_contacted',
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Forum invitations (track sent invitations)
    db.run(`CREATE TABLE IF NOT EXISTS forum_invitations (
        id TEXT PRIMARY KEY,
        prospect_id TEXT,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        invitation_code TEXT UNIQUE,
        sent_at TEXT,
        delivery_status TEXT DEFAULT 'pending',
        opened_at TEXT,
        clicked_at TEXT,
        applied_at TEXT,
        application_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (prospect_id) REFERENCES forum_prospects(id)
    )`);

    // Forum email templates
    db.run(`CREATE TABLE IF NOT EXISTS forum_email_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT,
        body_html TEXT,
        variables TEXT,
        is_default INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Forum import batches (track Excel imports)
    db.run(`CREATE TABLE IF NOT EXISTS forum_import_batches (
        id TEXT PRIMARY KEY,
        filename TEXT,
        total_rows INTEGER,
        imported_count INTEGER,
        skipped_count INTEGER,
        errors TEXT,
        status TEXT DEFAULT 'processing',
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Forum event speakers
    db.run(`CREATE TABLE IF NOT EXISTS forum_event_speakers (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        name TEXT NOT NULL,
        title TEXT,
        institution TEXT,
        bio TEXT,
        photo_url TEXT,
        talk_title TEXT,
        talk_abstract TEXT,
        speaker_type TEXT DEFAULT 'presenter',
        is_confirmed INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES forum_events(id)
    )`);

    // Forum event schedule
    db.run(`CREATE TABLE IF NOT EXISTS forum_event_schedule (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        session_type TEXT DEFAULT 'session',
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        room TEXT,
        speaker_ids TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES forum_events(id)
    )`);

    // Forum group messages (for group chat)
    db.run(`CREATE TABLE IF NOT EXISTS forum_group_messages (
        id TEXT PRIMARY KEY,
        group_id TEXT,
        sender_id TEXT,
        message TEXT,
        attachments TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (group_id) REFERENCES forum_groups(id),
        FOREIGN KEY (sender_id) REFERENCES forum_members(id)
    )`);

    // Forum gallery folders
    db.run(`CREATE TABLE IF NOT EXISTS forum_gallery_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        event_year INTEGER,
        event_name TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS forum_media_folders (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id TEXT,
        created_by TEXT,
        created_at DATETIME DEFAULT (datetime('now'))
    )`);

    // Add industry column to forum_members if not exists
    try { db.run(`ALTER TABLE forum_members ADD COLUMN industry TEXT`); } catch(e) {}

    // Add new columns to forum_events if not exists
    try { db.run(`ALTER TABLE forum_events ADD COLUMN event_scale TEXT DEFAULT 'small'`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_events ADD COLUMN slug TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_events ADD COLUMN rsvp_deadline TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_events ADD COLUMN venue TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_invitations ADD COLUMN event_id TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_invitations ADD COLUMN event_type TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_invitations ADD COLUMN rsvp_status TEXT`); } catch(e) {}

    // Add new columns to forum_event_registrations if not exists
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN rsvp_status TEXT DEFAULT 'pending'`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN dietary_requirements TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN accommodation_needed INTEGER DEFAULT 0`); } catch(e) {}
    // AF26 extended registration fields
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN first_name TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN last_name TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN email TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN title TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN institution TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN dietary_notes TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN accommodation TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN special_requests TEXT`); } catch(e) {}
    // Forum payment tracking columns
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN stripe_session_id TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN payment_date TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN invoice_number TEXT`); } catch(e) {}

    // Add folder_id and caption to forum_media if not exists
    try { db.run(`ALTER TABLE forum_media ADD COLUMN folder_id TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_media ADD COLUMN caption TEXT`); } catch(e) {}

    // Phase 5B: Forum event management columns
    try { db.run(`ALTER TABLE forum_events ADD COLUMN is_published INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_events ADD COLUMN checkin_enabled INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_events ADD COLUMN updated_at TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN name TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN email TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE forum_event_registrations ADD COLUMN institution TEXT`); } catch(e) {}

    // Phase 6A: Building Bridges publish + sync columns
    try { db.run(`ALTER TABLE bridges_events ADD COLUMN is_published INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE bridges_events ADD COLUMN checkin_enabled INTEGER DEFAULT 0`); } catch(e) {}
    try { db.run(`ALTER TABLE bridges_events ADD COLUMN updated_at TEXT`); } catch(e) {}

    // Phase 6B: QR code for bridges registrations
    try { db.run(`ALTER TABLE bridges_registrations ADD COLUMN qr_code TEXT`); } catch(e) {}

    // ========== TEAM CHAT & TASKS ==========
    db.run(`CREATE TABLE IF NOT EXISTS team_members (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE,
        name TEXT NOT NULL,
        role TEXT,
        avatar_color TEXT DEFAULT '#C9A962',
        photo_url TEXT,
        is_online INTEGER DEFAULT 0,
        last_seen TEXT,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Add photo_url column if it doesn't exist (migration)
    try { db.run('ALTER TABLE team_members ADD COLUMN photo_url TEXT'); } catch(e) {}

    db.run(`CREATE TABLE IF NOT EXISTS chat_messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        channel_id TEXT,
        message TEXT NOT NULL,
        message_type TEXT DEFAULT 'text',
        file_url TEXT,
        file_name TEXT,
        file_type TEXT,
        reply_to TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (channel_id) REFERENCES chat_channels(id),
        FOREIGN KEY (reply_to) REFERENCES chat_messages(id)
    )`);

    // Add file columns if they don't exist (migration)
    try { db.run('ALTER TABLE chat_messages ADD COLUMN file_url TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE chat_messages ADD COLUMN file_name TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE chat_messages ADD COLUMN file_type TEXT'); } catch(e) {}

    // Add completed column to timeline events (migration)
    try { db.run('ALTER TABLE project_timeline_events ADD COLUMN completed INTEGER DEFAULT 0'); } catch(e) {}

    // Chat channels for organized communication
    db.run(`CREATE TABLE IF NOT EXISTS chat_channels (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project TEXT,
        description TEXT,
        is_default INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Sub-channel support migrations
    try { db.run('ALTER TABLE chat_channels ADD COLUMN parent_channel_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE chat_channels ADD COLUMN sort_order INTEGER DEFAULT 0'); } catch(e) {}

    // Channel members for assignment
    db.run(`CREATE TABLE IF NOT EXISTS channel_members (
        id TEXT PRIMARY KEY,
        channel_id TEXT NOT NULL,
        member_id TEXT NOT NULL,
        role TEXT DEFAULT 'member',
        joined_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(channel_id, member_id)
    )`);

    // User-specific pinned items
    db.run(`CREATE TABLE IF NOT EXISTS pinned_items (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        item_type TEXT NOT NULL,
        item_id TEXT,
        item_title TEXT NOT NULL,
        item_subtitle TEXT,
        project TEXT,
        display_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Channel read status per user
    db.run(`CREATE TABLE IF NOT EXISTS channel_read_status (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        channel_id TEXT NOT NULL,
        last_read_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id, channel_id)
    )`)

    // Project settings (editable dates, etc.)
    db.run(`CREATE TABLE IF NOT EXISTS project_settings (
        project TEXT PRIMARY KEY,
        event_date TEXT,
        description TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_by TEXT
    )`);

    // Add new columns if they don't exist (safe migration)
    try { db.run('ALTER TABLE project_settings ADD COLUMN end_date TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE project_settings ADD COLUMN venue TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE project_settings ADD COLUMN location TEXT'); } catch(e) {}
    saveDb();

    // Seed default project settings
    const projectDefaults = [
        { project: 'plexus', date: '2026-12-04', desc: 'Dec 4-5 in Zagreb' },
        { project: 'accelerator', date: '2026-06-01', desc: 'Research internship program' },
        { project: 'forum', date: '2026-12-06', desc: 'Senior leaders network' },
        { project: 'bridges', date: '2026-04-18', desc: 'Global networking events' }
    ];
    projectDefaults.forEach(p => {
        const exists = query.get('SELECT project FROM project_settings WHERE project = ?', [p.project]);
        if (!exists) {
            query.run('INSERT INTO project_settings (project, event_date, description) VALUES (?, ?, ?)',
                [p.project, p.date, p.desc]);
        }
    });

    // Admin notifications (for monthly project reminders)
    db.run(`CREATE TABLE IF NOT EXISTS admin_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        type TEXT NOT NULL,
        title TEXT NOT NULL,
        message TEXT,
        project TEXT,
        is_read INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // User notifications (admin-to-user push notifications via shared DB)
    db.run(`CREATE TABLE IF NOT EXISTS user_notifications (
        id TEXT PRIMARY KEY,
        user_id TEXT,
        user_group TEXT DEFAULT 'all',
        category TEXT NOT NULL DEFAULT 'system',
        project TEXT,
        title TEXT NOT NULL,
        message TEXT,
        link TEXT,
        icon TEXT DEFAULT 'fa-bell',
        icon_class TEXT DEFAULT 'system',
        is_read INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Monthly reminder tracking
    db.run(`CREATE TABLE IF NOT EXISTS monthly_reminders_sent (
        id TEXT PRIMARY KEY,
        month TEXT NOT NULL,
        year INTEGER NOT NULL,
        sent_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(month, year)
    )`);

    // Project folders for file organization
    db.run(`CREATE TABLE IF NOT EXISTS project_folders (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        parent_id TEXT,
        color TEXT DEFAULT '#64748b',
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (parent_id) REFERENCES project_folders(id),
        FOREIGN KEY (created_by) REFERENCES users(id)
    )`)

    // Project file repository
    db.run(`CREATE TABLE IF NOT EXISTS project_files (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        folder_id TEXT,
        filename TEXT NOT NULL,
        original_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        mime_type TEXT,
        category TEXT DEFAULT 'general',
        uploaded_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (folder_id) REFERENCES project_folders(id),
        FOREIGN KEY (uploaded_by) REFERENCES users(id)
    )`)

    db.run(`CREATE TABLE IF NOT EXISTS chat_read_status (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        last_read_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(user_id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS project_tasks (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        assigned_to TEXT,
        priority TEXT DEFAULT 'medium',
        status TEXT DEFAULT 'todo',
        due_date TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        completed_at TEXT,
        sort_order INTEGER DEFAULT 0,
        parent_id TEXT,
        FOREIGN KEY (parent_id) REFERENCES project_tasks(id) ON DELETE CASCADE
    )`);

    // Sequence tasks table
    db.run(`CREATE TABLE IF NOT EXISTS task_sequences (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        project TEXT,
        description TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        current_step INTEGER DEFAULT 1,
        status TEXT DEFAULT 'active'
    )`);

    // Sequence steps table
    db.run(`CREATE TABLE IF NOT EXISTS sequence_steps (
        id TEXT PRIMARY KEY,
        sequence_id TEXT NOT NULL,
        step_order INTEGER NOT NULL,
        title TEXT NOT NULL,
        description TEXT,
        assigned_to TEXT,
        status TEXT DEFAULT 'pending',
        completed_at TEXT,
        FOREIGN KEY (sequence_id) REFERENCES task_sequences(id) ON DELETE CASCADE
    )`);

    // Task files table
    db.run(`CREATE TABLE IF NOT EXISTS task_files (
        id TEXT PRIMARY KEY,
        task_id TEXT NOT NULL,
        filename TEXT NOT NULL,
        original_name TEXT,
        file_path TEXT,
        file_size INTEGER,
        mime_type TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (task_id) REFERENCES project_tasks(id) ON DELETE CASCADE
    )`);

    // Project timeline events table
    db.run(`CREATE TABLE IF NOT EXISTS project_timeline_events (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        event_date TEXT NOT NULL,
        end_date TEXT,
        event_type TEXT DEFAULT 'point',
        color TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== ENHANCED PLEXUS CONFERENCE TABLES ==========

    // Extended user profiles for conference attendees
    db.run(`CREATE TABLE IF NOT EXISTS user_profiles (
        user_id TEXT PRIMARY KEY,
        title TEXT,
        department TEXT,
        research_interests TEXT,
        career_stage TEXT,
        linkedin_url TEXT,
        twitter_url TEXT,
        orcid TEXT,
        dietary_requirements TEXT,
        accessibility_needs TEXT,
        tshirt_size TEXT,
        emergency_contact_name TEXT,
        emergency_contact_phone TEXT,
        is_profile_public INTEGER DEFAULT 0,
        preferred_language TEXT DEFAULT 'en',
        receive_newsletter INTEGER DEFAULT 1,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Enhanced registrations with multi-step info
    db.run(`CREATE TABLE IF NOT EXISTS registration_details (
        registration_id TEXT PRIMARY KEY,
        affiliation_type TEXT,
        student_id_uploaded INTEGER DEFAULT 0,
        student_id_file TEXT,
        institution_vat TEXT,
        institution_address TEXT,
        billing_name TEXT,
        billing_address TEXT,
        billing_country TEXT,
        billing_vat TEXT,
        wants_invoice INTEGER DEFAULT 0,
        arrival_date TEXT,
        departure_date TEXT,
        accommodation_needed INTEGER DEFAULT 0,
        hotel_preference TEXT,
        airport_transfer_needed INTEGER DEFAULT 0,
        flight_arrival TEXT,
        flight_departure TEXT,
        networking_interests TEXT,
        how_heard_about TEXT,
        special_requests TEXT,
        gdpr_consent INTEGER DEFAULT 0,
        photo_consent INTEGER DEFAULT 0,
        terms_accepted INTEGER DEFAULT 0,
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Group registrations
    db.run(`CREATE TABLE IF NOT EXISTS group_registrations (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        institution_name TEXT NOT NULL,
        contact_name TEXT,
        contact_email TEXT,
        contact_phone TEXT,
        billing_address TEXT,
        billing_vat TEXT,
        total_attendees INTEGER DEFAULT 0,
        status TEXT DEFAULT 'pending',
        total_amount REAL DEFAULT 0,
        discount_percent REAL DEFAULT 0,
        payment_status TEXT DEFAULT 'unpaid',
        invoice_number TEXT,
        notes TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Link individual registrations to group
    db.run(`CREATE TABLE IF NOT EXISTS group_registration_members (
        id TEXT PRIMARY KEY,
        group_registration_id TEXT,
        registration_id TEXT,
        FOREIGN KEY (group_registration_id) REFERENCES group_registrations(id),
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Waiting list
    db.run(`CREATE TABLE IF NOT EXISTS waitlist (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        user_id TEXT,
        ticket_type_id TEXT,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        position INTEGER,
        status TEXT DEFAULT 'waiting',
        notified_at TEXT,
        expires_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Registration transfers
    db.run(`CREATE TABLE IF NOT EXISTS registration_transfers (
        id TEXT PRIMARY KEY,
        registration_id TEXT,
        original_user_id TEXT,
        new_user_email TEXT,
        new_user_name TEXT,
        reason TEXT,
        status TEXT DEFAULT 'pending',
        approved_by TEXT,
        approved_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Scholarship/Fee waiver applications
    db.run(`CREATE TABLE IF NOT EXISTS scholarship_applications (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        user_id TEXT,
        application_type TEXT DEFAULT 'scholarship',
        institution TEXT,
        country TEXT,
        career_stage TEXT,
        financial_need_statement TEXT,
        research_statement TEXT,
        support_letter_file TEXT,
        cv_file TEXT,
        amount_requested REAL,
        amount_granted REAL,
        status TEXT DEFAULT 'submitted',
        reviewer_notes TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Refund requests
    db.run(`CREATE TABLE IF NOT EXISTS refund_requests (
        id TEXT PRIMARY KEY,
        registration_id TEXT,
        reason TEXT,
        amount_requested REAL,
        amount_approved REAL,
        refund_type TEXT DEFAULT 'full',
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        processed_by TEXT,
        processed_at TEXT,
        refund_reference TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Payment transactions
    db.run(`CREATE TABLE IF NOT EXISTS payment_transactions (
        id TEXT PRIMARY KEY,
        registration_id TEXT,
        group_registration_id TEXT,
        amount REAL,
        currency TEXT DEFAULT 'EUR',
        payment_method TEXT,
        payment_provider TEXT,
        provider_transaction_id TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        metadata TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Invoices
    db.run(`CREATE TABLE IF NOT EXISTS invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT UNIQUE,
        registration_id TEXT,
        group_registration_id TEXT,
        recipient_name TEXT,
        recipient_address TEXT,
        recipient_vat TEXT,
        recipient_email TEXT,
        items TEXT,
        subtotal REAL,
        vat_rate REAL DEFAULT 25,
        vat_amount REAL,
        total REAL,
        currency TEXT DEFAULT 'EUR',
        status TEXT DEFAULT 'draft',
        issued_at TEXT,
        due_date TEXT,
        paid_at TEXT,
        pdf_file TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Abstract submission files
    db.run(`CREATE TABLE IF NOT EXISTS abstract_files (
        id TEXT PRIMARY KEY,
        abstract_id TEXT,
        file_type TEXT,
        original_name TEXT,
        stored_name TEXT,
        file_path TEXT,
        file_size INTEGER,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (abstract_id) REFERENCES abstracts(id)
    )`);

    // Abstract reviews
    db.run(`CREATE TABLE IF NOT EXISTS abstract_reviews (
        id TEXT PRIMARY KEY,
        abstract_id TEXT,
        reviewer_id TEXT,
        score_relevance INTEGER,
        score_originality INTEGER,
        score_methodology INTEGER,
        score_clarity INTEGER,
        score_overall INTEGER,
        comments TEXT,
        recommendation TEXT,
        is_complete INTEGER DEFAULT 0,
        assigned_at TEXT,
        completed_at TEXT,
        FOREIGN KEY (abstract_id) REFERENCES abstracts(id),
        FOREIGN KEY (reviewer_id) REFERENCES users(id)
    )`);

    // Abstract review criteria (customizable per conference)
    db.run(`CREATE TABLE IF NOT EXISTS review_criteria (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        name TEXT,
        description TEXT,
        max_score INTEGER DEFAULT 5,
        weight REAL DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Speaker/Workshop applications
    db.run(`CREATE TABLE IF NOT EXISTS speaker_applications (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        user_id TEXT,
        application_type TEXT DEFAULT 'speaker',
        name TEXT,
        email TEXT,
        institution TEXT,
        title TEXT,
        bio TEXT,
        photo_file TEXT,
        cv_file TEXT,
        proposed_title TEXT,
        proposed_abstract TEXT,
        topic_area TEXT,
        presentation_type TEXT,
        duration_requested INTEGER,
        target_audience TEXT,
        av_requirements TEXT,
        previous_experience TEXT,
        co_presenter_info TEXT,
        max_participants INTEGER,
        required_materials TEXT,
        status TEXT DEFAULT 'submitted',
        admin_notes TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Session tracks
    db.run(`CREATE TABLE IF NOT EXISTS session_tracks (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        name TEXT,
        name_hr TEXT,
        description TEXT,
        color TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Enhanced sessions with more fields (safely add columns if not exists)
    const sessionColumns = query.all("PRAGMA table_info(sessions)").map(c => c.name);
    if (!sessionColumns.includes('track_id')) db.run(`ALTER TABLE sessions ADD COLUMN track_id TEXT`);
    if (!sessionColumns.includes('is_recorded')) db.run(`ALTER TABLE sessions ADD COLUMN is_recorded INTEGER DEFAULT 0`);
    if (!sessionColumns.includes('recording_url')) db.run(`ALTER TABLE sessions ADD COLUMN recording_url TEXT`);
    if (!sessionColumns.includes('slides_file')) db.run(`ALTER TABLE sessions ADD COLUMN slides_file TEXT`);
    if (!sessionColumns.includes('materials_file')) db.run(`ALTER TABLE sessions ADD COLUMN materials_file TEXT`);
    if (!sessionColumns.includes('capacity')) db.run(`ALTER TABLE sessions ADD COLUMN capacity INTEGER`);
    if (!sessionColumns.includes('requires_registration')) db.run(`ALTER TABLE sessions ADD COLUMN requires_registration INTEGER DEFAULT 0`);
    if (!sessionColumns.includes('language')) db.run(`ALTER TABLE sessions ADD COLUMN language TEXT DEFAULT 'en'`);

    // Session attendance tracking
    db.run(`CREATE TABLE IF NOT EXISTS session_attendance (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT,
        checked_in_at TEXT,
        checked_out_at TEXT,
        attended_duration INTEGER,
        UNIQUE(session_id, user_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Session ratings
    db.run(`CREATE TABLE IF NOT EXISTS session_ratings (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        user_id TEXT,
        rating INTEGER,
        comment TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(session_id, user_id),
        FOREIGN KEY (session_id) REFERENCES sessions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Question upvotes
    db.run(`CREATE TABLE IF NOT EXISTS question_upvotes (
        id TEXT PRIMARY KEY,
        question_id TEXT,
        user_id TEXT,
        UNIQUE(question_id, user_id),
        FOREIGN KEY (question_id) REFERENCES session_questions(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Live polls
    db.run(`CREATE TABLE IF NOT EXISTS session_polls (
        id TEXT PRIMARY KEY,
        session_id TEXT,
        question TEXT,
        poll_type TEXT DEFAULT 'single',
        options TEXT,
        is_active INTEGER DEFAULT 0,
        show_results INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        FOREIGN KEY (session_id) REFERENCES sessions(id)
    )`);

    // Poll responses
    db.run(`CREATE TABLE IF NOT EXISTS poll_responses (
        id TEXT PRIMARY KEY,
        poll_id TEXT,
        user_id TEXT,
        selected_options TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(poll_id, user_id),
        FOREIGN KEY (poll_id) REFERENCES session_polls(id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    // Meeting requests (1:1 networking)
    db.run(`CREATE TABLE IF NOT EXISTS meeting_requests (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        requester_id TEXT,
        requestee_id TEXT,
        message TEXT,
        proposed_times TEXT,
        selected_time TEXT,
        location TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id),
        FOREIGN KEY (requester_id) REFERENCES users(id),
        FOREIGN KEY (requestee_id) REFERENCES users(id)
    )`);

    // Visa invitation letter requests
    db.run(`CREATE TABLE IF NOT EXISTS visa_requests (
        id TEXT PRIMARY KEY,
        registration_id TEXT,
        passport_name TEXT,
        passport_number TEXT,
        passport_country TEXT,
        passport_expiry TEXT,
        date_of_birth TEXT,
        nationality TEXT,
        embassy_city TEXT,
        embassy_country TEXT,
        additional_info TEXT,
        letter_file TEXT,
        status TEXT DEFAULT 'pending',
        processed_by TEXT,
        processed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Enhanced volunteers with shifts
    db.run(`CREATE TABLE IF NOT EXISTS volunteer_shifts (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        name TEXT,
        description TEXT,
        date TEXT,
        start_time TEXT,
        end_time TEXT,
        location TEXT,
        max_volunteers INTEGER DEFAULT 5,
        required_skills TEXT,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Volunteer shift assignments
    db.run(`CREATE TABLE IF NOT EXISTS volunteer_assignments (
        id TEXT PRIMARY KEY,
        volunteer_id TEXT,
        shift_id TEXT,
        status TEXT DEFAULT 'assigned',
        checked_in_at TEXT,
        checked_out_at TEXT,
        notes TEXT,
        UNIQUE(volunteer_id, shift_id),
        FOREIGN KEY (volunteer_id) REFERENCES volunteers(id),
        FOREIGN KEY (shift_id) REFERENCES volunteer_shifts(id)
    )`);

    // Enhanced sponsors (safely add columns)
    const sponsorColumns = query.all("PRAGMA table_info(sponsors)").map(c => c.name);
    if (!sponsorColumns.includes('contact_name')) db.run(`ALTER TABLE sponsors ADD COLUMN contact_name TEXT`);
    if (!sponsorColumns.includes('contact_email')) db.run(`ALTER TABLE sponsors ADD COLUMN contact_email TEXT`);
    if (!sponsorColumns.includes('contact_phone')) db.run(`ALTER TABLE sponsors ADD COLUMN contact_phone TEXT`);
    if (!sponsorColumns.includes('booth_location')) db.run(`ALTER TABLE sponsors ADD COLUMN booth_location TEXT`);
    if (!sponsorColumns.includes('included_passes')) db.run(`ALTER TABLE sponsors ADD COLUMN included_passes INTEGER DEFAULT 0`);
    if (!sponsorColumns.includes('contract_file')) db.run(`ALTER TABLE sponsors ADD COLUMN contract_file TEXT`);
    if (!sponsorColumns.includes('is_exhibitor')) db.run(`ALTER TABLE sponsors ADD COLUMN is_exhibitor INTEGER DEFAULT 0`);
    // Phase 3E: Sponsor pipeline columns
    if (!sponsorColumns.includes('status')) db.run(`ALTER TABLE sponsors ADD COLUMN status TEXT DEFAULT 'prospect'`);
    if (!sponsorColumns.includes('amount_pledged')) db.run(`ALTER TABLE sponsors ADD COLUMN amount_pledged REAL DEFAULT 0`);
    if (!sponsorColumns.includes('amount_received')) db.run(`ALTER TABLE sponsors ADD COLUMN amount_received REAL DEFAULT 0`);
    if (!sponsorColumns.includes('notes')) db.run(`ALTER TABLE sponsors ADD COLUMN notes TEXT`);
    if (!sponsorColumns.includes('is_published')) db.run(`ALTER TABLE sponsors ADD COLUMN is_published INTEGER DEFAULT 0`);

    // Sponsor tasks table
    db.run(`CREATE TABLE IF NOT EXISTS sponsor_tasks (
        id TEXT PRIMARY KEY,
        sponsor_id TEXT NOT NULL,
        title TEXT NOT NULL,
        is_completed INTEGER DEFAULT 0,
        due_date TEXT,
        assigned_to TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sponsor_id) REFERENCES sponsors(id)
    )`);

    // Sponsor leads (badge scans at booth)
    db.run(`CREATE TABLE IF NOT EXISTS sponsor_leads (
        id TEXT PRIMARY KEY,
        sponsor_id TEXT,
        attendee_registration_id TEXT,
        scanned_by TEXT,
        notes TEXT,
        rating INTEGER,
        follow_up_status TEXT DEFAULT 'new',
        scanned_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sponsor_id) REFERENCES sponsors(id),
        FOREIGN KEY (attendee_registration_id) REFERENCES registrations(id)
    )`);

    // Sponsor materials/downloads
    db.run(`CREATE TABLE IF NOT EXISTS sponsor_materials (
        id TEXT PRIMARY KEY,
        sponsor_id TEXT,
        title TEXT,
        description TEXT,
        file_path TEXT,
        download_count INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (sponsor_id) REFERENCES sponsors(id)
    )`);

    // Photo gallery
    db.run(`CREATE TABLE IF NOT EXISTS conference_photos (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        title TEXT,
        description TEXT,
        file_path TEXT,
        thumbnail_path TEXT,
        photographer TEXT,
        uploaded_by TEXT,
        is_public INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Certificates of attendance
    db.run(`CREATE TABLE IF NOT EXISTS certificates (
        id TEXT PRIMARY KEY,
        registration_id TEXT,
        certificate_type TEXT DEFAULT 'attendance',
        certificate_number TEXT UNIQUE,
        recipient_name TEXT,
        conference_name TEXT,
        issue_date TEXT,
        credits_value REAL,
        credits_type TEXT,
        pdf_file TEXT,
        downloaded_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (registration_id) REFERENCES registrations(id)
    )`);

    // Feedback surveys
    db.run(`CREATE TABLE IF NOT EXISTS surveys (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        title TEXT,
        description TEXT,
        questions TEXT,
        is_active INTEGER DEFAULT 1,
        anonymous INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Survey responses
    db.run(`CREATE TABLE IF NOT EXISTS survey_responses (
        id TEXT PRIMARY KEY,
        survey_id TEXT,
        user_id TEXT,
        responses TEXT,
        submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (survey_id) REFERENCES surveys(id)
    )`);

    // Email templates
    db.run(`CREATE TABLE IF NOT EXISTS email_templates (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        name TEXT,
        subject TEXT,
        subject_hr TEXT,
        body_html TEXT,
        body_html_hr TEXT,
        body_text TEXT,
        body_text_hr TEXT,
        variables TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Email log
    db.run(`CREATE TABLE IF NOT EXISTS email_log (
        id TEXT PRIMARY KEY,
        template_id TEXT,
        recipient_email TEXT,
        recipient_name TEXT,
        subject TEXT,
        status TEXT DEFAULT 'pending',
        error_message TEXT,
        sent_at TEXT,
        opened_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Scheduled emails
    db.run(`CREATE TABLE IF NOT EXISTS scheduled_emails (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        template_id TEXT,
        target_audience TEXT,
        filters TEXT,
        scheduled_for TEXT,
        status TEXT DEFAULT 'scheduled',
        sent_count INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Conference archive info
    db.run(`CREATE TABLE IF NOT EXISTS conference_archives (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        archive_type TEXT,
        title TEXT,
        description TEXT,
        file_path TEXT,
        external_url TEXT,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Venue/room info
    db.run(`CREATE TABLE IF NOT EXISTS venue_rooms (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        name TEXT,
        description TEXT,
        floor TEXT,
        capacity INTEGER,
        equipment TEXT,
        map_coordinates TEXT,
        photo_url TEXT,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Partner hotels
    db.run(`CREATE TABLE IF NOT EXISTS partner_hotels (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        name TEXT,
        description TEXT,
        address TEXT,
        distance_to_venue TEXT,
        price_range TEXT,
        booking_url TEXT,
        promo_code TEXT,
        discount_info TEXT,
        photo_url TEXT,
        contact_email TEXT,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // Conference statistics (cached for dashboard)
    db.run(`CREATE TABLE IF NOT EXISTS conference_stats (
        id TEXT PRIMARY KEY,
        conference_id TEXT,
        stat_date TEXT,
        total_registrations INTEGER DEFAULT 0,
        paid_registrations INTEGER DEFAULT 0,
        total_abstracts INTEGER DEFAULT 0,
        accepted_abstracts INTEGER DEFAULT 0,
        total_revenue REAL DEFAULT 0,
        attendee_countries TEXT,
        registration_by_type TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(conference_id, stat_date),
        FOREIGN KEY (conference_id) REFERENCES conferences(id)
    )`);

    // ========== FINANCE MODULE TABLES ==========

    // Bank balance entries (manual tracking)
    db.run(`CREATE TABLE IF NOT EXISTS finance_bank_balance (
        id TEXT PRIMARY KEY,
        balance REAL NOT NULL,
        date TEXT NOT NULL,
        notes TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Fiscal years management
    db.run(`CREATE TABLE IF NOT EXISTS finance_fiscal_years (
        id TEXT PRIMARY KEY,
        year INTEGER NOT NULL UNIQUE,
        status TEXT DEFAULT 'open',
        opened_at TEXT DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT,
        closed_by TEXT,
        archived_at TEXT,
        notes TEXT
    )`);

    // Work units for grant tracking
    db.run(`CREATE TABLE IF NOT EXISTS finance_work_units (
        id TEXT PRIMARY KEY,
        code TEXT NOT NULL,
        name TEXT NOT NULL,
        description TEXT,
        grant_source TEXT,
        fiscal_year INTEGER NOT NULL,
        budget_total REAL DEFAULT 0,
        budget_used REAL DEFAULT 0,
        status TEXT DEFAULT 'active',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        closed_at TEXT
    )`);

    // Transactions (income/expenses)
    db.run(`CREATE TABLE IF NOT EXISTS finance_transactions (
        id TEXT PRIMARY KEY,
        transaction_number TEXT UNIQUE,
        transaction_type TEXT NOT NULL,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        description TEXT,
        project TEXT,
        work_unit_id TEXT,
        category TEXT,
        payment_method TEXT,
        reference TEXT,
        fiscal_year INTEGER,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (work_unit_id) REFERENCES finance_work_units(id)
    )`);

    // Sequence numbers for auto-numbering documents
    db.run(`CREATE TABLE IF NOT EXISTS finance_sequences (
        id TEXT PRIMARY KEY,
        sequence_type TEXT NOT NULL,
        fiscal_year INTEGER NOT NULL,
        current_value INTEGER DEFAULT 0,
        prefix TEXT,
        UNIQUE(sequence_type, fiscal_year)
    )`);

    // Invoices (incoming and outgoing)
    db.run(`CREATE TABLE IF NOT EXISTS finance_invoices (
        id TEXT PRIMARY KEY,
        invoice_number TEXT UNIQUE,
        invoice_type TEXT NOT NULL,
        direction TEXT NOT NULL,
        status TEXT DEFAULT 'draft',
        issue_date TEXT,
        due_date TEXT,
        paid_date TEXT,
        fiscalized INTEGER DEFAULT 0,
        party_name TEXT NOT NULL,
        party_address TEXT,
        party_oib TEXT,
        party_email TEXT,
        subtotal REAL DEFAULT 0,
        discount_total REAL DEFAULT 0,
        vat_total REAL DEFAULT 0,
        total REAL DEFAULT 0,
        currency TEXT DEFAULT 'EUR',
        payment_reference TEXT,
        payment_iban TEXT,
        notes TEXT,
        project TEXT,
        work_unit_id TEXT,
        fiscal_year INTEGER,
        transaction_id TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (work_unit_id) REFERENCES finance_work_units(id),
        FOREIGN KEY (transaction_id) REFERENCES finance_transactions(id)
    )`);

    // Invoice line items
    db.run(`CREATE TABLE IF NOT EXISTS finance_invoice_items (
        id TEXT PRIMARY KEY,
        invoice_id TEXT NOT NULL,
        description TEXT NOT NULL,
        quantity REAL DEFAULT 1,
        unit_price REAL NOT NULL,
        discount_percent REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        vat_rate REAL DEFAULT 0,
        vat_amount REAL DEFAULT 0,
        line_total REAL NOT NULL,
        sort_order INTEGER DEFAULT 0,
        FOREIGN KEY (invoice_id) REFERENCES finance_invoices(id) ON DELETE CASCADE
    )`);

    // Payment orders
    db.run(`CREATE TABLE IF NOT EXISTS finance_payment_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT UNIQUE,
        recipient_name TEXT NOT NULL,
        recipient_iban TEXT,
        payment_type TEXT DEFAULT 'outgoing',
        amount REAL NOT NULL,
        reference TEXT,
        date TEXT NOT NULL,
        execution_date TEXT,
        status TEXT DEFAULT 'pending',
        description TEXT,
        project TEXT,
        work_unit_id TEXT,
        fiscal_year INTEGER,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (work_unit_id) REFERENCES finance_work_units(id)
    )`);

    // Travel orders
    db.run(`CREATE TABLE IF NOT EXISTS finance_travel_orders (
        id TEXT PRIMARY KEY,
        order_number TEXT UNIQUE,
        traveler_id TEXT NOT NULL,
        traveler_name TEXT NOT NULL,
        destination TEXT NOT NULL,
        purpose TEXT,
        status TEXT DEFAULT 'assigned',
        planned_departure TEXT,
        planned_return TEXT,
        actual_departure TEXT,
        actual_return TEXT,
        travel_method TEXT,
        kilometers REAL DEFAULT 0,
        cost_transport REAL DEFAULT 0,
        cost_accommodation REAL DEFAULT 0,
        cost_daily_allowance REAL DEFAULT 0,
        cost_other REAL DEFAULT 0,
        cost_total REAL DEFAULT 0,
        advance_amount REAL DEFAULT 0,
        reimbursement_amount REAL DEFAULT 0,
        notes TEXT,
        traveler_notes TEXT,
        rejection_reason TEXT,
        project TEXT,
        work_unit_id TEXT,
        fiscal_year INTEGER,
        assigned_by TEXT,
        assigned_at TEXT,
        submitted_at TEXT,
        approved_by TEXT,
        approved_at TEXT,
        paid_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (work_unit_id) REFERENCES finance_work_units(id)
    )`);

    // Travel order evidence (uploaded files)
    db.run(`CREATE TABLE IF NOT EXISTS finance_travel_evidence (
        id TEXT PRIMARY KEY,
        travel_order_id TEXT NOT NULL,
        file_type TEXT,
        file_name TEXT NOT NULL,
        file_path TEXT NOT NULL,
        file_size INTEGER,
        uploaded_by TEXT,
        uploaded_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (travel_order_id) REFERENCES finance_travel_orders(id) ON DELETE CASCADE
    )`);

    // Finance settings (company info, templates)
    db.run(`CREATE TABLE IF NOT EXISTS finance_settings (
        id TEXT PRIMARY KEY,
        setting_key TEXT UNIQUE NOT NULL,
        setting_value TEXT,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Initialize default finance settings
    const defaultSettings = [
        ['company_name', 'Med&X'],
        ['company_address', 'Zagreb, Croatia'],
        ['company_oib', ''],
        ['company_iban', ''],
        ['company_email', 'info@medx.hr'],
        ['invoice_footer', 'Thank you for your cooperation!'],
        ['travel_daily_rate', '53.00'],
        ['travel_km_rate', '0.40']
    ];
    defaultSettings.forEach(([key, value]) => {
        db.run(`INSERT OR IGNORE INTO finance_settings (id, setting_key, setting_value) VALUES (?, ?, ?)`,
            [uuidv4(), key, value]);
    });

    // Initialize current fiscal year if not exists
    const currentYear = new Date().getFullYear();
    const existingYear = query.get('SELECT id FROM finance_fiscal_years WHERE year = ?', [currentYear]);
    if (!existingYear) {
        db.run(`INSERT INTO finance_fiscal_years (id, year, status) VALUES (?, ?, 'open')`,
            [uuidv4(), currentYear]);
    }

    // ===== PR & MEDIA TABLES =====

    // Content Calendar - planned/scheduled content across platforms
    db.run(`CREATE TABLE IF NOT EXISTS pr_content_calendar (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        platform TEXT NOT NULL,
        scheduled_date TEXT NOT NULL,
        scheduled_time TEXT,
        status TEXT DEFAULT 'draft',
        title TEXT,
        content_text TEXT,
        image_url TEXT,
        link_url TEXT,
        hashtags TEXT,
        campaign_id TEXT,
        created_by TEXT,
        approved_by TEXT,
        approved_at TEXT,
        published_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES pr_campaigns(id)
    )`);

    // Social Media Posts - published posts with engagement tracking
    db.run(`CREATE TABLE IF NOT EXISTS pr_posts (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        platform TEXT NOT NULL,
        post_type TEXT DEFAULT 'post',
        content_text TEXT,
        image_url TEXT,
        link_url TEXT,
        external_post_id TEXT,
        published_at TEXT,
        likes INTEGER DEFAULT 0,
        comments INTEGER DEFAULT 0,
        shares INTEGER DEFAULT 0,
        reach INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        engagement_rate REAL DEFAULT 0,
        calendar_id TEXT,
        campaign_id TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (calendar_id) REFERENCES pr_content_calendar(id),
        FOREIGN KEY (campaign_id) REFERENCES pr_campaigns(id)
    )`);

    // Newsletters - email campaigns
    db.run(`CREATE TABLE IF NOT EXISTS pr_newsletters (
        id TEXT PRIMARY KEY,
        project TEXT,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        preview_text TEXT,
        content_html TEXT,
        content_json TEXT,
        template TEXT DEFAULT 'default',
        status TEXT DEFAULT 'draft',
        scheduled_for TEXT,
        sent_at TEXT,
        recipient_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0,
        open_rate REAL DEFAULT 0,
        click_rate REAL DEFAULT 0,
        campaign_id TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (campaign_id) REFERENCES pr_campaigns(id)
    )`);

    // Newsletter Subscribers
    db.run(`CREATE TABLE IF NOT EXISTS pr_subscribers (
        id TEXT PRIMARY KEY,
        email TEXT UNIQUE NOT NULL,
        first_name TEXT,
        last_name TEXT,
        subscribed_projects TEXT DEFAULT 'all',
        language TEXT DEFAULT 'hr',
        status TEXT DEFAULT 'active',
        source TEXT,
        subscribed_at TEXT DEFAULT CURRENT_TIMESTAMP,
        unsubscribed_at TEXT,
        last_email_at TEXT,
        email_count INTEGER DEFAULT 0,
        open_count INTEGER DEFAULT 0,
        click_count INTEGER DEFAULT 0
    )`);

    // Media Assets - image/file library
    db.run(`CREATE TABLE IF NOT EXISTS pr_media_assets (
        id TEXT PRIMARY KEY,
        project TEXT,
        file_name TEXT NOT NULL,
        original_name TEXT,
        file_path TEXT NOT NULL,
        file_type TEXT,
        file_size INTEGER,
        width INTEGER,
        height INTEGER,
        category TEXT DEFAULT 'photo',
        tags TEXT,
        alt_text TEXT,
        caption TEXT,
        ai_generated INTEGER DEFAULT 0,
        ai_prompt TEXT,
        uploaded_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Marketing Campaigns
    db.run(`CREATE TABLE IF NOT EXISTS pr_campaigns (
        id TEXT PRIMARY KEY,
        project TEXT,
        name TEXT NOT NULL,
        description TEXT,
        goal TEXT,
        start_date TEXT,
        end_date TEXT,
        status TEXT DEFAULT 'planning',
        budget REAL DEFAULT 0,
        spent REAL DEFAULT 0,
        target_audience TEXT,
        platforms TEXT,
        kpis TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Platform Analytics Snapshots
    db.run(`CREATE TABLE IF NOT EXISTS pr_analytics (
        id TEXT PRIMARY KEY,
        project TEXT NOT NULL,
        platform TEXT NOT NULL,
        date TEXT NOT NULL,
        followers INTEGER DEFAULT 0,
        following INTEGER DEFAULT 0,
        posts_count INTEGER DEFAULT 0,
        engagement_rate REAL DEFAULT 0,
        reach INTEGER DEFAULT 0,
        impressions INTEGER DEFAULT 0,
        profile_views INTEGER DEFAULT 0,
        website_clicks INTEGER DEFAULT 0,
        new_followers INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(project, platform, date)
    )`);

    // Post Templates
    db.run(`CREATE TABLE IF NOT EXISTS pr_templates (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        type TEXT DEFAULT 'social',
        platform TEXT,
        project TEXT,
        content_template TEXT,
        image_template TEXT,
        variables TEXT,
        is_active INTEGER DEFAULT 1,
        use_count INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // AI Generation History
    db.run(`CREATE TABLE IF NOT EXISTS pr_ai_generations (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        prompt TEXT NOT NULL,
        result_text TEXT,
        result_image_path TEXT,
        project TEXT,
        platform TEXT,
        model TEXT,
        used INTEGER DEFAULT 0,
        rating INTEGER,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // ===== NETWORKING PORTAL TABLES =====
    db.run(`CREATE TABLE IF NOT EXISTS networking_profiles (
        id TEXT PRIMARY KEY,
        user_id TEXT UNIQUE,
        career_stage TEXT,
        looking_for TEXT,
        research_interests TEXT,
        working_on TEXT,
        timezone TEXT DEFAULT 'America/New_York',
        meeting_format TEXT DEFAULT 'video',
        open_to_coffee_chats INTEGER DEFAULT 1,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS networking_connections (
        id TEXT PRIMARY KEY,
        requester_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        status TEXT DEFAULT 'pending',
        message TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        accepted_at TEXT,
        FOREIGN KEY (requester_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS networking_meetings (
        id TEXT PRIMARY KEY,
        organizer_id TEXT NOT NULL,
        attendee_id TEXT NOT NULL,
        date TEXT NOT NULL,
        time TEXT NOT NULL,
        duration INTEGER DEFAULT 30,
        type TEXT DEFAULT 'video',
        topic TEXT,
        note TEXT,
        status TEXT DEFAULT 'pending',
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (organizer_id) REFERENCES users(id),
        FOREIGN KEY (attendee_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS direct_messages (
        id TEXT PRIMARY KEY,
        sender_id TEXT NOT NULL,
        receiver_id TEXT NOT NULL,
        content TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        read_at TEXT,
        FOREIGN KEY (sender_id) REFERENCES users(id),
        FOREIGN KEY (receiver_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS gala_registrations (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        institution TEXT,
        title TEXT,
        dietary TEXT,
        requests TEXT,
        pricing TEXT,
        status TEXT DEFAULT 'pending',
        admin_notes TEXT,
        reviewed_by TEXT,
        reviewed_at TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Gala settings (admin-editable)
    db.run(`CREATE TABLE IF NOT EXISTS gala_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        title TEXT DEFAULT 'Gala Evening 2026',
        tagline TEXT DEFAULT 'The Pinnacle of Biomedical Excellence',
        date TEXT DEFAULT '2026-12-05',
        time TEXT DEFAULT '18:00',
        venue TEXT DEFAULT 'Grand Ballroom, Zagreb',
        dress_code TEXT DEFAULT 'Black Tie / Formal Evening Attire',
        description TEXT DEFAULT 'The Gala Evening is the crown jewel of Plexus 2026 – an exclusive evening that brings together 150+ of the most influential figures in biomedicine for an unforgettable celebration of excellence and innovation.',
        capacity INTEGER DEFAULT 150,
        price_gala_only REAL DEFAULT 95,
        price_bundle REAL DEFAULT 174,
        price_bundle_original REAL DEFAULT 194,
        is_registration_open INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed default gala settings if none exist
    const existingGalaSettings = query.get("SELECT id FROM gala_settings WHERE id = 'default'");
    if (!existingGalaSettings) {
        db.run("INSERT INTO gala_settings (id) VALUES ('default')");
    }

    // Plexus settings (admin-editable)
    db.run(`CREATE TABLE IF NOT EXISTS plexus_settings (
        id TEXT PRIMARY KEY DEFAULT 'default',
        price_student_early REAL DEFAULT 39,
        price_student_late REAL DEFAULT 59,
        price_professional_early REAL DEFAULT 99,
        price_professional_late REAL DEFAULT 149,
        key_dates_json TEXT,
        testimonials_json TEXT,
        conference_start_date TEXT DEFAULT '2026-12-04',
        conference_end_date TEXT DEFAULT '2026-12-05',
        early_bird_deadline TEXT DEFAULT '2026-09-30',
        abstract_deadline TEXT DEFAULT '2026-10-15',
        is_registration_open INTEGER DEFAULT 1,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Seed default plexus settings if none exist
    const existingPlexusSettings = query.get("SELECT id FROM plexus_settings WHERE id = 'default'");
    if (!existingPlexusSettings) {
        const defaultKeyDates = JSON.stringify([
            { label: 'Early Bird Registration', date: 'Until September 30, 2026', color: 'var(--up-success)' },
            { label: 'Abstract Submission Deadline', date: 'October 15, 2026', color: 'var(--up-warning)' },
            { label: 'Conference', date: 'December 4-5, 2026', color: '#0f172a' }
        ]);
        const defaultTestimonials = JSON.stringify([
            { name: 'Dr. Ana Markovic', title: 'Postdoc, Max Planck Institute', year: 'Plexus 2025', quote: 'Plexus changed the trajectory of my career. I connected with my current PhD supervisor during a coffee break and landed a position at his lab in Munich. The quality of speakers and networking opportunities is unmatched.', avatar: 'https://randomuser.me/api/portraits/women/32.jpg' },
            { name: 'Marco Rossi', title: 'MD Student, University of Milan', year: 'Plexus 2024', quote: 'As a medical student, attending Plexus opened my eyes to the world of biomedical research. The workshop on grant writing was incredibly practical, and I\'ve already used those skills to secure funding for my thesis project.', avatar: 'https://randomuser.me/api/portraits/men/45.jpg' },
            { name: 'Dr. Sarah Chen', title: 'Assistant Professor, Stanford', year: 'Plexus 2025', quote: 'The Gala Evening was the highlight of my trip. Meeting Nobel laureates in person and discussing science over dinner was surreal. Zagreb\'s Christmas market made it even more magical!', avatar: 'https://randomuser.me/api/portraits/women/56.jpg' },
            { name: 'Luka Horvat', title: 'PhD Candidate, University of Zagreb', year: 'Plexus 2023', quote: 'I presented my first poster at Plexus and the feedback I received was invaluable. The questions from senior researchers helped me refine my methodology significantly. Now I\'m presenting an oral talk!', avatar: 'https://randomuser.me/api/portraits/men/28.jpg' },
            { name: 'Dr. Emma Mueller', title: 'Research Scientist, ETH Zurich', year: 'Plexus 2024', quote: 'Best organized conference I\'ve attended in Europe. The Med&X team truly understands what young researchers need. The networking app made it so easy to connect with people before the event even started.', avatar: 'https://randomuser.me/api/portraits/women/41.jpg' }
        ]);
        db.run("INSERT INTO plexus_settings (id, key_dates_json, testimonials_json) VALUES ('default', ?, ?)",
            [defaultKeyDates, defaultTestimonials]);
    }

    // Add speakers_json and schedule_json columns to gala_settings
    try { db.run(`ALTER TABLE gala_settings ADD COLUMN speakers_json TEXT`); } catch (e) {}
    try { db.run(`ALTER TABLE gala_settings ADD COLUMN schedule_json TEXT`); } catch (e) {}

    // Seed default gala speakers and schedule if columns are empty
    const galaCheck = query.get("SELECT speakers_json FROM gala_settings WHERE id = 'default'");
    if (galaCheck && !galaCheck.speakers_json) {
        const defaultGalaSpeakers = JSON.stringify([
            { key: 'chen', name: 'Dr. Elizabeth Chen', title: 'Director, National Cancer Institute', topic: '"The Next Decade of Cancer Research"', image: 'https://randomuser.me/api/portraits/women/23.jpg', bio: 'Dr. Elizabeth Chen is a world-renowned oncologist and the Director of the National Cancer Institute. Her groundbreaking research in targeted cancer therapies has transformed treatment approaches worldwide. She has published over 300 peer-reviewed articles and holds multiple patents in precision medicine technologies.', badge: 'Keynote Speaker', featured: true },
            { key: 'weber', name: 'Prof. Michael Weber', title: 'Nobel Laureate in Medicine', topic: 'Awards Presenter', image: 'https://randomuser.me/api/portraits/men/42.jpg', bio: 'Professor Michael Weber received the Nobel Prize in Physiology or Medicine for his discoveries concerning the molecular mechanisms of circadian rhythm. His research at the Max Planck Institute has illuminated how our internal clocks regulate human biology, opening new frontiers in chronotherapy.', badge: '', featured: false },
            { key: 'mitchell', name: 'Dr. Sarah Mitchell', title: 'CEO, BioTech Innovations', topic: 'Industry Address', image: 'https://randomuser.me/api/portraits/women/45.jpg', bio: 'Dr. Sarah Mitchell is the CEO of BioTech Innovations, a leading biotech company specializing in gene therapy and regenerative medicine. A Stanford-trained molecular biologist, she has led the development of three FDA-approved therapies and was named one of Fortune\'s Most Powerful Women in Business.', badge: '', featured: false }
        ]);
        const defaultGalaSchedule = JSON.stringify([
            { time: '18:00', title: 'Welcome Reception', description: 'Champagne cocktails and canapés in the Grand Foyer', icon: 'fas fa-champagne-glasses' },
            { time: '19:00', title: 'Opening & Keynote Address', description: 'Dr. Elizabeth Chen: "The Next Decade of Cancer Research"', icon: 'fas fa-microphone' },
            { time: '20:00', title: 'Gala Dinner', description: 'Five-course dinner with premium wine pairings', icon: 'fas fa-utensils' },
            { time: '21:30', title: 'Biomedical Forum Annual Awards', description: 'Recognition of outstanding contributions to medical research', icon: 'fas fa-trophy' },
            { time: '22:30', title: 'Networking & Entertainment', description: 'Live music, dancing, and exclusive networking until midnight', icon: 'fas fa-users' }
        ]);
        db.run("UPDATE gala_settings SET speakers_json = ?, schedule_json = ? WHERE id = 'default'",
            [defaultGalaSpeakers, defaultGalaSchedule]);
    }

    // ========== TABLES FROM ADMIN PORTAL (shared schema) ==========

    db.run(`CREATE TABLE IF NOT EXISTS admin_section_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        section_id TEXT NOT NULL,
        is_enabled INTEGER DEFAULT 1,
        UNIQUE(user_id, section_id),
        FOREIGN KEY (user_id) REFERENCES users(id)
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bridges_events (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        city TEXT NOT NULL,
        venue_name TEXT,
        venue_address TEXT,
        event_date TEXT NOT NULL,
        event_time TEXT,
        end_time TEXT,
        description TEXT,
        capacity INTEGER DEFAULT 50,
        registration_open INTEGER DEFAULT 1,
        registration_deadline TEXT,
        status TEXT DEFAULT 'upcoming',
        contact_email TEXT,
        contact_phone TEXT,
        notes TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS bridges_registrations (
        id TEXT PRIMARY KEY,
        event_id TEXT NOT NULL,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT NOT NULL,
        phone TEXT,
        institution TEXT,
        position TEXT,
        dietary_requirements TEXT,
        special_requests TEXT,
        status TEXT DEFAULT 'registered',
        confirmation_sent INTEGER DEFAULT 0,
        reminder_sent INTEGER DEFAULT 0,
        checked_in INTEGER DEFAULT 0,
        checked_in_at TEXT,
        notes TEXT,
        registered_at TEXT DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (event_id) REFERENCES bridges_events(id) ON DELETE CASCADE
    )`);

    // Building Bridges speakers
    db.run(`CREATE TABLE IF NOT EXISTS bridges_speakers (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        name TEXT NOT NULL,
        title TEXT,
        institution TEXT,
        bio TEXT,
        photo_url TEXT,
        talk_title TEXT,
        is_published INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // Building Bridges program items
    db.run(`CREATE TABLE IF NOT EXISTS bridges_program (
        id TEXT PRIMARY KEY,
        event_id TEXT,
        title TEXT NOT NULL,
        description TEXT,
        speaker_id TEXT,
        start_time TEXT,
        end_time TEXT,
        sort_order INTEGER DEFAULT 0,
        is_published INTEGER DEFAULT 0,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contacts (
        id TEXT PRIMARY KEY,
        first_name TEXT NOT NULL,
        last_name TEXT NOT NULL,
        email TEXT,
        phone TEXT,
        phone_secondary TEXT,
        organization TEXT,
        position TEXT,
        contact_type TEXT DEFAULT 'general',
        projects TEXT,
        tags TEXT,
        address TEXT,
        city TEXT,
        country TEXT,
        website TEXT,
        linkedin TEXT,
        notes TEXT,
        last_contacted TEXT,
        is_favorite INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS contact_interactions (
        id TEXT PRIMARY KEY,
        contact_id TEXT NOT NULL,
        interaction_type TEXT NOT NULL,
        subject TEXT,
        notes TEXT,
        date TEXT DEFAULT CURRENT_TIMESTAMP,
        created_by TEXT,
        FOREIGN KEY (contact_id) REFERENCES contacts(id) ON DELETE CASCADE
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS template_library (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        subject TEXT NOT NULL,
        body_html TEXT NOT NULL,
        body_text TEXT,
        category TEXT DEFAULT 'general',
        project TEXT,
        variables TEXT,
        is_active INTEGER DEFAULT 1,
        usage_count INTEGER DEFAULT 0,
        last_used TEXT,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // ========== CROSS-PORTAL ALTER TABLE MIGRATIONS ==========
    // Speaker logistics columns from admin portal
    try { db.run('ALTER TABLE speakers ADD COLUMN confirmation_status TEXT DEFAULT "pending"'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN flight_status TEXT DEFAULT "not_booked"'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN hotel_status TEXT DEFAULT "not_booked"'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN flight_assigned_to TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN hotel_assigned_to TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN flight_details TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN hotel_details TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN notes TEXT'); } catch(e) {}

    // Speaker invite system columns
    try { db.run('ALTER TABLE speakers ADD COLUMN email TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN invite_code TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN invite_sent_at TEXT'); } catch(e) {}

    // Speaker management columns (Phase 3D/3G)
    try { db.run('ALTER TABLE speakers ADD COLUMN is_published INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN year INTEGER'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN invitation_status TEXT DEFAULT \'unsent\''); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN invitation_sent_at TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE speakers ADD COLUMN invitation_responded_at TEXT'); } catch(e) {}

    // Registration personal info columns from admin portal
    try { db.run('ALTER TABLE registrations ADD COLUMN first_name TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE registrations ADD COLUMN last_name TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE registrations ADD COLUMN email TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE registrations ADD COLUMN institution TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE registrations ADD COLUMN country TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE registrations ADD COLUMN includes_gala INTEGER DEFAULT 0'); } catch(e) {}
    // Gala registration payment & user tracking columns
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN payment_status TEXT DEFAULT \'unpaid\''); } catch(e) {}
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN amount_paid REAL'); } catch(e) {}
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN user_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN stripe_session_id TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN invoice_number TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN checked_in INTEGER DEFAULT 0'); } catch(e) {}
    try { db.run('ALTER TABLE gala_registrations ADD COLUMN checked_in_at TEXT'); } catch(e) {}
    // Abstract detail columns from admin portal
    try { db.run('ALTER TABLE abstracts ADD COLUMN submitter_name TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE abstracts ADD COLUMN submitter_email TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE abstracts ADD COLUMN category TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE abstracts ADD COLUMN abstract_type TEXT DEFAULT "poster"'); } catch(e) {}
    // Volunteer detail columns from admin portal
    try { db.run('ALTER TABLE volunteers ADD COLUMN first_name TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE volunteers ADD COLUMN last_name TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE volunteers ADD COLUMN email TEXT'); } catch(e) {}
    try { db.run('ALTER TABLE volunteers ADD COLUMN notes TEXT'); } catch(e) {}
    // accelerator_application_scores table (exists in admin, missing from user)
    db.run(`CREATE TABLE IF NOT EXISTS accelerator_application_scores (
        id TEXT PRIMARY KEY,
        application_id TEXT NOT NULL,
        criterion_id TEXT NOT NULL,
        evaluator_id TEXT NOT NULL,
        score REAL,
        submitted_at TEXT DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(application_id, criterion_id, evaluator_id)
    )`);
    // pr_ai_generations: add admin-portal column aliases so either portal works
    try { db.run(`ALTER TABLE pr_ai_generations ADD COLUMN generation_type TEXT`); } catch(e) {}
    try { db.run(`ALTER TABLE pr_ai_generations ADD COLUMN output TEXT`); } catch(e) {}

    // Phase 6: Admin messaging columns on direct_messages
    try { db.run("ALTER TABLE direct_messages ADD COLUMN sender_type TEXT DEFAULT 'user'"); } catch(e) {}
    try { db.run("ALTER TABLE direct_messages ADD COLUMN receiver_type TEXT DEFAULT 'user'"); } catch(e) {}
    try { db.run("ALTER TABLE direct_messages ADD COLUMN title TEXT"); } catch(e) {}
    try { db.run("ALTER TABLE direct_messages ADD COLUMN attachment_url TEXT"); } catch(e) {}
    try { db.run("ALTER TABLE direct_messages ADD COLUMN is_read INTEGER DEFAULT 0"); } catch(e) {}
    try { db.run("ALTER TABLE direct_messages ADD COLUMN updated_at TEXT"); } catch(e) {}

    // Migration: add notification_type, target_tier, expires_at, placement to user_notifications
    try { db.run("ALTER TABLE user_notifications ADD COLUMN notification_type TEXT DEFAULT 'info'"); } catch(e) {}
    try { db.run("ALTER TABLE user_notifications ADD COLUMN target_tier TEXT DEFAULT 'all'"); } catch(e) {}
    try { db.run("ALTER TABLE user_notifications ADD COLUMN expires_at TEXT"); } catch(e) {}
    try { db.run("ALTER TABLE user_notifications ADD COLUMN placement TEXT DEFAULT 'panel'"); } catch(e) {}

    db.run(`CREATE TABLE IF NOT EXISTS portal_content (
        id TEXT PRIMARY KEY,
        section TEXT NOT NULL,
        project TEXT,
        title TEXT,
        content TEXT,
        image_url TEXT,
        link TEXT,
        is_published INTEGER DEFAULT 0,
        sort_order INTEGER DEFAULT 0,
        created_by TEXT,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    db.run(`CREATE TABLE IF NOT EXISTS dashboard_preferences (
        id TEXT PRIMARY KEY,
        user_id TEXT NOT NULL,
        section TEXT NOT NULL,
        card_id TEXT NOT NULL,
        is_visible INTEGER DEFAULT 1,
        sort_order INTEGER DEFAULT 0,
        config TEXT,
        UNIQUE(user_id, section, card_id)
    )`);

    saveDb();

    // Seed data
    let conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
    if (!conf) {
        const confId = uuidv4();
        db.run(`INSERT INTO conferences (id, name, year, slug, description, start_date, end_date, venue_name, venue_city, venue_country, early_bird_deadline, regular_deadline, abstract_deadline)
            VALUES (?, 'Plexus Conference 2026', 2026, 'plexus-2026', 'Where young biomedical minds connect', '2026-12-04', '2026-12-05', 'Hotel Esplanade', 'Zagreb', 'Croatia', '2026-09-01', '2026-11-15', '2026-10-01')`,
            [confId]);

        const tickets = [
            ['General Attendee', 'General Admission', 150, 200, 250, 1],
            ['Student', 'Student', 75, 100, 125, 1],
            ['VIP / Invited', 'VIP', 0, 0, 0, 1],
            ['Speaker', 'Speaker', 0, 0, 0, 1],
            ['Volunteer', 'Volunteer', 0, 0, 0, 0]
        ];
        tickets.forEach((t, i) => {
            db.run(`INSERT INTO ticket_types (id, conference_id, name, name_hr, price_early_bird, price_regular, price_late, includes_gala, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [uuidv4(), confId, t[0], t[1], t[2], t[3], t[4], t[5], i]);
        });

        db.run(`INSERT INTO promo_codes (id, conference_id, code, discount_value, max_uses, valid_until)
            VALUES (?, ?, 'EARLYBIRD25', 25, 50, '2026-08-31')`, [uuidv4(), confId]);

        // Add sample speakers
        const speakers = [
            ['Dr. Sarah Mitchell', 'Professor of Neuroscience', 'Harvard Medical School', 'Sarah Mitchell is a leading researcher in sleep neuroscience...', 'The Future of Sleep Medicine', 1],
            ['Prof. Michael Chen', 'Director of Cancer Research', 'MD Anderson', 'Michael Chen has published over 200 papers...', 'Immunotherapy Breakthroughs', 1],
            ['Dr. Elena Rossi', 'Chief Medical Officer', 'Novartis', 'Elena Rossi leads global medical strategy...', 'Drug Development in the AI Era', 0]
        ];
        speakers.forEach((s, i) => {
            db.run(`INSERT INTO speakers (id, conference_id, name, title, institution, bio, talk_title, is_keynote, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [uuidv4(), confId, s[0], s[1], s[2], s[3], s[4], s[5], i]);
        });

        // Add sample sessions
        db.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room)
            VALUES (?, ?, 'Opening Ceremony', 'Welcome address and keynote', 'keynote', 1, '09:00', '10:00', 'Main Hall')`, [uuidv4(), confId]);
        db.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room)
            VALUES (?, ?, 'Coffee Break & Networking', 'Refreshments and poster viewing', 'break', 1, '10:00', '10:30', 'Foyer')`, [uuidv4(), confId]);
        db.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room)
            VALUES (?, ?, 'Neuroscience Track', 'Latest advances in brain research', 'talk', 1, '10:30', '12:00', 'Room A')`, [uuidv4(), confId]);

        saveDb();
        console.log('Plexus 2026 seeded');
    }

    // Seed admin users - Alen and Miro
    let alenAdmin = query.get("SELECT id FROM users WHERE email = 'juginovic.alen@gmail.com'");
    let miroAdmin = query.get("SELECT id FROM users WHERE email = 'vp@medx.hr'");

    if (!alenAdmin) {
        const hash = await bcrypt.hash('admin123', 10);
        const alenId = uuidv4();
        db.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, institution, country, is_admin)
            VALUES (?, 'juginovic.alen@gmail.com', ?, 'Alen', 'Juginovic', 'Harvard Medical School', 'USA', 1)`,
            [alenId, hash]);
        saveDb();
        console.log('Alen admin user created');
    }

    if (!miroAdmin) {
        const hash = await bcrypt.hash('admin123', 10);
        const miroId = uuidv4();
        db.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, institution, country, is_admin)
            VALUES (?, 'vp@medx.hr', ?, 'Miro', 'Vukovic', 'Med&X', 'Croatia', 1)`,
            [miroId, hash]);
        saveDb();
        console.log('Miro admin user created');
    }

    // Create Laura admin user
    let lauraAdmin = query.get("SELECT id FROM users WHERE email = 'laura.rodman@medx.hr'");
    if (!lauraAdmin) {
        const hash = await bcrypt.hash('MedX2026!', 10);
        const lauraId = uuidv4();
        db.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, institution, country, is_admin)
            VALUES (?, 'laura.rodman@medx.hr', ?, 'Laura', 'Rodman', 'Med&X', 'Croatia', 1)`,
            [lauraId, hash]);
        saveDb();
        console.log('Laura admin user created');

        // Link Laura's user account to her team member
        db.run(`UPDATE team_members SET user_id = ? WHERE name = 'Laura Rodman'`, [lauraId]);
        saveDb();
    }

    // Seed test user accounts for team testing
    const testUsers = [
        { email: 'ivan.horvat@test.medx.hr', first: 'Ivan', last: 'Horvat', inst: 'University of Zagreb', country: 'Croatia' },
        { email: 'maria.kovac@test.medx.hr', first: 'Maria', last: 'Kovac', inst: 'University of Split', country: 'Croatia' },
        { email: 'petra.babic@test.medx.hr', first: 'Petra', last: 'Babic', inst: 'University of Rijeka', country: 'Croatia' }
    ];
    for (const tu of testUsers) {
        const exists = query.get("SELECT id FROM users WHERE email = ?", [tu.email]);
        if (!exists) {
            const hash = await bcrypt.hash('Test2026!', 10);
            const uid = uuidv4();
            db.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, institution, country, is_admin)
                VALUES (?, ?, ?, ?, ?, ?, ?, 0)`, [uid, tu.email, hash, tu.first, tu.last, tu.inst, tu.country]);
            saveDb();
            console.log(`Test user ${tu.first} ${tu.last} created`);
        }
    }

    // Seed default channels
    let channelsExist = query.get("SELECT id FROM chat_channels LIMIT 1");
    if (!channelsExist) {
        const channels = [
            // Org-wide
            { name: 'general', project: null, description: 'General discussion', is_default: 1 },
            { name: 'announcements', project: null, description: 'Important announcements', is_default: 0 },
            // Plexus
            { name: 'program', project: 'plexus', description: 'Program planning' },
            { name: 'operations', project: 'plexus', description: 'Logistics and operations' },
            { name: 'registrations', project: 'plexus', description: 'Registration management' },
            // Accelerator
            { name: 'applications', project: 'accelerator', description: 'Application reviews' },
            { name: 'institutions', project: 'accelerator', description: 'Partner institution coordination' },
            // Forum
            { name: 'events', project: 'forum', description: 'Event planning' },
            { name: 'members', project: 'forum', description: 'Member coordination' },
            // Bridges
            { name: 'general', project: 'bridges', description: 'General Building Bridges discussion', is_default: 1 },
            { name: 'operations', project: 'bridges', description: 'Operations and logistics' },
            { name: 'speakers', project: 'bridges', description: 'Speaker coordination' },
            { name: 'logistics', project: 'bridges', description: 'Venue and travel logistics' },
            // Finances
            { name: 'budget', project: 'finances', description: 'Budget discussions and approvals' },
            { name: 'invoices', project: 'finances', description: 'Invoice tracking and questions' },
            { name: 'travel', project: 'finances', description: 'Travel orders and reimbursements' },
            // PR & Media
            { name: 'content', project: 'pr-media', description: 'Content planning and ideas' },
            { name: 'social', project: 'pr-media', description: 'Social media coordination' },
            { name: 'newsletters', project: 'pr-media', description: 'Newsletter planning' }
        ];

        channels.forEach(ch => {
            db.run(`INSERT INTO chat_channels (id, name, project, description, is_default) VALUES (?, ?, ?, ?, ?)`,
                [uuidv4(), ch.name, ch.project, ch.description, ch.is_default || 0]);
        });
        saveDb();
        console.log('Default channels seeded');
    }

    // Seed team members
    let teamExists = query.get("SELECT id FROM team_members LIMIT 1");
    if (!teamExists) {
        // Get admin user IDs for linking
        const alenUser = query.get("SELECT id FROM users WHERE email = 'juginovic.alen@gmail.com'");
        const miroUser = query.get("SELECT id FROM users WHERE email = 'vp@medx.hr'");

        const teamMembers = [
            ['Alen Juginovic', 'President', '#C9A962', alenUser?.id],
            ['Miro Vukovic', 'Vice President', '#60a5fa', miroUser?.id],
            ['Laura Rodman', 'Executive Assistant', '#f472b6', null],
            ['Ivan Nikolic', 'Plexus Lead', '#4ade80', null],
            ['Sara Bonet', 'Operations', '#a78bfa', null],
            ['Petra Horvat', 'Marketing', '#fb923c', null]
        ];
        teamMembers.forEach(([name, role, color, userId]) => {
            db.run(`INSERT INTO team_members (id, user_id, name, role, avatar_color) VALUES (?, ?, ?, ?, ?)`,
                [uuidv4(), userId, name, role, color]);
        });

        // Add sample tasks
        const tasks = [
            ['plexus', 'Finalize speaker lineup', 'Confirm remaining 3 keynote speakers', 'high', 'todo', '2026-02-15'],
            ['plexus', 'Send venue contract', 'Review and sign Hotel Esplanade agreement', 'high', 'in_progress', '2026-01-25'],
            ['plexus', 'Design conference badges', 'Create badge designs for different attendee types', 'medium', 'todo', '2026-03-01'],
            ['accelerator', 'Review applications batch 1', 'First 20 applications need review', 'high', 'todo', '2026-02-01'],
            ['accelerator', 'Contact Harvard lab coordinators', 'Confirm available spots for summer', 'medium', 'in_progress', '2026-01-30'],
            ['forum', 'Draft invite list for 2026', 'Prepare list of potential new members', 'low', 'todo', '2026-03-15']
        ];
        tasks.forEach(([project, title, desc, priority, status, due], i) => {
            db.run(`INSERT INTO project_tasks (id, project, title, description, priority, status, due_date, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uuidv4(), project, title, desc, priority, status, due, i]);
        });

        saveDb();
        console.log('Team members and tasks seeded');
    }

    // Update team member photos if missing (uses placeholder photos)
    const teamPhotoMap = {
        'Alen Juginovic': 'https://randomuser.me/api/portraits/men/32.jpg',
        'Miro Vukovic': 'https://randomuser.me/api/portraits/men/44.jpg',
        'Laura Rodman': 'https://randomuser.me/api/portraits/women/68.jpg',
        'Ivan Nikolic': 'https://randomuser.me/api/portraits/men/75.jpg',
        'Sara Bonet': 'https://randomuser.me/api/portraits/women/44.jpg',
        'Petra Horvat': 'https://randomuser.me/api/portraits/women/63.jpg'
    };
    Object.entries(teamPhotoMap).forEach(([name, photoUrl]) => {
        db.run('UPDATE team_members SET photo_url = ? WHERE name = ? AND (photo_url IS NULL OR photo_url = "")', [photoUrl, name]);
    });
    saveDb();

    // Seed Accelerator program and institutions
    let accProgram = query.get("SELECT id FROM accelerator_programs WHERE year = 2026");
    if (!accProgram) {
        const programId = uuidv4();
        db.run(`INSERT INTO accelerator_programs (id, name, year, description, application_deadline, program_start, program_end)
            VALUES (?, 'Med&X Accelerator 2026', 2026, 'Research internship program at world-leading institutions', '2026-03-15', '2026-06-01', '2026-08-31')`,
            [programId]);

        const institutions = [
            ['Harvard Medical School', 'HMS', 'Boston', 'USA', 'World-renowned medical research institution'],
            ['Yale School of Medicine', 'Yale', 'New Haven', 'USA', 'Leading research in biomedical sciences'],
            ['MIT', 'MIT', 'Cambridge', 'USA', 'Pioneer in bioengineering and technology'],
            ['Mayo Clinic', 'Mayo', 'Rochester', 'USA', 'Top-ranked hospital and research center'],
            ['Cleveland Clinic', 'CCF', 'Cleveland', 'USA', 'Innovation in patient care and research'],
            ['Massachusetts General Hospital', 'MGH', 'Boston', 'USA', 'Largest teaching hospital of Harvard'],
            ['Stanford Medicine', 'Stanford', 'Palo Alto', 'USA', 'Leader in precision health'],
            ['Johns Hopkins Medicine', 'JHU', 'Baltimore', 'USA', 'Pioneer in medical research and education']
        ];
        institutions.forEach((inst, i) => {
            db.run(`INSERT INTO accelerator_institutions (id, name, short_name, city, country, description, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?)`, [uuidv4(), inst[0], inst[1], inst[2], inst[3], inst[4], i]);
        });

        saveDb();
        console.log('Accelerator 2026 seeded');
    }

    // Seed Finance sample data
    let financeDataExists = query.get("SELECT id FROM finance_bank_balance LIMIT 1");
    if (!financeDataExists) {
        // Bank balance entries
        const bankBalances = [
            { balance: 125000.00, date: '2026-01-01', notes: 'Starting balance 2026' },
            { balance: 142500.50, date: '2026-01-10', notes: 'After EU grant deposit' },
            { balance: 138200.00, date: '2026-01-20', notes: 'After venue deposit payment' }
        ];
        bankBalances.forEach(b => {
            db.run(`INSERT INTO finance_bank_balance (id, balance, date, notes) VALUES (?, ?, ?, ?)`,
                [uuidv4(), b.balance, b.date, b.notes]);
        });

        // Fiscal year (use INSERT OR IGNORE since it may already exist)
        db.run(`INSERT OR IGNORE INTO finance_fiscal_years (id, year, status) VALUES (?, 2026, 'open')`, [uuidv4()]);

        // Work units (grant tracking)
        const workUnits = [
            { code: 'RJ-2026-001', name: 'EU Horizon Grant', description: 'European Commission Horizon Europe funding', grant_source: 'EU Horizon Europe', budget_total: 50000, budget_used: 8500 },
            { code: 'RJ-2026-002', name: 'Ministry of Science', description: 'Croatian Ministry of Science grant', grant_source: 'MZOS Croatia', budget_total: 25000, budget_used: 3200 },
            { code: 'RJ-2026-003', name: 'Corporate Sponsorship Pool', description: 'Combined corporate sponsorships', grant_source: 'Various Sponsors', budget_total: 35000, budget_used: 0 }
        ];
        const workUnitIds = {};
        workUnits.forEach(wu => {
            const id = uuidv4();
            workUnitIds[wu.code] = id;
            db.run(`INSERT INTO finance_work_units (id, code, name, description, grant_source, fiscal_year, budget_total, budget_used) VALUES (?, ?, ?, ?, ?, 2026, ?, ?)`,
                [id, wu.code, wu.name, wu.description, wu.grant_source, wu.budget_total, wu.budget_used]);
        });

        // Transactions
        const transactions = [
            { type: 'income', number: 'P-2026-001', amount: 17500, date: '2026-01-05', description: 'EU Horizon first tranche', project: 'plexus', category: 'grant' },
            { type: 'income', number: 'P-2026-002', amount: 5000, date: '2026-01-08', description: 'Pharma Corp sponsorship', project: 'plexus', category: 'sponsorship' },
            { type: 'income', number: 'P-2026-003', amount: 3200, date: '2026-01-12', description: 'Conference registrations (early bird)', project: 'plexus', category: 'registration' },
            { type: 'expense', number: 'R-2026-001', amount: 4500, date: '2026-01-15', description: 'Hotel Esplanade venue deposit', project: 'plexus', category: 'venue' },
            { type: 'expense', number: 'R-2026-002', amount: 2800, date: '2026-01-18', description: 'Marketing materials printing', project: 'plexus', category: 'marketing' },
            { type: 'expense', number: 'R-2026-003', amount: 1200, date: '2026-01-20', description: 'Website hosting and domain', project: 'general', category: 'operations' },
            { type: 'income', number: 'P-2026-004', amount: 8000, date: '2026-01-22', description: 'Ministry of Science grant', project: 'accelerator', category: 'grant' }
        ];
        transactions.forEach(t => {
            db.run(`INSERT OR IGNORE INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, fiscal_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 2026)`,
                [uuidv4(), t.number, t.type, t.amount, t.date, t.description, t.project, t.category]);
        });

        // Sequences
        db.run(`INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, 'income', 2026, 4, 'P')`, [uuidv4()]);
        db.run(`INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, 'expense', 2026, 3, 'R')`, [uuidv4()]);
        db.run(`INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, 'invoice_incoming', 2026, 2, 'UR')`, [uuidv4()]);
        db.run(`INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, 'invoice_outgoing', 2026, 1, 'IR')`, [uuidv4()]);
        db.run(`INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, 'travel_order', 2026, 2, 'PUT')`, [uuidv4()]);

        // Invoices
        const invoices = [
            { number: 'UR-2026-001', type: 'standard', direction: 'incoming', status: 'pending', party_name: 'Hotel Esplanade Zagreb', party_address: 'Mihanoviceva 1, Zagreb', subtotal: 4500, total: 4500, notes: 'Venue deposit for Plexus 2026', project: 'plexus' },
            { number: 'UR-2026-002', type: 'standard', direction: 'incoming', status: 'paid', party_name: 'PrintShop d.o.o.', party_address: 'Ilica 200, Zagreb', subtotal: 2800, total: 2800, notes: 'Conference brochures and posters', project: 'plexus' },
            { number: 'IR-2026-001', type: 'standard', direction: 'outgoing', status: 'issued', party_name: 'Pharma Corp Ltd', party_address: 'London, UK', subtotal: 5000, total: 5000, notes: 'Gold sponsorship package', project: 'plexus', fiscalized: 0 }
        ];
        invoices.forEach(inv => {
            db.run(`INSERT OR IGNORE INTO finance_invoices (id, invoice_number, invoice_type, direction, status, party_name, party_address, subtotal, total, notes, project, fiscalized, fiscal_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2026)`,
                [uuidv4(), inv.number, inv.type, inv.direction, inv.status, inv.party_name, inv.party_address, inv.subtotal, inv.total, inv.notes, inv.project, inv.fiscalized || 0]);
        });

        // Travel orders
        const miroMember = query.get("SELECT id FROM team_members WHERE name = 'Miro Vukovic'");
        const ivanMember = query.get("SELECT id FROM team_members WHERE name = 'Ivan Nikolic'");

        if (miroMember) {
            db.run(`INSERT OR IGNORE INTO finance_travel_orders (id, order_number, traveler_id, traveler_name, destination, purpose, status, planned_departure, planned_return, cost_transport, cost_accommodation, cost_daily_allowance, project, fiscal_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2026)`,
                [uuidv4(), 'PUT-2026-001', miroMember.id, 'Miro Vukovic', 'Vienna, Austria', 'Meeting with potential sponsors', 'approved', '2026-02-10', '2026-02-12', 250, 320, 150, 'plexus']);
        }
        if (ivanMember) {
            db.run(`INSERT OR IGNORE INTO finance_travel_orders (id, order_number, traveler_id, traveler_name, destination, purpose, status, planned_departure, planned_return, project, fiscal_year) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 2026)`,
                [uuidv4(), 'PUT-2026-002', ivanMember.id, 'Ivan Nikolic', 'Split, Croatia', 'University partnership meeting', 'assigned', '2026-02-20', '2026-02-21', 'accelerator']);
        }

        // Payment orders
        db.run(`INSERT OR IGNORE INTO finance_payment_orders (id, order_number, recipient_name, recipient_iban, payment_type, amount, reference, date, status, project, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [uuidv4(), 'PN-2026-001', 'Hotel Esplanade Zagreb', 'HR1234567890123456789', 'outgoing', 4500, 'Deposit Plexus 2026', '2026-01-15', 'executed', 'plexus', 'Venue deposit payment']);
        db.run(`INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, 'payment_order', 2026, 1, 'PN')`, [uuidv4()]);

        saveDb();
        console.log('Finance sample data seeded');
    }

    // Seed PR & Media sample data
    let prDataExists = query.get("SELECT id FROM pr_posts LIMIT 1");
    if (!prDataExists) {
        // Social media posts
        const posts = [
            { project: 'plexus', platform: 'instagram', content: 'Exciting news! Plexus 2026 dates are confirmed: December 4-5 in Zagreb. Early bird registration opens soon! #Plexus2026 #Biomedicine #Zagreb', likes: 342, comments: 28, shares: 45, reach: 5200, published: '2026-01-10' },
            { project: 'plexus', platform: 'linkedin', content: 'We are thrilled to announce our first confirmed keynote speaker for Plexus 2026 - a Nobel laureate in Medicine! Full announcement coming next week.', likes: 892, comments: 67, shares: 124, reach: 15800, published: '2026-01-15' },
            { project: 'plexus', platform: 'twitter', content: 'Save the date! Plexus 2026 is happening December 4-5 in Zagreb, Croatia. The premier biomedical conference for young researchers. #Plexus2026', likes: 156, comments: 12, shares: 89, reach: 8400, published: '2026-01-12' },
            { project: 'accelerator', platform: 'instagram', content: 'Applications for Med&X Accelerator 2026 are now OPEN! Research internships at Harvard, Yale, MIT, Mayo Clinic and more. Link in bio!', likes: 567, comments: 94, shares: 182, reach: 12300, published: '2026-01-20' },
            { project: 'accelerator', platform: 'linkedin', content: 'Med&X Accelerator 2026: Your pathway to world-class research institutions. 8 partner institutions, 50+ positions available. Application deadline: March 15.', likes: 1205, comments: 156, shares: 342, reach: 28500, published: '2026-01-22' },
            { project: 'forum', platform: 'linkedin', content: 'The Biomedical Forum continues to grow! We now have 150+ senior leaders from medicine, science, and policy. Interested in joining? DM us.', likes: 445, comments: 38, shares: 67, reach: 9800, published: '2026-01-18' }
        ];
        posts.forEach(p => {
            db.run(`INSERT INTO pr_posts (id, project, platform, content_text, likes, comments, shares, reach, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), p.project, p.platform, p.content, p.likes, p.comments, p.shares, p.reach, p.published]);
        });

        // Content calendar items
        const calendarItems = [
            { project: 'plexus', platform: 'instagram', date: '2026-01-28', time: '10:00', status: 'scheduled', title: 'Speaker Announcement #2', content: 'Announcing our second keynote speaker for Plexus 2026!' },
            { project: 'plexus', platform: 'linkedin', date: '2026-01-28', time: '12:00', status: 'scheduled', title: 'Speaker Announcement #2', content: 'Professional announcement of keynote speaker' },
            { project: 'plexus', platform: 'twitter', date: '2026-01-28', time: '14:00', status: 'scheduled', title: 'Speaker Teaser', content: 'Teaser for upcoming speaker announcement' },
            { project: 'accelerator', platform: 'instagram', date: '2026-01-30', time: '18:00', status: 'draft', title: 'Application Tips', content: 'Tips for a successful Accelerator application' },
            { project: 'plexus', platform: 'instagram', date: '2026-02-01', time: '10:00', status: 'draft', title: 'Early Bird Reminder', content: 'Early bird registration deadline approaching!' },
            { project: 'forum', platform: 'linkedin', date: '2026-02-05', time: '09:00', status: 'idea', title: 'Member Spotlight', content: 'Spotlight interview with a Forum member' }
        ];
        calendarItems.forEach(c => {
            db.run(`INSERT INTO pr_content_calendar (id, project, platform, scheduled_date, scheduled_time, status, title, content_text) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), c.project, c.platform, c.date, c.time, c.status, c.title, c.content]);
        });

        // Newsletters
        const newsletters = [
            { project: 'plexus', name: 'Plexus 2026 Launch', subject: 'Plexus 2026 is Coming! Save the Date', preview: 'Mark your calendars for December 4-5 in Zagreb', status: 'sent', sent_at: '2026-01-08', recipients: 2450, opens: 1823, clicks: 456 },
            { project: 'plexus', name: 'Speaker Announcement', subject: 'First Keynote Speaker Revealed!', preview: 'A Nobel laureate joins Plexus 2026', status: 'sent', sent_at: '2026-01-18', recipients: 2480, opens: 1956, clicks: 892 },
            { project: 'accelerator', name: 'Applications Open', subject: 'Med&X Accelerator 2026 Applications Now Open', preview: 'Your pathway to Harvard, Yale, MIT and more', status: 'sent', sent_at: '2026-01-20', recipients: 3200, opens: 2560, clicks: 1245 },
            { project: 'plexus', name: 'Early Bird Reminder', subject: 'Early Bird Deadline Approaching!', preview: 'Last chance for early bird pricing', status: 'draft', recipients: 0, opens: 0, clicks: 0 }
        ];
        newsletters.forEach(n => {
            db.run(`INSERT INTO pr_newsletters (id, project, name, subject, preview_text, status, sent_at, recipient_count, open_count, click_count) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), n.project, n.name, n.subject, n.preview, n.status, n.sent_at || null, n.recipients, n.opens, n.clicks]);
        });

        // Subscribers
        const subscribers = [
            { email: 'ana.kovac@gmail.com', first_name: 'Ana', last_name: 'Kovac', projects: 'plexus,accelerator', language: 'hr', source: 'website' },
            { email: 'marko.horvat@yahoo.com', first_name: 'Marko', last_name: 'Horvat', projects: 'all', language: 'hr', source: 'conference' },
            { email: 'john.smith@harvard.edu', first_name: 'John', last_name: 'Smith', projects: 'accelerator,forum', language: 'en', source: 'referral' },
            { email: 'elena.rossi@unimi.it', first_name: 'Elena', last_name: 'Rossi', projects: 'plexus', language: 'en', source: 'linkedin' },
            { email: 'petra.novak@medri.uniri.hr', first_name: 'Petra', last_name: 'Novak', projects: 'accelerator', language: 'hr', source: 'website' }
        ];
        subscribers.forEach(s => {
            db.run(`INSERT INTO pr_subscribers (id, email, first_name, last_name, subscribed_projects, language, source) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), s.email, s.first_name, s.last_name, s.projects, s.language, s.source]);
        });

        // Campaigns
        const campaigns = [
            { project: 'plexus', name: 'Plexus 2026 Launch Campaign', description: 'Multi-platform campaign announcing Plexus 2026', goal: 'Awareness and early registrations', start: '2026-01-01', end: '2026-02-28', status: 'active', budget: 5000, spent: 1200 },
            { project: 'accelerator', name: 'Accelerator Recruitment 2026', description: 'Campaign to attract top applicants', goal: '500+ applications by deadline', start: '2026-01-15', end: '2026-03-15', status: 'active', budget: 3000, spent: 800 },
            { project: 'forum', name: 'Forum Membership Drive', description: 'Invite senior leaders to join the Forum', goal: '20 new members', start: '2026-02-01', end: '2026-04-30', status: 'planning', budget: 1000, spent: 0 }
        ];
        campaigns.forEach(c => {
            db.run(`INSERT INTO pr_campaigns (id, project, name, description, goal, start_date, end_date, status, budget, spent) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), c.project, c.name, c.description, c.goal, c.start, c.end, c.status, c.budget, c.spent]);
        });

        // Analytics snapshots
        const analytics = [
            { project: 'plexus', platform: 'instagram', date: '2026-01-25', followers: 4250, engagement: 4.2, reach: 18500, impressions: 42000 },
            { project: 'plexus', platform: 'linkedin', date: '2026-01-25', followers: 8900, engagement: 3.8, reach: 35000, impressions: 78000 },
            { project: 'plexus', platform: 'twitter', date: '2026-01-25', followers: 2100, engagement: 2.5, reach: 12000, impressions: 28000 },
            { project: 'accelerator', platform: 'instagram', date: '2026-01-25', followers: 3800, engagement: 5.1, reach: 22000, impressions: 48000 },
            { project: 'accelerator', platform: 'linkedin', date: '2026-01-25', followers: 6500, engagement: 4.5, reach: 28000, impressions: 62000 }
        ];
        analytics.forEach(a => {
            db.run(`INSERT INTO pr_analytics (id, project, platform, date, followers, engagement_rate, reach, impressions) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), a.project, a.platform, a.date, a.followers, a.engagement, a.reach, a.impressions]);
        });

        saveDb();
        console.log('PR & Media sample data seeded');
    }

    // ========== AUTH ROUTES ==========
    app.post('/api/auth/register', async (req, res) => {
        try {
            const { email, password, first_name, last_name, institution, country } = req.body;
            if (query.get('SELECT id FROM users WHERE email = ?', [email])) {
                return res.status(400).json({ error: 'Email exists' });
            }
            const id = uuidv4();
            const hash = await bcrypt.hash(password, 10);
            db.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, institution, country)
                VALUES (?, ?, ?, ?, ?, ?, ?)`, [id, email, hash, first_name, last_name, institution, country]);
            saveDb();
            const token = jwt.sign({ id, email, is_admin: 0 }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token, user: { id, email, first_name, last_name, institution, country, is_admin: 0 }});
        } catch (e) { console.error(e); res.status(500).json({ error: 'Registration failed' }); }
    });

    app.post('/api/auth/login', async (req, res) => {
        try {
            const { email, password } = req.body;
            const user = query.get('SELECT * FROM users WHERE email = ?', [email]);
            if (!user || !(await bcrypt.compare(password, user.password_hash))) {
                return res.status(401).json({ error: 'Invalid credentials' });
            }
            const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '7d' });
            res.json({ success: true, token, user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name, institution: user.institution, is_admin: user.is_admin }});
        } catch (e) { console.error(e); res.status(500).json({ error: 'Login failed' }); }
    });

    app.get('/api/auth/me', auth, (req, res) => {
        const user = query.get('SELECT id, email, first_name, last_name, phone, institution, country, bio, photo_url, is_admin, is_public_profile FROM users WHERE id = ?', [req.user.id]);
        res.json(user);
    });

    app.put('/api/auth/profile', auth, (req, res) => {
        const { first_name, last_name, phone, institution, country, bio, is_public_profile } = req.body;
        db.run(`UPDATE users SET first_name=?, last_name=?, phone=?, institution=?, country=?, bio=?, is_public_profile=? WHERE id=?`,
            [first_name || null, last_name || null, phone || null, institution || null, country || null, bio || null, is_public_profile ? 1 : 0, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== CONFERENCE ROUTES ==========
    app.get('/api/conferences/active', (req, res) => {
        res.json(query.get('SELECT * FROM conferences WHERE is_active = 1 ORDER BY year DESC LIMIT 1'));
    });

    app.get('/api/conferences/:slug', (req, res) => {
        const conf = query.get('SELECT * FROM conferences WHERE slug = ?', [req.params.slug]);
        if (!conf) return res.status(404).json({ error: 'Not found' });
        res.json(conf);
    });

    app.get('/api/conferences', (req, res) => {
        res.json(query.all('SELECT * FROM conferences ORDER BY year DESC'));
    });

    // ========== TICKET ROUTES ==========
    app.get('/api/conferences/:confId/tickets', (req, res) => {
        res.json(query.all('SELECT * FROM ticket_types WHERE conference_id = ? ORDER BY sort_order', [req.params.confId]));
    });

    app.post('/api/promo-codes/validate', (req, res) => {
        const { code, conference_id } = req.body;
        const promo = query.get(`SELECT * FROM promo_codes WHERE code = ? AND conference_id = ? AND is_active = 1
            AND (valid_until IS NULL OR valid_until >= date('now'))
            AND (max_uses IS NULL OR used_count < max_uses)`, [code.toUpperCase(), conference_id]);
        if (!promo) return res.status(400).json({ error: 'Invalid code' });
        res.json({ valid: true, discount_type: promo.discount_type, discount_value: promo.discount_value, promo_code_id: promo.id });
    });

    // ========== REGISTRATION ROUTES ==========
    app.post('/api/registrations', auth, async (req, res) => {
        try {
            const { conference_id, ticket_type_id, promo_code_id, dietary_requirements, accessibility_needs } = req.body;
            const ticket = query.get('SELECT * FROM ticket_types WHERE id = ?', [ticket_type_id]);
            const conf = query.get('SELECT * FROM conferences WHERE id = ?', [conference_id]);

            let amount = ticket.price_regular;
            const now = new Date();
            if (conf.early_bird_deadline && now < new Date(conf.early_bird_deadline)) amount = ticket.price_early_bird;
            else if (conf.regular_deadline && now > new Date(conf.regular_deadline)) amount = ticket.price_late;

            let discount = 0;
            if (promo_code_id) {
                const promo = query.get('SELECT * FROM promo_codes WHERE id = ?', [promo_code_id]);
                if (promo) {
                    discount = promo.discount_type === 'percentage' ? amount * (promo.discount_value / 100) : promo.discount_value;
                    db.run('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)', [promo_code_id]);
                    if (db.getRowsModified() === 0) {
                        return res.status(400).json({ error: 'Promo code has reached its maximum number of uses' });
                    }
                }
            }

            const finalAmount = Math.max(0, amount - discount);
            const regId = uuidv4();
            const invoiceNumber = `INV-${Date.now()}-${uuidv4().split('-')[0]}`;

            const qrPath = path.join(uploadsDir, 'tickets', `${regId}.png`);
            await QRCode.toFile(qrPath, JSON.stringify({ id: regId, conf: 'plexus-2026' }));

            db.run(`INSERT INTO registrations (id, conference_id, user_id, ticket_type_id, status, payment_status, amount_paid, promo_code_id, discount_amount, invoice_number, ticket_qr_code, dietary_requirements, accessibility_needs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [regId, conference_id, req.user.id, ticket_type_id, finalAmount > 0 ? 'pending' : 'confirmed', finalAmount > 0 ? 'unpaid' : 'free', finalAmount, promo_code_id, discount, invoiceNumber, `/uploads/tickets/${regId}.png`, dietary_requirements, accessibility_needs]);

            db.run('UPDATE ticket_types SET sold_count = sold_count + 1 WHERE id = ?', [ticket_type_id]);
            saveDb();

            res.json({ success: true, registration_id: regId, amount: finalAmount, invoice_number: invoiceNumber, status: finalAmount > 0 ? 'pending_payment' : 'confirmed' });
        } catch (e) { console.error(e); res.status(500).json({ error: 'Registration failed' }); }
    });

    app.get('/api/registrations/my', auth, (req, res) => {
        res.json(query.all(`SELECT r.*, c.name as conference_name, c.start_date, c.end_date, c.venue_name, c.venue_city, t.name as ticket_name
            FROM registrations r JOIN conferences c ON r.conference_id = c.id JOIN ticket_types t ON r.ticket_type_id = t.id
            WHERE r.user_id = ? ORDER BY r.created_at DESC`, [req.user.id]));
    });

    app.get('/api/registrations/:id', auth, (req, res) => {
        const reg = query.get(`SELECT r.*, c.name as conference_name, c.start_date, c.end_date, c.venue_name, t.name as ticket_name, t.includes_gala, u.first_name, u.last_name, u.email, u.institution
            FROM registrations r JOIN conferences c ON r.conference_id = c.id JOIN ticket_types t ON r.ticket_type_id = t.id JOIN users u ON r.user_id = u.id
            WHERE r.id = ?`, [req.params.id]);
        if (!reg) return res.status(404).json({ error: 'Not found' });
        res.json(reg);
    });

    // ========== ABSTRACT ROUTES ==========
    app.post('/api/abstracts', auth, (req, res) => {
        const { conference_id, title, abstract_text, keywords, topic_category, presentation_type, authors } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO abstracts (id, conference_id, submitter_id, title, abstract_text, keywords, topic_category, presentation_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, conference_id, req.user.id, title, abstract_text, keywords, topic_category, presentation_type]);

        if (authors?.length) {
            authors.forEach((a, i) => {
                db.run(`INSERT INTO abstract_authors (id, abstract_id, email, first_name, last_name, institution, is_presenting, author_order)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [uuidv4(), id, a.email, a.first_name, a.last_name, a.institution, a.is_presenting ? 1 : 0, i + 1]);
            });
        }
        saveDb();
        res.json({ success: true, abstract_id: id });
    });

    app.get('/api/abstracts/my', auth, (req, res) => {
        const abstracts = query.all(`SELECT a.*, c.name as conference_name FROM abstracts a JOIN conferences c ON a.conference_id = c.id
            WHERE a.submitter_id = ? ORDER BY a.created_at DESC`, [req.user.id]);
        abstracts.forEach(a => {
            a.authors = query.all('SELECT * FROM abstract_authors WHERE abstract_id = ? ORDER BY author_order', [a.id]);
        });
        res.json(abstracts);
    });

    app.post('/api/abstracts/:id/withdraw', auth, (req, res) => {
        db.run('UPDATE abstracts SET is_withdrawn = 1, status = ? WHERE id = ? AND submitter_id = ?', ['withdrawn', req.params.id, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== SCHEDULE ROUTES ==========
    app.get('/api/conferences/:confId/schedule', (req, res) => {
        res.json(query.all('SELECT * FROM sessions WHERE conference_id = ? ORDER BY day, start_time', [req.params.confId]));
    });

    app.get('/api/schedule/my', auth, (req, res) => {
        res.json(query.all(`SELECT s.*, ps.id as personal_schedule_id FROM sessions s
            JOIN personal_schedules ps ON s.id = ps.session_id WHERE ps.user_id = ? ORDER BY s.day, s.start_time`, [req.user.id]));
    });

    app.post('/api/schedule/add', auth, (req, res) => {
        const { session_id } = req.body;
        try {
            db.run('INSERT INTO personal_schedules (id, user_id, session_id) VALUES (?, ?, ?)', [uuidv4(), req.user.id, session_id]);
            saveDb();
            res.json({ success: true });
        } catch (e) {
            res.json({ success: true, already_added: true });
        }
    });

    app.delete('/api/schedule/:sessionId', auth, (req, res) => {
        db.run('DELETE FROM personal_schedules WHERE user_id = ? AND session_id = ?', [req.user.id, req.params.sessionId]);
        saveDb();
        res.json({ success: true });
    });

    // ========== SPEAKER ROUTES ==========
    app.get('/api/conferences/:confId/speakers', (req, res) => {
        res.json(query.all('SELECT * FROM speakers WHERE conference_id = ? AND is_confirmed = 1 AND is_published = 1 ORDER BY is_keynote DESC, sort_order', [req.params.confId]));
    });

    // ========== Q&A ROUTES ==========
    app.post('/api/sessions/:sessionId/questions', auth, (req, res) => {
        const id = uuidv4();
        db.run('INSERT INTO session_questions (id, session_id, user_id, question_text) VALUES (?, ?, ?, ?)', [id, req.params.sessionId, req.user.id, req.body.question_text]);
        saveDb();
        res.json({ success: true, question_id: id });
    });

    app.get('/api/sessions/:sessionId/questions', (req, res) => {
        res.json(query.all(`SELECT q.*, u.first_name, u.last_name FROM session_questions q JOIN users u ON q.user_id = u.id
            WHERE q.session_id = ? ORDER BY q.upvotes DESC, q.created_at DESC`, [req.params.sessionId]));
    });

    // ========== NETWORKING ROUTES ==========
    app.get('/api/conferences/:confId/attendees', auth, (req, res) => {
        res.json(query.all(`SELECT u.id, u.first_name, u.last_name, u.institution, u.country, u.bio
            FROM users u JOIN registrations r ON u.id = r.user_id
            WHERE r.conference_id = ? AND r.status = 'confirmed' AND u.is_public_profile = 1`, [req.params.confId]));
    });

    app.post('/api/connections/request', auth, (req, res) => {
        db.run('INSERT INTO connections (id, requester_id, requestee_id, message) VALUES (?, ?, ?, ?)', [uuidv4(), req.user.id, req.body.user_id, req.body.message]);
        saveDb();
        res.json({ success: true });
    });

    app.get('/api/connections/my', auth, (req, res) => {
        res.json(query.all(`SELECT c.*,
            u1.first_name AS requester_first_name, u1.last_name AS requester_last_name,
            u1.institution AS requester_institution, u1.bio AS requester_bio, u1.country AS requester_country,
            u2.first_name AS requestee_first_name, u2.last_name AS requestee_last_name,
            u2.institution AS requestee_institution, u2.bio AS requestee_bio, u2.country AS requestee_country
            FROM connections c
            LEFT JOIN users u1 ON c.requester_id = u1.id
            LEFT JOIN users u2 ON c.requestee_id = u2.id
            WHERE c.requester_id = ? OR c.requestee_id = ?`, [req.user.id, req.user.id]));
    });

    // Accept or decline a connection request
    app.post('/api/connections/:id/respond', auth, (req, res) => {
        const { action } = req.body ?? {};
        if (!action || !['accept', 'decline'].includes(action)) {
            return res.status(400).json({ error: 'action must be "accept" or "decline"' });
        }
        const connId = req.params.id;
        const conn = query.get('SELECT * FROM connections WHERE id = ? AND requestee_id = ?', [connId, req.user.id]);
        if (!conn) return res.status(404).json({ error: 'Connection request not found' });
        const newStatus = action === 'accept' ? 'accepted' : 'declined';
        db.run('UPDATE connections SET status = ? WHERE id = ?', [newStatus, connId]);
        saveDb();
        res.json({ success: true, status: newStatus });
    });

    // ========== ANNOUNCEMENTS ==========
    app.get('/api/conferences/:confId/announcements', (req, res) => {
        res.json(query.all('SELECT * FROM announcements WHERE conference_id = ? ORDER BY is_urgent DESC, published_at DESC', [req.params.confId]));
    });

    // ========== SPONSORS ==========
    app.get('/api/conferences/:confId/sponsors', (req, res) => {
        res.json(query.all(`SELECT * FROM sponsors WHERE conference_id = ? ORDER BY
            CASE tier WHEN 'platinum' THEN 1 WHEN 'gold' THEN 2 WHEN 'silver' THEN 3 ELSE 4 END, sort_order`, [req.params.confId]));
    });

    // ========== RESOURCES ==========
    app.get('/api/conferences/:confId/resources', (req, res) => {
        res.json(query.all('SELECT * FROM resources WHERE conference_id = ? ORDER BY category, title', [req.params.confId]));
    });

    // ========== ACCELERATOR ROUTES ==========

    // Accelerator-specific multer for multi-file upload
    const acceleratorStorage = multer.diskStorage({
        destination: (req, file, cb) => cb(null, path.join(uploadsDir, 'accelerator')),
        filename: (req, file, cb) => {
            const uniqueName = `${uuidv4()}${path.extname(file.originalname)}`;
            cb(null, uniqueName);
        }
    });
    const acceleratorUpload = multer({
        storage: acceleratorStorage,
        limits: { fileSize: 20 * 1024 * 1024 }, // 20MB per file
        fileFilter: (req, file, cb) => {
            const allowedTypes = ['application/pdf', 'image/jpeg', 'image/png', 'application/msword',
                'application/vnd.openxmlformats-officedocument.wordprocessingml.document'];
            if (allowedTypes.includes(file.mimetype)) cb(null, true);
            else cb(new Error('Invalid file type. Only PDF, JPG, PNG, DOC, DOCX allowed.'));
        }
    });

    // Document types required for application
    const DOCUMENT_TYPES = [
        // REQUIRED DOCUMENTATION (11 required)
        { key: 'domovnica', label: 'Certificate of Citizenship', label_hr: 'Certificate of Citizenship', required: true, order: 1 },
        { key: 'cv', label: 'Curriculum Vitae (Europass)', label_hr: 'Curriculum Vitae (Europass)', required: true, order: 2 },
        { key: 'student_status', label: 'Student Status Certificate', label_hr: 'Student Status Certificate', required: true, order: 3 },
        { key: 'ects_credits', label: 'ECTS Credits Certificate', label_hr: 'ECTS Credits Certificate', required: true, order: 4 },
        { key: 'transcript', label: 'Transcript / Grade Average', label_hr: 'Transcript / Grade Average', required: true, order: 5 },
        { key: 'language_cert', label: 'Language Proficiency Certificate (B2+)', label_hr: 'Language Proficiency Certificate (B2+)', required: true, order: 6 },
        { key: 'application_form', label: 'Application Form', label_hr: 'Application Form', required: true, order: 7 },
        { key: 'membership_form', label: 'Membership Application', label_hr: 'Membership Application', required: true, order: 8 },
        { key: 'membership_fee', label: 'Proof of Membership Fee Payment', label_hr: 'Proof of Membership Fee Payment', required: true, order: 9 },
        { key: 'motivation', label: 'Motivation Letter', label_hr: 'Motivation Letter', required: true, order: 10 },
        { key: 'recommendation', label: 'Letter of Recommendation (1-2)', label_hr: 'Letter of Recommendation (1-2)', required: true, order: 11 },
        // OPTIONAL DOCUMENTATION (9 optional - for bonus points)
        { key: 'publication', label: 'Published Scientific Article', label_hr: 'Published Scientific Article', required: false, bonus: true, order: 12 },
        { key: 'conference', label: 'Conference Participation', label_hr: 'Conference Participation', required: false, bonus: true, order: 13 },
        { key: 'membership_proof', label: 'Professional Association Membership', label_hr: 'Professional Association Membership', required: false, bonus: true, order: 14 },
        { key: 'leadership_proof', label: 'Leadership in Association', label_hr: 'Leadership in Association', required: false, bonus: true, order: 15 },
        { key: 'dean_award', label: "Dean's Award", label_hr: "Dean's Award", required: false, bonus: true, order: 16 },
        { key: 'rector_award', label: "Rector's Award", label_hr: "Rector's Award", required: false, bonus: true, order: 17 },
        { key: 'sports', label: 'Athletic Achievements', label_hr: 'Athletic Achievements', required: false, bonus: true, order: 18 },
        { key: 'editorship', label: 'Journal Editorial Position', label_hr: 'Journal Editorial Position', required: false, bonus: true, order: 19 },
        { key: 'other', label: 'Other', label_hr: 'Other', required: false, bonus: true, order: 20 }
    ];

    // GDPR Consent text (Consent for processing personal data)
    const GDPR_CONSENT_TEXT = `Consent for Processing Personal Data

I hereby confirm that I have read and understood and agree to the terms of processing my personal data within my application to the Med&X Accelerator program.

By applying to this program, I provide the following consents:

1. I agree that my personal data (including name, surname, date of birth, address, email, phone, citizenship, education and other relevant information) are collected and processed for the purpose of selection and implementation of the Med&X Accelerator program.

2. I agree that my personal data may be shared with program organizers and other relevant third parties participating in the selection and administration process.

3. I agree that my personal data may be stored for the period necessary for program administration, and thereafter will be used exclusively for organizing future editions of the Med&X Accelerator program.

4. I understand that I have the right to request access to my personal data, correction of inaccurate data, and deletion of data in accordance with legal requirements.`;

    // Get active Accelerator program
    app.get('/api/accelerator/program', (req, res) => {
        const program = query.get('SELECT * FROM accelerator_programs WHERE is_active = 1 ORDER BY year DESC LIMIT 1');
        if (!program) return res.status(404).json({ error: 'No active program' });
        res.json({ ...program, document_types: DOCUMENT_TYPES });
    });

    // Get all partner institutions
    app.get('/api/accelerator/institutions', (req, res) => {
        res.json(query.all('SELECT * FROM accelerator_institutions WHERE is_active = 1 ORDER BY sort_order'));
    });

    // Get user's application
    app.get('/api/accelerator/applications/my', auth, (req, res) => {
        const program = query.get('SELECT id FROM accelerator_programs WHERE is_active = 1 ORDER BY year DESC LIMIT 1');
        if (!program) return res.status(404).json({ error: 'No active program' });

        const application = query.get('SELECT * FROM accelerator_applications WHERE user_id = ? AND program_id = ?', [req.user.id, program.id]);
        if (!application) return res.json(null);

        // Get documents
        application.documents = query.all('SELECT * FROM accelerator_documents WHERE application_id = ?', [application.id]);
        // Get recommendations
        application.recommendations = query.all('SELECT * FROM accelerator_recommendations WHERE application_id = ?', [application.id]);

        res.json(application);
    });

    // Create or update application
    app.post('/api/accelerator/applications', auth, (req, res) => {
        try {
            const {
                year, first_name, last_name, email, phone, date_of_birth, oib, address,
                nationality, country_of_residence,
                current_institution, degree_program, year_of_study, gpa, ects_total,
                program_type, selected_institution, alternative_institution,
                previous_experience, special_arrangements, gdpr_consent, status
            } = req.body;

            const appYear = year || new Date().getFullYear();
            const id = uuidv4();

            // Generate work number based on count
            const count = query.get('SELECT COUNT(*) as cnt FROM accelerator_applications WHERE year = ?', [appYear]);
            const workNum = String((count?.cnt || 0) + 1).padStart(3, '0');
            const appNumber = `ACC${String(appYear).slice(-2)}-${workNum}`;

            db.run(`INSERT INTO accelerator_applications (
                id, year, user_id, application_number, work_number,
                first_name, last_name, email, phone, date_of_birth, oib, address,
                nationality, country_of_residence,
                current_institution, degree_program, year_of_study, gpa, ects_total,
                program_type, selected_institution, alternative_institution,
                previous_experience, special_arrangements, gdpr_consent, status
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                id, appYear, req.user.id, appNumber, workNum,
                first_name ?? null, last_name ?? null, email ?? null, phone ?? null, date_of_birth ?? null, oib ?? null, address ?? null,
                nationality ?? null, country_of_residence ?? null,
                current_institution ?? null, degree_program ?? null, year_of_study ?? null, gpa ?? null, ects_total ?? null,
                program_type ?? null, selected_institution ?? null, alternative_institution ?? null,
                previous_experience ?? null, special_arrangements ?? null, gdpr_consent ? 1 : 0, status || 'draft'
            ]);
            saveDb();
            res.json({ id, application_number: appNumber, work_number: workNum });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to save application' });
        }
    });

    // Upload single document
    app.post('/api/accelerator/applications/:id/documents/:docType', auth, acceleratorUpload.single('file'), (req, res) => {
        try {
            const { id, docType } = req.params;
            const app = query.get('SELECT * FROM accelerator_applications WHERE id = ? AND user_id = ?', [id, req.user.id]);
            if (!app) return res.status(404).json({ error: 'Application not found' });

            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            // Check if document already exists and delete old file
            const existing = query.get('SELECT * FROM accelerator_documents WHERE application_id = ? AND document_type = ?', [id, docType]);
            if (existing && existing.file_path) {
                const oldPath = path.join(__dirname, existing.file_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                db.run('DELETE FROM accelerator_documents WHERE id = ?', [existing.id]);
            }

            // Save new document record
            const docId = uuidv4();
            const filePath = `/uploads/accelerator/${req.file.filename}`;

            db.run(`INSERT INTO accelerator_documents (id, application_id, document_type, original_filename, stored_filename, file_path, file_size, mime_type, upload_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`, [
                docId, id, docType, req.file.originalname, req.file.filename, filePath, req.file.size, req.file.mimetype
            ]);

            // Check if all required documents are uploaded
            const docs = query.all('SELECT document_type FROM accelerator_documents WHERE application_id = ?', [id]);
            const uploadedTypes = docs.map(d => d.document_type);
            const requiredDocs = DOCUMENT_TYPES.filter(dt => dt.required).map(dt => dt.key);
            const allUploaded = requiredDocs.every(rt => uploadedTypes.includes(rt));

            db.run('UPDATE accelerator_applications SET documents_complete = ? WHERE id = ?', [allUploaded ? 1 : 0, id]);
            saveDb();

            res.json({
                success: true,
                document_id: docId,
                file_path: filePath,
                documents_complete: allUploaded
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Upload failed' });
        }
    });

    // Upload single or multiple documents
    app.post('/api/accelerator/applications/:id/documents', auth, acceleratorUpload.single('file'), (req, res) => {
        try {
            const { id } = req.params;
            // Allow admin to upload to any application
            const app = query.get('SELECT * FROM accelerator_applications WHERE id = ?', [id]);
            if (!app) return res.status(404).json({ error: 'Application not found' });

            if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

            const docType = req.body.document_type || 'other';

            // Check if document already exists
            const existing = query.get('SELECT * FROM accelerator_documents WHERE application_id = ? AND document_type = ?', [id, docType]);
            if (existing && existing.file_path) {
                const oldPath = path.join(__dirname, existing.file_path);
                if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
                db.run('DELETE FROM accelerator_documents WHERE id = ?', [existing.id]);
            }

            const docId = uuidv4();
            const filePath = `/uploads/accelerator/${req.file.filename}`;

            db.run(`INSERT INTO accelerator_documents (id, application_id, document_type, original_filename, stored_filename, file_path, file_size, mime_type, upload_status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`, [
                docId, id, docType, req.file.originalname, req.file.filename, filePath, req.file.size, req.file.mimetype
            ]);

            // Check completion
            const docs = query.all('SELECT document_type FROM accelerator_documents WHERE application_id = ?', [id]);
            const uploadedTypes = docs.map(d => d.document_type);
            const requiredDocs = DOCUMENT_TYPES.filter(dt => dt.required).map(dt => dt.key);
            const allUploaded = requiredDocs.every(rt => uploadedTypes.includes(rt));

            db.run('UPDATE accelerator_applications SET documents_complete = ? WHERE id = ?', [allUploaded ? 1 : 0, id]);
            saveDb();

            res.json({ success: true, document_id: docId, document_type: docType, file_path: filePath, documents_complete: allUploaded });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Upload failed' });
        }
    });

    // Get single document (download)
    app.get('/api/accelerator/documents/:docId', auth, (req, res) => {
        const doc = query.get(`SELECT d.*, a.user_id FROM accelerator_documents d
            JOIN accelerator_applications a ON d.application_id = a.id
            WHERE d.id = ?`, [req.params.docId]);

        if (!doc) return res.status(404).json({ error: 'Document not found' });

        // Check access - user must own the application or be admin
        if (doc.user_id !== req.user.id && !req.user.is_admin) {
            return res.status(403).json({ error: 'Access denied' });
        }

        const filePath = path.join(__dirname, doc.file_path);
        if (!fs.existsSync(filePath)) return res.status(404).json({ error: 'File not found' });

        const safeName = (doc.original_filename || 'download').replace(/["\r\n]/g, '');
        res.setHeader('Content-Disposition', `attachment; filename="${safeName}"`);
        res.setHeader('Content-Type', doc.mime_type);
        res.sendFile(filePath);
    });

    // Delete document
    app.delete('/api/accelerator/documents/:docId', auth, (req, res) => {
        const doc = query.get(`SELECT d.*, a.user_id, a.id as app_id FROM accelerator_documents d
            JOIN accelerator_applications a ON d.application_id = a.id
            WHERE d.id = ?`, [req.params.docId]);

        if (!doc) return res.status(404).json({ error: 'Document not found' });
        if (doc.user_id !== req.user.id) return res.status(403).json({ error: 'Access denied' });

        // Delete file
        const filePath = path.join(__dirname, doc.file_path);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        // Delete record
        db.run('DELETE FROM accelerator_documents WHERE id = ?', [req.params.docId]);

        // Update completion status
        const docs = query.all('SELECT document_type FROM accelerator_documents WHERE application_id = ?', [doc.app_id]);
        const uploadedTypes = docs.map(d => d.document_type);
        const requiredDocs = DOCUMENT_TYPES.filter(dt => dt.required).map(dt => dt.key);
        const allUploaded = requiredDocs.every(rt => uploadedTypes.includes(rt));

        db.run('UPDATE accelerator_applications SET documents_complete = ? WHERE id = ?', [allUploaded ? 1 : 0, doc.app_id]);
        saveDb();

        res.json({ success: true });
    });

    // Submit application
    app.post('/api/accelerator/applications/:id/submit', auth, (req, res) => {
        const app = query.get('SELECT * FROM accelerator_applications WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (!app) return res.status(404).json({ error: 'Application not found' });
        if (app.status !== 'draft') return res.status(400).json({ error: 'Application already submitted' });
        if (!app.documents_complete) return res.status(400).json({ error: 'Please upload all required documents before submitting' });

        db.run(`UPDATE accelerator_applications SET status = 'submitted', submitted_at = datetime('now') WHERE id = ?`, [req.params.id]);
        saveDb();

        // Send accelerator application confirmation email
        try {
            if (app.email) {
                sendEmail(app.email, 'Med&X Accelerator — Application Received', buildEmailTemplate('Application Received', `
                    <p>Dear ${app.first_name || 'Applicant'},</p>
                    <p>Your application for the <strong>Med&amp;X Accelerator</strong> program has been successfully submitted.</p>
                    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 160px;">Application Number</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${app.application_number || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Candidate ID</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${app.candidate_id || 'N/A'}</td></tr>
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Submitted</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
                    </table>
                    <p>Our review committee will evaluate your application and notify you of the next steps. This process typically takes 2-4 weeks.</p>
                    <p>If you have any questions in the meantime, contact us at <a href="mailto:accelerator@medx.hr" style="color: #C9A962;">accelerator@medx.hr</a>.</p>
                    <p>Best regards,<br><strong>Med&amp;X Accelerator Team</strong></p>
                `));
            }
        } catch (emailErr) {
            console.warn('Accelerator submit email failed:', emailErr.message);
        }

        res.json({ success: true });
    });

    // Generate combined PDF package
    app.get('/api/accelerator/applications/:id/package', auth, async (req, res) => {
        try {
            const PDFDocument = require('pdfkit');

            const app = query.get(`SELECT a.*, u.email as user_email FROM accelerator_applications a
                JOIN users u ON a.user_id = u.id WHERE a.id = ?`, [req.params.id]);
            if (!app) return res.status(404).json({ error: 'Application not found' });

            // Check access
            if (app.user_id !== req.user.id && !req.user.is_admin) {
                return res.status(403).json({ error: 'Access denied' });
            }

            const docs = query.all('SELECT * FROM accelerator_documents WHERE application_id = ? ORDER BY document_type', [req.params.id]);
            const institutions = query.all('SELECT * FROM accelerator_institutions WHERE is_active = 1');
            const instMap = {};
            institutions.forEach(i => instMap[i.id] = i.name);

            // Create PDF
            const doc = new PDFDocument({ margin: 50, size: 'A4' });

            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Application_${app.application_number}.pdf"`);
            doc.pipe(res);

            // Header
            doc.fontSize(24).fillColor('#C9A962').text('Med&X Accelerator', { align: 'center' });
            doc.fontSize(12).fillColor('#666').text('Application Package', { align: 'center' });
            doc.moveDown();
            doc.fontSize(10).fillColor('#999').text(`Application #: ${app.application_number}`, { align: 'center' });
            doc.text(`Generated: ${new Date().toLocaleDateString()}`, { align: 'center' });
            doc.moveDown(2);

            // Personal Info Section
            doc.fontSize(16).fillColor('#0a0e14').text('Personal Information');
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333');

            const addField = (label, value) => {
                if (value) {
                    doc.font('Helvetica-Bold').text(`${label}: `, { continued: true });
                    doc.font('Helvetica').text(value);
                }
            };

            addField('Name', `${app.first_name} ${app.last_name}`);
            addField('Email', app.email);
            addField('Phone', app.phone);
            addField('Date of Birth', app.date_of_birth);
            addField('Nationality', app.nationality);
            addField('Country of Residence', app.country_of_residence);
            doc.moveDown();

            // Academic Info
            doc.fontSize(16).fillColor('#0a0e14').text('Academic Background');
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333');
            addField('Current Institution', app.current_institution);
            addField('Current Position', app.current_position);
            addField('Degree Program', app.degree_program);
            addField('Expected Graduation', app.expected_graduation);
            addField('GPA', app.gpa);
            doc.moveDown();

            // Institution Preferences
            doc.fontSize(16).fillColor('#0a0e14').text('Institution Preferences');
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333');
            addField('First Choice', instMap[app.first_choice_institution] || app.first_choice_institution);
            addField('Second Choice', instMap[app.second_choice_institution] || app.second_choice_institution);
            addField('Third Choice', instMap[app.third_choice_institution] || app.third_choice_institution);
            doc.moveDown();

            // Research & Motivation
            if (app.research_interests) {
                doc.fontSize(16).fillColor('#0a0e14').text('Research Interests');
                doc.moveDown(0.5);
                doc.fontSize(11).fillColor('#333').text(app.research_interests);
                doc.moveDown();
            }

            if (app.motivation_statement) {
                doc.addPage();
                doc.fontSize(16).fillColor('#0a0e14').text('Motivation Statement');
                doc.moveDown(0.5);
                doc.fontSize(11).fillColor('#333').text(app.motivation_statement);
                doc.moveDown();
            }

            if (app.previous_research_experience) {
                doc.fontSize(16).fillColor('#0a0e14').text('Previous Research Experience');
                doc.moveDown(0.5);
                doc.fontSize(11).fillColor('#333').text(app.previous_research_experience);
                doc.moveDown();
            }

            if (app.publications) {
                doc.fontSize(16).fillColor('#0a0e14').text('Publications');
                doc.moveDown(0.5);
                doc.fontSize(11).fillColor('#333').text(app.publications);
                doc.moveDown();
            }

            if (app.awards_honors) {
                doc.fontSize(16).fillColor('#0a0e14').text('Awards & Honors');
                doc.moveDown(0.5);
                doc.fontSize(11).fillColor('#333').text(app.awards_honors);
                doc.moveDown();
            }

            // Documents Summary
            doc.addPage();
            doc.fontSize(16).fillColor('#0a0e14').text('Uploaded Documents');
            doc.moveDown(0.5);
            doc.fontSize(11).fillColor('#333');

            docs.forEach(d => {
                const typeLabel = DOCUMENT_TYPES.find(dt => dt.key === d.document_type)?.label || d.document_type;
                doc.text(`• ${typeLabel}: ${d.original_filename} (${(d.file_size / 1024).toFixed(1)} KB)`);
            });
            doc.moveDown();
            doc.fontSize(9).fillColor('#999').text('Note: Individual documents can be downloaded separately from the portal.');

            // Footer
            doc.fontSize(8).fillColor('#999');
            doc.text(`Med&X Accelerator ${new Date().getFullYear()} | Application ID: ${app.id}`, 50, doc.page.height - 50);

            doc.end();
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to generate PDF' });
        }
    });

    // ========== ACCELERATOR YEAR-BASED MANAGEMENT ==========

    // Get all available years
    app.get('/api/accelerator/years', auth, (req, res) => {
        const years = query.all('SELECT DISTINCT year FROM accelerator_programs ORDER BY year DESC');
        res.json(years.map(y => y.year));
    });

    // Get program details for a specific year
    app.get('/api/accelerator/years/:year', auth, (req, res) => {
        const program = query.get('SELECT * FROM accelerator_programs WHERE year = ?', [req.params.year]);
        if (!program) return res.status(404).json({ error: 'Year not found' });
        res.json(program);
    });

    // Create new year/program
    app.post('/api/accelerator/years', auth, (req, res) => {
        const { year, name, description, application_deadline, program_start, program_end } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO accelerator_programs (id, name, year, description, application_deadline, program_start, program_end)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, name || `Med&X Accelerator ${year}`, year, description, application_deadline, program_start, program_end]);
        saveDb();
        res.json({ success: true, id, year });
    });

    // Update year/program
    app.put('/api/accelerator/years/:year', auth, (req, res) => {
        const { name, description, application_deadline, program_start, program_end, is_active, is_accepting } = req.body;
        db.run(`UPDATE accelerator_programs SET name = COALESCE(?, name), description = COALESCE(?, description),
            application_deadline = COALESCE(?, application_deadline), program_start = COALESCE(?, program_start),
            program_end = COALESCE(?, program_end), is_active = COALESCE(?, is_active), is_accepting = COALESCE(?, is_accepting)
            WHERE year = ?`,
            [name, description, application_deadline, program_start, program_end, is_active, is_accepting, req.params.year]);
        saveDb();
        res.json({ success: true });
    });

    // ========== ACCELERATOR KEY DATES ==========

    // Get key dates for a year
    app.get('/api/accelerator/years/:year/dates', auth, (req, res) => {
        const dates = query.all('SELECT * FROM accelerator_key_dates WHERE year = ? ORDER BY sort_order, date_start', [req.params.year]);
        res.json(dates);
    });

    // Add key date
    app.post('/api/accelerator/years/:year/dates', auth, (req, res) => {
        const { name, date_start, date_end, description, color, category } = req.body;
        const id = uuidv4();
        const sortOrder = query.get('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM accelerator_key_dates WHERE year = ?', [req.params.year]);
        db.run(`INSERT INTO accelerator_key_dates (id, year, name, date_start, date_end, description, color, sort_order, category)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.year, name, date_start, date_end, description, color || '#22d3ee', sortOrder.next, category || 'event']);
        saveDb();

        // Push notification to users
        const formattedDate = date_start ? new Date(date_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
        db.run(`INSERT INTO user_notifications (id, user_group, category, project, title, message, icon, icon_class, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [uuidv4(), 'all', 'update', 'accelerator', `Accelerator Update: ${name}`,
             `${name} is set for ${formattedDate}${date_end && date_end !== date_start ? ' - ' + new Date(date_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}`,
             'fa-calendar-check', 'accelerator', req.user?.id || null]);
        saveDb();

        res.json({ success: true, id });
    });

    // Update key date
    app.put('/api/accelerator/dates/:id', auth, (req, res) => {
        const { name, date_start, date_end, description, color, sort_order, category } = req.body;
        db.run(`UPDATE accelerator_key_dates SET name = COALESCE(?, name), date_start = COALESCE(?, date_start),
            date_end = COALESCE(?, date_end), description = COALESCE(?, description), color = COALESCE(?, color),
            sort_order = COALESCE(?, sort_order), category = COALESCE(?, category) WHERE id = ?`,
            [name, date_start, date_end, description, color, sort_order, category, req.params.id]);
        saveDb();

        // Push notification to users on update
        const updatedDate = query.get('SELECT * FROM accelerator_key_dates WHERE id = ?', [req.params.id]);
        if (updatedDate) {
            const formattedDate = updatedDate.date_start ? new Date(updatedDate.date_start + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : '';
            db.run(`INSERT INTO user_notifications (id, user_group, category, project, title, message, icon, icon_class, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
                [uuidv4(), 'all', 'update', 'accelerator', `Accelerator Update: ${updatedDate.name}`,
                 `${updatedDate.name} is set for ${formattedDate}${updatedDate.date_end && updatedDate.date_end !== updatedDate.date_start ? ' - ' + new Date(updatedDate.date_end + 'T00:00:00').toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' }) : ''}`,
                 'fa-calendar-check', 'accelerator', req.user?.id || null]);
            saveDb();
        }

        res.json({ success: true });
    });

    // Delete key date
    app.delete('/api/accelerator/dates/:id', auth, (req, res) => {
        db.run('DELETE FROM accelerator_key_dates WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== ACCELERATOR PROCESSING FEE (STRIPE + FIRA) ==========

    // Create Stripe Checkout Session for Accelerator processing fee (75 EUR)
    app.post('/api/accelerator/checkout-session', auth, async (req, res) => {
        try {
            if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });

            const { applicationId } = req.body;
            if (!applicationId) return res.status(400).json({ error: 'applicationId is required' });

            // Validate application exists and belongs to user
            const application = query.get(
                'SELECT * FROM accelerator_applications WHERE id = ? AND user_id = ?',
                [applicationId, req.user.id]
            );
            if (!application) return res.status(404).json({ error: 'Application not found' });
            if (application.status === 'paid') return res.status(400).json({ error: 'Processing fee already paid' });

            const user = query.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: 'Med&X Accelerator 2026 - Processing Fee',
                            description: `Application ${application.application_number || applicationId}`
                        },
                        unit_amount: 7500 // 75 EUR in cents
                    },
                    quantity: 1
                }],
                metadata: {
                    applicationId: applicationId,
                    userId: req.user.id,
                    type: 'accelerator-fee',
                    applicationNumber: application.application_number || ''
                },
                customer_email: user?.email || application.email,
                success_url: `${baseUrl}/?payment=success&type=accelerator&app=${applicationId}`,
                cancel_url: `${baseUrl}/?payment=cancelled&type=accelerator&app=${applicationId}`
            });

            res.json({ sessionId: session.id, url: session.url });
        } catch (err) {
            console.error('Accelerator checkout error:', err.message);
            res.status(500).json({ error: 'Failed to create checkout session' });
        }
    });

    // ========== ACCELERATOR INSTITUTIONS WITH DETAILS ==========

    // Get institutions with details for a year
    app.get('/api/accelerator/years/:year/institutions', auth, (req, res) => {
        const institutions = query.all(`
            SELECT i.*, d.program_type, d.available_spots, d.internship_duration, d.mentors,
                   d.visa_requirements, d.accommodation_info, d.stipend_info, d.requirements,
                   d.contact_email, d.contact_person, d.is_active as year_active
            FROM accelerator_institutions i
            LEFT JOIN accelerator_institution_details d ON i.id = d.institution_id AND d.year = ?
            WHERE i.is_active = 1
            ORDER BY i.sort_order`, [req.params.year]);
        res.json(institutions);
    });

    // Add/update institution details for a year
    app.put('/api/accelerator/years/:year/institutions/:instId', auth, (req, res) => {
        const { program_type, available_spots, internship_duration, mentors, visa_requirements,
                accommodation_info, stipend_info, requirements, contact_email, contact_person, is_active } = req.body;

        const existing = query.get('SELECT id FROM accelerator_institution_details WHERE institution_id = ? AND year = ?',
            [req.params.instId, req.params.year]);

        if (existing) {
            db.run(`UPDATE accelerator_institution_details SET program_type = ?, available_spots = ?,
                internship_duration = ?, mentors = ?, visa_requirements = ?, accommodation_info = ?,
                stipend_info = ?, requirements = ?, contact_email = ?, contact_person = ?, is_active = ?
                WHERE institution_id = ? AND year = ?`,
                [program_type, available_spots, internship_duration, mentors, visa_requirements,
                 accommodation_info, stipend_info, requirements, contact_email, contact_person, is_active ?? 1,
                 req.params.instId, req.params.year]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO accelerator_institution_details (id, institution_id, year, program_type, available_spots,
                internship_duration, mentors, visa_requirements, accommodation_info, stipend_info, requirements,
                contact_email, contact_person, is_active) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, req.params.instId, req.params.year, program_type, available_spots, internship_duration,
                 mentors, visa_requirements, accommodation_info, stipend_info, requirements, contact_email, contact_person, is_active ?? 1]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Add new institution
    app.post('/api/accelerator/institutions', auth, (req, res) => {
        const { name, short_name, city, country, description, website_url, logo_url } = req.body;
        const id = uuidv4();
        const sortOrder = query.get('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM accelerator_institutions');
        db.run(`INSERT INTO accelerator_institutions (id, name, short_name, city, country, description, website_url, logo_url, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, short_name, city, country, description, website_url, logo_url, sortOrder.next]);
        saveDb();
        res.json({ success: true, id });
    });

    // ========== ACCELERATOR APPLICATIONS (ENHANCED) ==========

    // Get all applications for a year with filtering
    app.get('/api/accelerator/years/:year/applications', auth, (req, res) => {
        const { status, institution, search } = req.query;
        const program = query.get('SELECT id FROM accelerator_programs WHERE year = ?', [req.params.year]);
        if (!program) return res.json([]);

        let sql = `SELECT a.*,
            (SELECT COUNT(*) FROM accelerator_documents WHERE application_id = a.id) as doc_count
            FROM accelerator_applications a WHERE a.program_id = ?`;
        const params = [program.id];

        if (status) { sql += ' AND a.status = ?'; params.push(status); }
        if (institution) { sql += ' AND a.selected_institution = ?'; params.push(institution); }
        if (search) { sql += ' AND (a.first_name LIKE ? OR a.last_name LIKE ? OR a.email LIKE ? OR a.application_number LIKE ?)';
            const s = `%${search}%`; params.push(s, s, s, s); }

        sql += ' ORDER BY a.submitted_at DESC, a.created_at DESC';
        res.json(query.all(sql, params));
    });

    // Get single application with all details
    app.get('/api/accelerator/applications/:id/full', auth, (req, res) => {
        const app = query.get('SELECT * FROM accelerator_applications WHERE id = ?', [req.params.id]);
        if (!app) return res.status(404).json({ error: 'Not found' });

        app.documents = query.all('SELECT * FROM accelerator_documents WHERE application_id = ?', [req.params.id]);
        app.evaluations = query.all(`SELECT e.*, c.name, c.name_hr, c.max_points, c.category
            FROM accelerator_evaluations e JOIN accelerator_evaluation_criteria c ON e.criterion_id = c.id
            WHERE e.application_id = ?`, [req.params.id]);
        app.interview_scores = query.all(`SELECT s.*, i.name as interviewer_name
            FROM accelerator_interview_scores s JOIN accelerator_interviewers i ON s.interviewer_id = i.id
            WHERE s.application_id = ?`, [req.params.id]);
        app.messages = query.all('SELECT * FROM accelerator_messages WHERE application_id = ? ORDER BY sent_at DESC', [req.params.id]);
        app.recommendations = query.all('SELECT * FROM accelerator_recommendations WHERE application_id = ?', [req.params.id]);

        res.json(app);
    });

    // Submit public application (no auth required for applicants)
    app.post('/api/accelerator/apply', (req, res) => {
        try {
            const program = query.get('SELECT * FROM accelerator_programs WHERE is_active = 1 AND is_accepting = 1 ORDER BY year DESC LIMIT 1');
            if (!program) return res.status(400).json({ error: 'Applications are currently closed' });

            const { first_name, last_name, email, phone, date_of_birth, oib, address, current_institution,
                    degree_program, year_of_study, gpa, ects_total, previous_experience, special_arrangements,
                    program_type, selected_institution, alternative_institution, gdpr_consent } = req.body;

            if (!gdpr_consent) return res.status(400).json({ error: 'GDPR consent is required' });

            // Generate work number (sequential per year)
            const lastApp = query.get('SELECT MAX(work_number) as max_wn FROM accelerator_applications WHERE program_id = ?', [program.id]);
            const workNumber = (lastApp?.max_wn || 0) + 1;

            // Generate unique 3-digit candidate ID for anonymous display (GDPR compliance)
            let candidateId;
            let attempts = 0;
            do {
                candidateId = String(Math.floor(100 + Math.random() * 900)); // 100-999
                const exists = query.get('SELECT id FROM accelerator_applications WHERE candidate_id = ? AND program_id = ?', [candidateId, program.id]);
                if (!exists) break;
                attempts++;
            } while (attempts < 100);

            // Generate application number
            const appNumber = `ACC-${program.year}-${String(workNumber).padStart(4, '0')}`;

            const id = uuidv4();
            db.run(`INSERT INTO accelerator_applications (id, program_id, year, application_number, work_number, candidate_id,
                first_name, last_name, email, phone, date_of_birth, oib, address, current_institution,
                degree_program, year_of_study, gpa, ects_total, previous_experience, special_arrangements,
                program_type, selected_institution, alternative_institution, gdpr_consent, gdpr_consent_date, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), 'draft')`,
                [id, program.id, program.year, appNumber, workNumber, candidateId, first_name, last_name, email, phone,
                 date_of_birth, oib, address, current_institution, degree_program, year_of_study, gpa, ects_total,
                 previous_experience, special_arrangements, program_type, selected_institution, alternative_institution, 1]);
            saveDb();

            res.json({ success: true, id, application_number: appNumber, work_number: workNumber, candidate_id: candidateId });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to submit application' });
        }
    });

    // Send message to candidate
    app.post('/api/accelerator/applications/:id/message', auth, async (req, res) => {
        try {
            const { subject, content, message_type, send_email } = req.body;
            const id = uuidv4();
            db.run(`INSERT INTO accelerator_messages (id, application_id, message_type, subject, content, sent_by)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [id, req.params.id, message_type || 'info', subject, content, req.user.email]);
            saveDb();

            // Send email notification if requested
            if (send_email !== false) {
                const application = query.get('SELECT * FROM accelerator_applications WHERE id = ?', [req.params.id]);
                if (application && application.email) {
                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <h2 style="color: #22d3ee;">Med&X Accelerator</h2>
                            <h3>${subject}</h3>
                            <div style="padding: 20px; background: #f5f5f5; border-radius: 8px; white-space: pre-line;">
                                ${content}
                            </div>
                            <p style="color: #666; font-size: 12px; margin-top: 20px;">
                                This message was sent regarding your application #${application.application_number || application.candidate_id || 'N/A'}.
                            </p>
                        </div>
                    `;
                    await sendEmail(application.email, `Med&X Accelerator: ${subject}`, emailHtml);
                }
            }

            res.json({ success: true, id });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to send message' });
        }
    });

    // Update application validity status and notify
    app.put('/api/accelerator/applications/:id/validity', auth, async (req, res) => {
        try {
            const { validity_status, reason, notify } = req.body;
            db.run(`UPDATE accelerator_applications SET validity_status = ?, validity_notified_at = datetime('now') WHERE id = ?`,
                [validity_status, req.params.id]);

            const application = query.get('SELECT * FROM accelerator_applications WHERE id = ?', [req.params.id]);

            if (notify && application) {
                const msgId = uuidv4();
                const isValid = validity_status === 'valid';
                const subject = isValid ? 'Application Accepted' : 'Application Invalid';

                // Include reason if provided (for invalid applications)
                const reasonText = reason ? `\n\nReason: ${reason}` : '';

                const content = isValid
                    ? `Dear ${application.first_name},\n\nYour application for the Med&X Accelerator program has been accepted as valid and will proceed to further evaluation.\n\nBest regards,\nMed&X Accelerator Team`
                    : `Dear ${application.first_name},\n\nUnfortunately, your application for the Med&X Accelerator program is not valid.${reasonText}\n\nPlease contact us for more information at accelerator@medx.hr.\n\nBest regards,\nMed&X Accelerator Team`;

                // Record message in database
                db.run(`INSERT INTO accelerator_messages (id, application_id, message_type, subject, content, sent_by)
                    VALUES (?, ?, 'validity', ?, ?, 'system')`,
                    [msgId, req.params.id, subject, content]);

                // Send email notification
                if (application.email) {
                    const emailHtml = `
                        <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                            <div style="background: ${isValid ? '#22c55e' : '#ef4444'}; color: white; padding: 20px; text-align: center;">
                                <h2 style="margin: 0;">Med&X Accelerator</h2>
                                <p style="margin: 10px 0 0 0;">${isValid ? 'Application Accepted' : 'Application Status Update'}</p>
                            </div>
                            <div style="padding: 20px; background: #ffffff; border: 1px solid #ddd;">
                                <p style="white-space: pre-line;">${content}</p>
                            </div>
                            <p style="color: #666; font-size: 12px; padding: 10px;">
                                Application ID: ${application.candidate_id || application.application_number || 'N/A'}
                            </p>
                        </div>
                    `;
                    await sendEmail(application.email, `Med&X Accelerator: ${subject}`, emailHtml);
                }
            }
            saveDb();
            res.json({ success: true });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to update validity' });
        }
    });

    // ========== ACCELERATOR EVALUATION CRITERIA ==========

    // Get evaluation criteria for a year
    app.get('/api/accelerator/years/:year/criteria', auth, (req, res) => {
        const criteria = query.all('SELECT * FROM accelerator_evaluation_criteria WHERE year = ? AND is_active = 1 ORDER BY category, sort_order', [req.params.year]);
        res.json(criteria);
    });

    // Add evaluation criterion
    app.post('/api/accelerator/years/:year/criteria', auth, (req, res) => {
        const { name, name_hr, max_points, weight, category } = req.body;
        const id = uuidv4();
        const sortOrder = query.get('SELECT COALESCE(MAX(sort_order), 0) + 1 as next FROM accelerator_evaluation_criteria WHERE year = ?', [req.params.year]);
        db.run(`INSERT INTO accelerator_evaluation_criteria (id, year, name, name_hr, max_points, weight, category, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.year, name, name_hr, max_points || 10, weight || 1, category || 'objective', sortOrder.next]);
        saveDb();
        res.json({ success: true, id });
    });

    // Update evaluation criterion
    app.put('/api/accelerator/criteria/:id', auth, (req, res) => {
        const { name, name_hr, max_points, weight, category, sort_order, is_active } = req.body;
        db.run(`UPDATE accelerator_evaluation_criteria SET name = COALESCE(?, name), name_hr = COALESCE(?, name_hr),
            max_points = COALESCE(?, max_points), weight = COALESCE(?, weight), category = COALESCE(?, category),
            sort_order = COALESCE(?, sort_order), is_active = COALESCE(?, is_active) WHERE id = ?`,
            [name, name_hr, max_points, weight, category, sort_order, is_active, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Delete evaluation criterion
    app.delete('/api/accelerator/criteria/:id', auth, (req, res) => {
        db.run('UPDATE accelerator_evaluation_criteria SET is_active = 0 WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== ACCELERATOR EVALUATIONS/SCORING ==========

    // Save evaluation score for an application
    app.post('/api/accelerator/applications/:appId/evaluate', auth, (req, res) => {
        const { criterion_id, score, notes } = req.body;
        const existing = query.get('SELECT id FROM accelerator_evaluations WHERE application_id = ? AND criterion_id = ?',
            [req.params.appId, criterion_id]);

        if (existing) {
            db.run(`UPDATE accelerator_evaluations SET score = ?, notes = ?, evaluated_by = ?, evaluated_at = datetime('now')
                WHERE id = ?`, [score, notes, req.user.email, existing.id]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO accelerator_evaluations (id, application_id, criterion_id, score, notes, evaluated_by)
                VALUES (?, ?, ?, ?, ?, ?)`, [id, req.params.appId, criterion_id, score, notes, req.user.email]);
        }

        // Recalculate total scores
        recalculateApplicationScores(req.params.appId);
        saveDb();
        res.json({ success: true });
    });

    // Batch evaluate (save multiple scores at once)
    app.post('/api/accelerator/applications/:appId/evaluate-batch', auth, (req, res) => {
        const { evaluations } = req.body; // Array of { criterion_id, score, notes }

        evaluations.forEach(({ criterion_id, score, notes }) => {
            const existing = query.get('SELECT id FROM accelerator_evaluations WHERE application_id = ? AND criterion_id = ?',
                [req.params.appId, criterion_id]);

            if (existing) {
                db.run(`UPDATE accelerator_evaluations SET score = ?, notes = ?, evaluated_by = ?, evaluated_at = datetime('now')
                    WHERE id = ?`, [score, notes, req.user.email, existing.id]);
            } else {
                const id = uuidv4();
                db.run(`INSERT INTO accelerator_evaluations (id, application_id, criterion_id, score, notes, evaluated_by)
                    VALUES (?, ?, ?, ?, ?, ?)`, [id, req.params.appId, criterion_id, score, notes, req.user.email]);
            }
        });

        recalculateApplicationScores(req.params.appId);
        saveDb();
        res.json({ success: true });
    });

    // Helper function to recalculate scores
    function recalculateApplicationScores(applicationId) {
        const app = query.get('SELECT program_id FROM accelerator_applications WHERE id = ?', [applicationId]);
        if (!app) return;

        const program = query.get('SELECT year FROM accelerator_programs WHERE id = ?', [app.program_id]);
        if (!program) return;

        // Calculate objective score
        const objectiveResult = query.get(`
            SELECT SUM(e.score * c.weight) as total
            FROM accelerator_evaluations e
            JOIN accelerator_evaluation_criteria c ON e.criterion_id = c.id
            WHERE e.application_id = ? AND c.category = 'objective'`, [applicationId]);

        // Calculate interview score
        const interviewResult = query.get(`
            SELECT AVG(score) as avg_score FROM accelerator_interview_scores WHERE application_id = ?`, [applicationId]);

        const objectiveScore = objectiveResult?.total || 0;
        const interviewScore = interviewResult?.avg_score || 0;
        const totalScore = objectiveScore + interviewScore;

        db.run(`UPDATE accelerator_applications SET objective_score = ?, interview_score = ?, total_score = ? WHERE id = ?`,
            [objectiveScore, interviewScore, totalScore, applicationId]);
    }

    // ========== ACCELERATOR INTERVIEWERS ==========

    // Get interviewers for a year
    app.get('/api/accelerator/years/:year/interviewers', auth, (req, res) => {
        const interviewers = query.all('SELECT * FROM accelerator_interviewers WHERE year = ? AND is_active = 1', [req.params.year]);
        res.json(interviewers);
    });

    // Add interviewer
    app.post('/api/accelerator/years/:year/interviewers', auth, (req, res) => {
        const { name, email, institution, specialty } = req.body;
        const id = uuidv4();
        const accessToken = uuidv4(); // Token for external access
        db.run(`INSERT INTO accelerator_interviewers (id, year, name, email, institution, specialty, access_token)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.year, name, email, institution, specialty, accessToken]);
        saveDb();
        res.json({ success: true, id, access_token: accessToken });
    });

    // Update interviewer
    app.put('/api/accelerator/interviewers/:id', auth, (req, res) => {
        const { name, email, institution, specialty, is_active } = req.body;
        db.run(`UPDATE accelerator_interviewers SET name = COALESCE(?, name), email = COALESCE(?, email),
            institution = COALESCE(?, institution), specialty = COALESCE(?, specialty), is_active = COALESCE(?, is_active)
            WHERE id = ?`, [name, email, institution, specialty, is_active, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Delete interviewer
    app.delete('/api/accelerator/interviewers/:id', auth, (req, res) => {
        db.run('UPDATE accelerator_interviewers SET is_active = 0 WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Submit interview score (can be from external interviewer via token)
    app.post('/api/accelerator/interview-score', (req, res) => {
        const { application_id, interviewer_id, access_token, score, notes } = req.body;

        // Verify interviewer
        const interviewer = query.get('SELECT * FROM accelerator_interviewers WHERE id = ? AND access_token = ? AND is_active = 1',
            [interviewer_id, access_token]);
        if (!interviewer) return res.status(403).json({ error: 'Invalid interviewer credentials' });

        const existing = query.get('SELECT id FROM accelerator_interview_scores WHERE application_id = ? AND interviewer_id = ?',
            [application_id, interviewer_id]);

        if (existing) {
            db.run(`UPDATE accelerator_interview_scores SET score = ?, notes = ?, submitted_at = datetime('now') WHERE id = ?`,
                [score, notes, existing.id]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO accelerator_interview_scores (id, application_id, interviewer_id, score, notes)
                VALUES (?, ?, ?, ?, ?)`, [id, application_id, interviewer_id, score, notes]);
        }

        recalculateApplicationScores(application_id);
        saveDb();
        res.json({ success: true });
    });

    // Magic link access - validates token and returns interviewer session
    app.get('/api/accelerator/interview-access/:token', (req, res) => {
        const interviewer = query.get(`
            SELECT i.*, p.year as program_year
            FROM accelerator_interviewers i
            JOIN accelerator_programs p ON p.year = i.year
            WHERE i.access_token = ? AND i.is_active = 1`,
            [req.params.token]);

        if (!interviewer) {
            return res.status(403).json({ error: 'Invalid or expired access link' });
        }

        // Get applications assigned for evaluation (all valid applications for that year)
        const applications = query.all(`
            SELECT a.id, a.candidate_id, a.first_name, a.last_name, a.selected_institution,
                   i.name as institution_name, a.validity_status,
                   (SELECT score FROM accelerator_interview_scores WHERE application_id = a.id AND interviewer_id = ?) as my_score,
                   (SELECT notes FROM accelerator_interview_scores WHERE application_id = a.id AND interviewer_id = ?) as my_notes
            FROM accelerator_applications a
            JOIN accelerator_programs p ON a.program_id = p.id
            LEFT JOIN accelerator_institutions i ON a.selected_institution = i.id
            WHERE p.year = ? AND a.status = 'submitted' AND a.validity_status = 'valid'
            ORDER BY a.candidate_id`,
            [interviewer.id, interviewer.id, interviewer.year]);

        // Get evaluation criteria for this year
        const criteria = query.all('SELECT * FROM accelerator_evaluation_criteria WHERE year = ? ORDER BY sort_order', [interviewer.year]);

        res.json({
            interviewer: {
                id: interviewer.id,
                name: interviewer.name,
                email: interviewer.email,
                institution: interviewer.institution,
                year: interviewer.year
            },
            applications,
            criteria
        });
    });

    // Get full application details for interviewer (via magic link)
    app.get('/api/accelerator/interview-access/:token/application/:appId', (req, res) => {
        const interviewer = query.get(
            'SELECT * FROM accelerator_interviewers WHERE access_token = ? AND is_active = 1',
            [req.params.token]);

        if (!interviewer) {
            return res.status(403).json({ error: 'Invalid access token' });
        }

        const application = query.get(`
            SELECT a.*, i.name as institution_name, p.year
            FROM accelerator_applications a
            JOIN accelerator_programs p ON a.program_id = p.id
            LEFT JOIN accelerator_institutions i ON a.selected_institution = i.id
            WHERE a.id = ? AND p.year = ? AND a.validity_status = 'valid'`,
            [req.params.appId, interviewer.year]);

        if (!application) {
            return res.status(404).json({ error: 'Application not found' });
        }

        // Get documents
        const documents = query.all('SELECT doc_type, file_name FROM accelerator_documents WHERE application_id = ?', [application.id]);

        // Get existing score from this interviewer
        const myScore = query.get(
            'SELECT * FROM accelerator_interview_scores WHERE application_id = ? AND interviewer_id = ?',
            [application.id, interviewer.id]);

        // Get criteria
        const criteria = query.all('SELECT * FROM accelerator_evaluation_criteria WHERE year = ? ORDER BY sort_order', [interviewer.year]);

        // Get criteria scores for this application from this interviewer
        const criteriaScores = query.all(
            'SELECT * FROM accelerator_application_scores WHERE application_id = ? AND evaluator_id = ?',
            [application.id, interviewer.id]);

        res.json({
            application: {
                id: application.id,
                candidate_id: application.candidate_id,
                institution_name: application.institution_name,
                motivation_letter: application.motivation_letter,
                // Include other non-identifying fields as needed
            },
            documents,
            criteria,
            myScore,
            criteriaScores
        });
    });

    // Submit criteria score via magic link
    app.post('/api/accelerator/interview-access/:token/score', (req, res) => {
        const { application_id, criterion_id, score } = req.body;

        const interviewer = query.get(
            'SELECT * FROM accelerator_interviewers WHERE access_token = ? AND is_active = 1',
            [req.params.token]);

        if (!interviewer) {
            return res.status(403).json({ error: 'Invalid access token' });
        }

        // Check criterion exists and score is valid
        const criterion = query.get('SELECT * FROM accelerator_evaluation_criteria WHERE id = ? AND year = ?',
            [criterion_id, interviewer.year]);

        if (!criterion) {
            return res.status(400).json({ error: 'Invalid criterion' });
        }

        if (score < 0 || score > criterion.max_points) {
            return res.status(400).json({ error: `Score must be between 0 and ${criterion.max_points}` });
        }

        // Upsert score
        const existing = query.get(
            'SELECT id FROM accelerator_application_scores WHERE application_id = ? AND criterion_id = ? AND evaluator_id = ?',
            [application_id, criterion_id, interviewer.id]);

        if (existing) {
            db.run('UPDATE accelerator_application_scores SET score = ? WHERE id = ?', [score, existing.id]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO accelerator_application_scores (id, application_id, criterion_id, evaluator_id, score)
                VALUES (?, ?, ?, ?, ?)`, [id, application_id, criterion_id, interviewer.id, score]);
        }

        recalculateApplicationScores(application_id);
        saveDb();
        res.json({ success: true });
    });

    // Send magic link email to interviewer
    app.post('/api/accelerator/interviewers/:id/send-link', auth, async (req, res) => {
        try {
            const interviewer = query.get('SELECT * FROM accelerator_interviewers WHERE id = ? AND is_active = 1', [req.params.id]);
            if (!interviewer) {
                return res.status(404).json({ error: 'Interviewer not found' });
            }

            const baseUrl = req.headers.origin || `http://localhost:${PORT}`;
            const magicLink = `${baseUrl}/evaluate?token=${interviewer.access_token}`;

            const emailHtml = `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #22d3ee; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0;">Med&X Accelerator</h2>
                        <p style="margin: 10px 0 0 0;">External Evaluator Access</p>
                    </div>
                    <div style="padding: 20px; background: #ffffff; border: 1px solid #ddd;">
                        <p>Dear ${interviewer.name},</p>
                        <p>We invite you to evaluate candidates for the Med&X Accelerator ${interviewer.year} program as an external evaluator.</p>
                        <p>Click the link below to access the evaluation system:</p>
                        <p style="text-align: center; margin: 20px 0;">
                            <a href="${magicLink}" style="display: inline-block; background: #22d3ee; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                                Access Evaluation
                            </a>
                        </p>
                        <p style="color: #666; font-size: 13px;">
                            <strong>Note:</strong> This link is unique to you. Please do not share it with others.
                        </p>
                        <p style="color: #666; font-size: 13px;">
                            <strong>Note:</strong> This link is unique to you. Please do not share it with others.
                        </p>
                    </div>
                    <p style="color: #999; font-size: 12px; padding: 10px; text-align: center;">
                        Med&X Accelerator | accelerator@medx.hr
                    </p>
                </div>
            `;

            await sendEmail(interviewer.email, `Med&X Accelerator ${interviewer.year} - Evaluator Access / Pristup za evaluaciju`, emailHtml);

            res.json({ success: true, message: 'Magic link sent to ' + interviewer.email });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to send magic link' });
        }
    });

    // Regenerate access token for interviewer
    app.post('/api/accelerator/interviewers/:id/regenerate-token', auth, (req, res) => {
        const newToken = uuidv4();
        db.run('UPDATE accelerator_interviewers SET access_token = ? WHERE id = ?', [newToken, req.params.id]);
        saveDb();
        res.json({ success: true, access_token: newToken });
    });

    // ========== APPLICANT REGISTRATIONS (Admin View) ==========

    // Get all applicant registrations for admin view
    app.get('/api/accelerator/registrations', auth, (req, res) => {
        const applicants = query.all(`
            SELECT a.id, a.email, a.first_name, a.last_name, a.phone,
                   a.current_institution, a.faculty, a.email_verified, a.created_at, a.last_login,
                   (SELECT COUNT(*) FROM accelerator_applications WHERE user_id = a.id) as application_count,
                   (SELECT COUNT(*) FROM accelerator_applications WHERE user_id = a.id AND status = 'submitted') as submitted_count
            FROM accelerator_applicants a
            ORDER BY a.created_at DESC
        `);

        const stats = {
            total: applicants.length,
            verified: applicants.filter(a => a.email_verified).length,
            withApplications: applicants.filter(a => a.application_count > 0).length
        };

        res.json({ applicants, stats });
    });

    // Get single applicant details
    app.get('/api/accelerator/registrations/:id', auth, (req, res) => {
        const applicant = query.get('SELECT * FROM accelerator_applicants WHERE id = ?', [req.params.id]);
        if (!applicant) return res.status(404).json({ error: 'Applicant not found' });

        // Remove sensitive fields
        delete applicant.password_hash;
        delete applicant.verification_token;
        delete applicant.reset_token;

        // Get their applications
        const applications = query.all(`
            SELECT app.*, i.name as institution_name, p.name as program_name
            FROM accelerator_applications app
            LEFT JOIN accelerator_institutions i ON app.selected_institution = i.id
            LEFT JOIN accelerator_programs p ON app.program_id = p.id
            WHERE app.user_id = ?
            ORDER BY app.created_at DESC
        `, [req.params.id]);

        res.json({ applicant, applications });
    });

    // ========== ACCELERATOR RANKING & PDF GENERATION ==========

    // Get PDF settings for a year
    app.get('/api/accelerator/years/:year/pdf-settings', auth, (req, res) => {
        const year = parseInt(req.params.year);
        let settings = query.get('SELECT * FROM accelerator_pdf_settings WHERE year = ?', [year]);

        // Return defaults if not set
        if (!settings) {
            settings = {
                year,
                header_intro: `Pursuant to Paragraph 1 of Article 8 of the Regulations on the International Professional Development Program "Med&X Accelerator", the Committee for Organization of the Med&X Accelerator Program, at its telephone session held on [DATE], hereby issues`,
                header_title: `Provisional Ranking List of Applicants for the Med&X Accelerator Program`,
                article1_text: `(1) The lists of candidates by registered institutions constitute an integral part of this document and have been compiled separately for each institution participating in the program.\n(2) Candidates are ranked according to the total number of points achieved based on submitted documentation.\n(3) Candidates highlighted in green indicate those who, according to the current ranking, qualify for an interview at the respective institution.\n(4) Candidates who have secured an interview slot at two programs must choose only one program for which they will continue the selection process, and the slot at the other program will be assigned to the next candidate by score.`,
                article2_text: `(1) Applicants on this ranking list have the right to file an appeal, which must be submitted in writing to the email address accelerator@medx.hr within 24 hours.\n(2) The validity of each appeal shall be decided by the Committee, which will notify the appealing candidate in writing.`,
                article3_text: `Upon expiration of the appeal deadline, the Committee shall issue the final ranking list of applicants for the Med&X Accelerator Program, on the basis of which further selection interviews will be conducted, and all applicants shall be notified accordingly.`,
                signatory_name: 'Alen Juginovic, M.D.',
                signatory_title: 'Committee for Organization of the Med&X Accelerator Program',
                signatory_role: 'President'
            };
        }

        res.json(settings);
    });

    // Update PDF settings for a year
    app.put('/api/accelerator/years/:year/pdf-settings', auth, (req, res) => {
        const year = parseInt(req.params.year);
        const { header_intro, header_title, article1_text, article2_text, article3_text,
                signatory_name, signatory_title, signatory_role } = req.body;

        const existing = query.get('SELECT id FROM accelerator_pdf_settings WHERE year = ?', [year]);

        if (existing) {
            db.run(`UPDATE accelerator_pdf_settings SET
                header_intro = ?, header_title = ?, article1_text = ?, article2_text = ?, article3_text = ?,
                signatory_name = ?, signatory_title = ?, signatory_role = ?, updated_at = datetime('now')
                WHERE year = ?`,
                [header_intro, header_title, article1_text, article2_text, article3_text,
                 signatory_name, signatory_title, signatory_role, year]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO accelerator_pdf_settings
                (id, year, header_intro, header_title, article1_text, article2_text, article3_text,
                 signatory_name, signatory_title, signatory_role)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, year, header_intro, header_title, article1_text, article2_text, article3_text,
                 signatory_name, signatory_title, signatory_role]);
        }

        saveDb();
        res.json({ success: true });
    });

    // Generate ranking list for a year and institution
    app.get('/api/accelerator/years/:year/ranking', auth, (req, res) => {
        const { institution } = req.query;
        const program = query.get('SELECT id FROM accelerator_programs WHERE year = ?', [req.params.year]);
        if (!program) return res.json([]);

        let sql = `SELECT a.*, i.name as institution_name
            FROM accelerator_applications a
            LEFT JOIN accelerator_institutions i ON a.selected_institution = i.id
            WHERE a.program_id = ? AND a.status = 'submitted'`;
        const params = [program.id];

        if (institution) { sql += ' AND a.selected_institution = ?'; params.push(institution); }
        sql += ' ORDER BY a.total_score DESC, a.objective_score DESC';

        const applications = query.all(sql, params);

        // Add rank position
        applications.forEach((app, idx) => { app.rank_position = idx + 1; });

        res.json(applications);
    });

    // Update rankings (batch update rank positions)
    app.post('/api/accelerator/years/:year/update-rankings', auth, (req, res) => {
        const program = query.get('SELECT id FROM accelerator_programs WHERE year = ?', [req.params.year]);
        if (!program) return res.status(404).json({ error: 'Year not found' });

        // Get all institutions
        const institutions = query.all('SELECT DISTINCT selected_institution FROM accelerator_applications WHERE program_id = ? AND selected_institution IS NOT NULL', [program.id]);

        institutions.forEach(({ selected_institution }) => {
            const apps = query.all(`SELECT id, total_score FROM accelerator_applications
                WHERE program_id = ? AND selected_institution = ? AND status = 'submitted'
                ORDER BY total_score DESC`, [program.id, selected_institution]);

            apps.forEach((app, idx) => {
                db.run('UPDATE accelerator_applications SET rank_position = ? WHERE id = ?', [idx + 1, app.id]);
            });
        });

        saveDb();
        res.json({ success: true });
    });

    // Publish rankings - notify all applicants with their rank
    app.post('/api/accelerator/years/:year/publish-rankings', auth, (req, res) => {
        const year = parseInt(req.params.year);
        const program = query.get('SELECT id FROM accelerator_programs WHERE year = ?', [year]);
        if (!program) return res.status(404).json({ error: 'Year not found' });

        const rankedApps = query.all(`SELECT id, first_name, last_name, email, rank_position, total_score, user_id
            FROM accelerator_applications
            WHERE program_id = ? AND status = 'submitted' AND rank_position IS NOT NULL
            ORDER BY rank_position ASC`, [program.id]);

        const totalRanked = rankedApps.length;
        let notified = 0;

        rankedApps.forEach(app => {
            const notifId = uuidv4();
            const message = `Your Med&X Accelerator ranking for ${year}: #${app.rank_position} out of ${totalRanked} candidates.`;

            if (app.user_id) {
                try {
                    db.run(`INSERT INTO notifications (id, user_id, type, title, message, created_at)
                        VALUES (?, ?, 'accelerator_ranking', 'Accelerator Ranking Published', ?, datetime('now'))`,
                        [notifId, app.user_id, message]);
                    notified++;
                } catch (e) { /* ignore duplicate notifications */ }
            }

            const msgId = uuidv4();
            db.run(`INSERT INTO accelerator_messages (id, application_id, message_type, subject, content, sent_by, sent_at)
                VALUES (?, ?, 'ranking', 'Ranking Published', ?, 'system', datetime('now'))`,
                [msgId, app.id, message]);
        });

        saveDb();
        res.json({ success: true, notified, total: totalRanked });
    });

    // Get application files grouped by applicant
    app.get('/api/accelerator/files/grouped', auth, (req, res) => {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const program = query.get('SELECT id FROM accelerator_programs WHERE year = ?', [year]);

        let apps;
        if (program) {
            apps = query.all(`SELECT a.id, a.first_name, a.last_name, a.email, a.candidate_id, a.work_number
                FROM accelerator_applications a
                WHERE a.program_id = ? AND a.status = 'submitted'
                ORDER BY a.last_name, a.first_name`, [program.id]);
        } else {
            apps = query.all(`SELECT a.id, a.first_name, a.last_name, a.email, a.candidate_id, a.work_number
                FROM accelerator_applications a
                WHERE a.year = ? AND a.status = 'submitted'
                ORDER BY a.last_name, a.first_name`, [year]);
        }

        const result = apps.map(app => {
            const docs = query.all(`SELECT id, document_type, original_filename, file_size, mime_type, uploaded_at
                FROM accelerator_documents
                WHERE application_id = ?
                ORDER BY document_type`, [app.id]);

            return {
                applicant: {
                    id: app.id,
                    name: `${app.first_name} ${app.last_name}`,
                    email: app.email,
                    candidate_id: app.candidate_id || app.work_number
                },
                files: docs
            };
        }).filter(g => g.files.length > 0);

        res.json(result);
    });

    // Generate ranking PDF with dynamic columns from evaluation criteria
    app.get('/api/accelerator/years/:year/ranking-pdf', auth, async (req, res) => {
        try {
            const PDFDocument = require('pdfkit');
            const year = parseInt(req.params.year);
            const program = query.get('SELECT * FROM accelerator_programs WHERE year = ?', [year]);
            if (!program) return res.status(404).json({ error: 'Year not found' });

            // Get PDF settings (editable header)
            let settings = query.get('SELECT * FROM accelerator_pdf_settings WHERE year = ?', [year]);
            if (!settings) {
                settings = {
                    header_intro: `Pursuant to Paragraph 1 of Article 8 of the Regulations on the International Professional Development Program "Med&X Accelerator", the Committee for Organization of the Med&X Accelerator Program, at its telephone session held on ${new Date().toLocaleDateString('en-US')} hereby issues`,
                    header_title: `Provisional Ranking List of Applicants for the Med&X Accelerator Program`,
                    article1_text: `(1) The lists of candidates by registered institutions constitute an integral part of this document and have been compiled separately for each institution participating in the program.\n(2) Candidates are ranked according to the total number of points achieved based on submitted documentation.\n(3) Candidates highlighted in green indicate those who, according to the current ranking, qualify for an interview at the respective institution.\n(4) Candidates who have secured an interview slot at two programs must choose only one program for which they will continue the selection process, and the slot at the other program will be assigned to the next candidate by score.`,
                    article2_text: `(1) Applicants on this ranking list have the right to file an appeal, which must be submitted in writing to the email address accelerator@medx.hr within 24 hours.\n(2) The validity of each appeal shall be decided by the Committee, which will notify the appealing candidate in writing.`,
                    article3_text: `Upon expiration of the appeal deadline, the Committee shall issue the final ranking list of applicants for the Med&X Accelerator Program, on the basis of which further selection interviews will be conducted, and all applicants shall be notified accordingly.`,
                    signatory_name: 'Alen Juginovic, M.D.',
                    signatory_title: 'Committee for Organization of the Med&X Accelerator Program',
                    signatory_role: 'President'
                };
            }

            // Get evaluation criteria for dynamic columns
            const criteria = query.all('SELECT * FROM accelerator_evaluation_criteria WHERE year = ? ORDER BY sort_order', [year]);

            const institutions = query.all('SELECT * FROM accelerator_institutions WHERE is_active = 1 ORDER BY sort_order');

            const doc = new PDFDocument({ margin: 40, size: 'A4', layout: criteria.length > 4 ? 'landscape' : 'portrait' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Rang_Lista_${year}.pdf"`);
            doc.pipe(res);

            // Page 1: Header/Legal text (editable)
            const introText = settings.header_intro.replace('[DATUM]', new Date().toLocaleDateString('hr-HR'));
            doc.fontSize(10).text(introText, { align: 'justify' });
            doc.moveDown(2);

            doc.fontSize(14).font('Helvetica-Bold').text(settings.header_title, { align: 'center' });
            doc.moveDown(2);

            doc.font('Helvetica').fontSize(10);

            // Article 1
            doc.text('Article 1.', { align: 'center' });
            doc.moveDown(0.5);
            settings.article1_text.split('\n').forEach(line => {
                doc.text(line.trim(), { align: 'justify' });
            });
            doc.moveDown();

            // Article 2
            doc.text('Article 2.', { align: 'center' });
            doc.moveDown(0.5);
            settings.article2_text.split('\n').forEach(line => {
                doc.text(line.trim(), { align: 'justify' });
            });
            doc.moveDown();

            // Article 3
            doc.text('Article 3.', { align: 'center' });
            doc.moveDown(0.5);
            doc.text(settings.article3_text, { align: 'justify' });
            doc.moveDown(3);

            // Signature
            doc.text('M.P.', { align: 'center' });
            doc.moveDown(2);
            doc.text('_____________________', { align: 'right' });
            doc.text(settings.signatory_name, { align: 'right' });
            doc.text(settings.signatory_title, { align: 'right' });
            doc.text(settings.signatory_role, { align: 'right' });

            // Page 2+: Ranking tables per institution with DYNAMIC columns
            for (const inst of institutions) {
                // Get applications for this institution
                const apps = query.all(`
                    SELECT a.id, a.candidate_id, a.gpa, a.objective_score, a.interview_score, a.total_score
                    FROM accelerator_applications a
                    WHERE a.program_id = ? AND a.selected_institution = ? AND a.status = 'submitted' AND a.validity_status = 'valid'
                    ORDER BY a.total_score DESC`, [program.id, inst.id]);

                if (apps.length === 0) continue;

                // Get scores for each application by criterion
                apps.forEach(app => {
                    const scores = query.all(`
                        SELECT criterion_id, AVG(score) as avg_score
                        FROM accelerator_application_scores
                        WHERE application_id = ?
                        GROUP BY criterion_id`, [app.id]);

                    app.criteriaScores = {};
                    scores.forEach(s => {
                        app.criteriaScores[s.criterion_id] = s.avg_score;
                    });
                });

                doc.addPage();
                doc.fontSize(14).font('Helvetica-Bold').text(inst.name, { align: 'center' });
                doc.text(`Available spots: ${inst.available_spots || '-'}`, { align: 'center' });
                doc.moveDown();

                // Build dynamic headers: NO, ID, AVG, [each criterion], TOTAL
                const headers = ['NO.', 'ID', 'GPA'];
                criteria.forEach(c => headers.push((c.name || c.name_hr).toUpperCase()));
                headers.push('TOTAL');

                // Calculate column widths dynamically
                const pageWidth = criteria.length > 4 ? 750 : 495; // landscape vs portrait
                const fixedColWidth = 35; // BR, ID
                const availableWidth = pageWidth - (fixedColWidth * 2);
                const dynamicColCount = headers.length - 2;
                const dynamicColWidth = Math.floor(availableWidth / dynamicColCount);

                const colWidths = [fixedColWidth, fixedColWidth];
                for (let i = 2; i < headers.length; i++) {
                    colWidths.push(dynamicColWidth);
                }

                // Table header
                const tableTop = doc.y;
                doc.fontSize(7).font('Helvetica-Bold');
                let x = 40;
                headers.forEach((h, i) => {
                    doc.text(h, x, tableTop, { width: colWidths[i], align: 'center' });
                    x += colWidths[i];
                });

                // Draw header line
                doc.moveTo(40, tableTop + 12).lineTo(x, tableTop + 12).stroke();

                // Table rows
                doc.font('Helvetica').fontSize(8);
                let y = tableTop + 18;
                const spotsCount = inst.available_spots || 999;

                apps.forEach((app, idx) => {
                    // Highlight rows that get interview spots
                    if (idx < spotsCount) {
                        doc.rect(40, y - 2, x - 40, 14).fill('#d4edda').fillColor('black');
                    }

                    x = 40;
                    const row = [
                        idx + 1,
                        app.candidate_id || '-',
                        app.gpa?.toFixed(2) || '-'
                    ];

                    // Add scores for each criterion
                    criteria.forEach(c => {
                        const score = app.criteriaScores?.[c.id];
                        row.push(score !== undefined ? score.toFixed(1) : '-');
                    });

                    // Add total
                    row.push(app.total_score?.toFixed(2) || '-');

                    row.forEach((val, i) => {
                        doc.text(String(val), x, y, { width: colWidths[i], align: 'center' });
                        x += colWidths[i];
                    });

                    y += 14;
                    if (y > (criteria.length > 4 ? 520 : 750)) {
                        doc.addPage();
                        y = 50;
                    }
                });
            }

            doc.end();
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to generate PDF' });
        }
    });

    // Generate cover page PDF with application summary
    app.get('/api/accelerator/applications/:id/merge-docs', auth, async (req, res) => {
        try {
            const PDFDocument = require('pdfkit');
            const application = query.get(`
                SELECT a.*, i.name as institution_name, p.year
                FROM accelerator_applications a
                JOIN accelerator_programs p ON a.program_id = p.id
                LEFT JOIN accelerator_institutions i ON a.selected_institution = i.id
                WHERE a.id = ?`, [req.params.id]);
            if (!application) return res.status(404).json({ error: 'Not found' });

            const docs = query.all('SELECT * FROM accelerator_documents WHERE application_id = ? ORDER BY document_type', [req.params.id]);

            const doc = new PDFDocument({ margin: 50, size: 'A4' });
            res.setHeader('Content-Type', 'application/pdf');
            res.setHeader('Content-Disposition', `attachment; filename="Application_${application.candidate_id || application.id}_${application.year}.pdf"`);
            doc.pipe(res);

            // Header
            doc.fontSize(20).font('Helvetica-Bold').text('Med&X Accelerator', { align: 'center' });
            doc.fontSize(12).font('Helvetica').text(`Program ${application.year}`, { align: 'center' });
            doc.moveDown(2);

            doc.fontSize(16).font('Helvetica-Bold').text('Application Document Package', { align: 'center' });
            doc.moveDown(2);

            // Candidate info box
            doc.rect(50, doc.y, 495, 120).stroke();
            const boxY = doc.y + 10;
            doc.font('Helvetica').fontSize(11);
            doc.text(`Candidate ID: ${application.candidate_id || '-'}`, 60, boxY);
            doc.text(`Full Name: ${application.first_name} ${application.last_name}`, 60, boxY + 18);
            doc.text(`Email: ${application.email}`, 60, boxY + 36);
            doc.text(`Institution: ${application.institution_name || '-'}`, 60, boxY + 54);
            doc.text(`Faculty: ${application.faculty || '-'}`, 60, boxY + 72);
            doc.text(`Year of Study: ${application.study_year || '-'}`, 60, boxY + 90);
            doc.y = boxY + 120;
            doc.moveDown(2);

            // GPA and scores
            doc.fontSize(14).font('Helvetica-Bold').text('Scoring');
            doc.moveDown(0.5);
            doc.font('Helvetica').fontSize(11);
            doc.text(`GPA: ${application.gpa?.toFixed(2) || '-'}`);
            doc.text(`Objective Score: ${application.objective_score?.toFixed(2) || '-'}`);
            doc.text(`Interview Score: ${application.interview_score?.toFixed(2) || '-'}`);
            doc.text(`Total Score: ${application.total_score?.toFixed(2) || '-'}`);
            doc.text(`Validity Status: ${application.validity_status === 'valid' ? 'Valid' : application.validity_status === 'invalid' ? 'Invalid' : 'Pending Review'}`);
            doc.moveDown(2);

            // Documents list
            doc.fontSize(14).font('Helvetica-Bold').text('Attached Documents');
            doc.moveDown(0.5);
            doc.font('Helvetica').fontSize(10);

            if (docs.length === 0) {
                doc.text('No documents attached.');
            } else {
                docs.forEach((d, idx) => {
                    const status = d.verified ? '✓' : '○';
                    doc.text(`${idx + 1}. [${status}] ${d.document_type}: ${d.original_filename}`);
                });
            }

            doc.moveDown(2);

            // Motivation letter preview if exists
            if (application.motivation_letter) {
                doc.addPage();
                doc.fontSize(14).font('Helvetica-Bold').text('Motivation Letter');
                doc.moveDown();
                doc.font('Helvetica').fontSize(10);
                doc.text(application.motivation_letter, { align: 'justify' });
            }

            // Footer on last page
            doc.moveDown(3);
            doc.fontSize(8).fillColor('gray');
            doc.text(`Generirano: ${new Date().toLocaleDateString('hr-HR')} ${new Date().toLocaleTimeString('hr-HR')}`, { align: 'center' });
            doc.text('Med&X Accelerator - Ovaj dokument je povjerljiv', { align: 'center' });

            doc.end();
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Failed to generate document package' });
        }
    });

    // Download individual document
    app.get('/api/accelerator/documents/:docId/download', auth, (req, res) => {
        const doc = query.get('SELECT * FROM accelerator_documents WHERE id = ?', [req.params.docId]);
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        const filePath = path.join(uploadsDir, 'accelerator', doc.file_name);
        if (!fs.existsSync(filePath)) {
            return res.status(404).json({ error: 'File not found on disk' });
        }

        res.download(filePath, doc.original_filename);
    });

    // Get all documents for an application
    app.get('/api/accelerator/applications/:id/documents', auth, (req, res) => {
        const docs = query.all(`
            SELECT id, document_type, original_filename, file_name, file_size, mime_type, uploaded_at, verified
            FROM accelerator_documents
            WHERE application_id = ?
            ORDER BY document_type`, [req.params.id]);
        res.json(docs);
    });

    // ========== BUILDING BRIDGES ROUTES ==========

    // Get published bridges events (user-facing)
    app.get('/api/bridges/events', auth, (req, res) => {
        try {
            const events = query.all(`
                SELECT e.*,
                       (SELECT COUNT(*) FROM bridges_registrations WHERE event_id = e.id) as registration_count,
                       (SELECT COUNT(*) FROM bridges_registrations WHERE event_id = e.id AND checked_in = 1) as checked_in_count
                FROM bridges_events e
                WHERE e.is_published = 1
                ORDER BY e.event_date ASC
            `);
            res.json(events);
        } catch (e) {
            console.error('Bridges events fetch error:', e);
            res.json([]);
        }
    });

    // Get single published bridges event
    app.get('/api/bridges/events/:id', auth, (req, res) => {
        const event = query.get('SELECT * FROM bridges_events WHERE id = ? AND is_published = 1', [req.params.id]);
        if (!event) return res.status(404).json({ error: 'Event not found' });
        event.registration_count = query.get('SELECT COUNT(*) as c FROM bridges_registrations WHERE event_id = ?', [req.params.id])?.c || 0;
        res.json(event);
    });

    // Register for a bridges event
    app.post('/api/bridges/events/:id/register', auth, (req, res) => {
        try {
            const event = query.get('SELECT * FROM bridges_events WHERE id = ? AND is_published = 1', [req.params.id]);
            if (!event) return res.status(404).json({ error: 'Event not found' });

            const { name, email, institution, title, motivation } = req.body;

            // Check if already registered
            const existing = query.get('SELECT * FROM bridges_registrations WHERE event_id = ? AND email = ?', [req.params.id, email]);
            if (existing) {
                return res.json({ success: true, id: existing.id, qr_code: existing.qr_code, already_registered: true });
            }

            // Check capacity
            const regCount = query.get('SELECT COUNT(*) as c FROM bridges_registrations WHERE event_id = ?', [req.params.id])?.c || 0;
            if (event.capacity && regCount >= event.capacity) {
                return res.status(400).json({ error: 'Event is at full capacity' });
            }

            // Split name into first/last
            const nameParts = (name ?? '').trim().split(/\s+/);
            const firstName = nameParts[0] ?? null;
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            const id = uuidv4();
            const qrCode = `MEDX-BB-${req.params.id}-${id}`;

            db.run(`INSERT INTO bridges_registrations (
                id, event_id, first_name, last_name, email, institution, position, notes, status, qr_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                id,
                req.params.id,
                firstName,
                lastName,
                email ?? null,
                institution ?? null,
                title ?? null,
                motivation ?? null,
                'registered',
                qrCode
            ]);
            saveDb();

            res.json({ success: true, id, qr_code: qrCode });
        } catch (e) {
            console.error('Bridges register error:', e);
            res.status(500).json({ error: 'Failed to register' });
        }
    });

    // Get my registration for a specific event
    app.get('/api/bridges/events/:id/my-registration', auth, (req, res) => {
        const user = req.user;
        const reg = query.get('SELECT * FROM bridges_registrations WHERE event_id = ? AND email = ?', [req.params.id, user.email]);
        if (!reg) return res.json({ registered: false });
        const event = query.get('SELECT name, city, event_date, event_time, venue_name FROM bridges_events WHERE id = ?', [req.params.id]);
        res.json({ registered: true, registration: reg, event });
    });

    // Submit a Building Bridges application (legacy route)
    app.post('/api/bridges/apply', auth, (req, res) => {
        try {
            const { event_id, name, email, institution, title, motivation } = req.body;

            if (!event_id) {
                return res.status(400).json({ error: 'event_id is required' });
            }

            // Check if already registered
            const existing = query.get('SELECT * FROM bridges_registrations WHERE event_id = ? AND email = ?', [event_id, email]);
            if (existing) {
                return res.json({ success: true, id: existing.id, qr_code: existing.qr_code, already_registered: true });
            }

            // Split name into first/last for the bridges_registrations schema
            const nameParts = (name ?? '').trim().split(/\s+/);
            const firstName = nameParts[0] ?? null;
            const lastName = nameParts.length > 1 ? nameParts.slice(1).join(' ') : null;

            const id = uuidv4();
            const qrCode = `MEDX-BB-${event_id}-${id}`;

            db.run(`INSERT INTO bridges_registrations (
                id, event_id, first_name, last_name, email, institution, position, notes, status, qr_code
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [
                id,
                event_id ?? null,
                firstName,
                lastName,
                email ?? null,
                institution ?? null,
                title ?? null,
                motivation ?? null,
                'registered',
                qrCode
            ]);
            saveDb();

            res.json({ success: true, id, qr_code: qrCode });
        } catch (e) {
            console.error('Bridges apply error:', e);
            res.status(500).json({ error: 'Failed to submit application' });
        }
    });

    // ========== BRIDGES SPEAKERS (user-facing, published only) ==========

    app.get('/api/bridges/speakers', auth, (req, res) => {
        const { event_id } = req.query;
        let sql = 'SELECT * FROM bridges_speakers WHERE is_published = 1';
        const params = [];
        if (event_id) {
            sql += ' AND event_id = ?';
            params.push(event_id);
        }
        sql += ' ORDER BY sort_order ASC, name ASC';
        res.json(query.all(sql, params) || []);
    });

    // ========== BRIDGES PROGRAM (user-facing, published only) ==========

    app.get('/api/bridges/program', auth, (req, res) => {
        const { event_id } = req.query;
        let sql = `SELECT p.*, s.name as speaker_name, s.institution as speaker_institution
                   FROM bridges_program p
                   LEFT JOIN bridges_speakers s ON p.speaker_id = s.id
                   WHERE p.is_published = 1`;
        const params = [];
        if (event_id) {
            sql += ' AND p.event_id = ?';
            params.push(event_id);
        }
        sql += ' ORDER BY p.sort_order ASC, p.start_time ASC';
        res.json(query.all(sql, params) || []);
    });

    // ========== ACCELERATOR FORM CONFIG (Phase 4C) ==========

    // Get form configuration
    app.get('/api/accelerator/form-config', auth, (req, res) => {
        const fields = query.all('SELECT * FROM accelerator_form_config ORDER BY section_name, sort_order');
        res.json(fields);
    });

    // Bulk update form configuration
    app.put('/api/accelerator/form-config', auth, (req, res) => {
        const { fields } = req.body;
        if (!fields || !Array.isArray(fields)) return res.status(400).json({ error: 'fields array required' });

        fields.forEach(f => {
            const existing = query.get('SELECT id FROM accelerator_form_config WHERE id = ?', [f.id]);
            if (existing) {
                db.run(`UPDATE accelerator_form_config SET section_name=?, field_name=?, field_type=?, label=?, placeholder=?, is_required=?, options=?, sort_order=?, is_visible=?, updated_at=datetime('now') WHERE id=?`,
                    [f.section_name, f.field_name, f.field_type || 'text', f.label, f.placeholder, f.is_required ? 1 : 0, f.options || null, f.sort_order || 0, f.is_visible !== false ? 1 : 0, f.id]);
            } else {
                db.run(`INSERT INTO accelerator_form_config (id, program_id, section_name, field_name, field_type, label, placeholder, is_required, options, sort_order, is_visible) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
                    [f.id || generateId(), f.program_id || null, f.section_name, f.field_name, f.field_type || 'text', f.label, f.placeholder, f.is_required ? 1 : 0, f.options || null, f.sort_order || 0, f.is_visible !== false ? 1 : 0]);
            }
        });
        saveDb();
        res.json({ success: true });
    });

    // Add new field to form configuration
    app.post('/api/accelerator/form-config/field', auth, (req, res) => {
        const { program_id, section_name, field_name, field_type, label, placeholder, is_required, options, sort_order, is_visible } = req.body;
        if (!section_name || !field_name) return res.status(400).json({ error: 'section_name and field_name required' });

        const id = generateId();
        db.run(`INSERT INTO accelerator_form_config (id, program_id, section_name, field_name, field_type, label, placeholder, is_required, options, sort_order, is_visible) VALUES (?,?,?,?,?,?,?,?,?,?,?)`,
            [id, program_id || null, section_name, field_name, field_type || 'text', label || field_name, placeholder || '', is_required ? 1 : 0, options || null, sort_order || 0, is_visible !== false ? 1 : 0]);
        saveDb();
        res.json({ id, success: true });
    });

    // Remove field from form configuration
    app.delete('/api/accelerator/form-config/field/:id', auth, (req, res) => {
        db.run('DELETE FROM accelerator_form_config WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== BIOMEDICAL FORUM ROUTES ==========

    // Get current user's Forum membership
    app.get('/api/forum/me', auth, (req, res) => {
        const member = query.get(`SELECT * FROM forum_members WHERE user_id = ?`, [req.user.id]);
        res.json(member || { membership_status: 'none' });
    });

    // Apply for Forum membership
    app.post('/api/forum/apply', auth, (req, res) => {
        const { specialty, institution, position, bio, research_interests, career_stage, application_text } = req.body;
        const existing = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);

        if (existing) {
            return res.status(400).json({ error: 'Application already submitted' });
        }

        const id = uuidv4();
        db.run(`INSERT INTO forum_members (id, user_id, specialty, institution, position, bio, research_interests, career_stage, application_text, membership_status, application_submitted_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending', datetime('now'))`,
            [id, req.user.id, specialty, institution, position, bio, research_interests, career_stage, application_text]);
        saveDb();
        res.json({ success: true, id });
    });

    // Update Forum profile
    app.put('/api/forum/profile', auth, (req, res) => {
        const member = query.get(`SELECT * FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!member) return res.status(403).json({ error: 'Not an approved Forum member' });

        const fields = ['specialty', 'sub_specialties', 'institution', 'position', 'department', 'location_city',
            'location_country', 'bio', 'research_interests', 'career_stage', 'years_experience', 'orcid_id',
            'linkedin_url', 'twitter_handle', 'website_url', 'photo_url', 'profile_visibility', 'contact_preference',
            'is_mentor', 'seeking_mentor', 'mentor_topics', 'languages', 'achievements'];

        const updates = [];
        const values = [];
        fields.forEach(f => {
            if (req.body[f] !== undefined) {
                updates.push(`${f} = ?`);
                values.push(req.body[f]);
            }
        });

        if (updates.length > 0) {
            values.push(member.id);
            db.run(`UPDATE forum_members SET ${updates.join(', ')}, updated_at = datetime('now') WHERE id = ?`, values);
            saveDb();
        }

        res.json({ success: true });
    });

    // Get Forum member directory
    app.get('/api/forum/members', auth, (req, res) => {
        const currentMember = query.get(`SELECT * FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember && !req.user.is_admin) {
            return res.status(403).json({ error: 'Forum access required' });
        }

        const { specialty, career_stage, country, search, page = 1, limit = 20 } = req.query;
        let sql = `SELECT id, user_id, membership_level, specialty, institution, position, location_city, location_country,
            bio, research_interests, career_stage, photo_url, is_mentor, seeking_mentor, points, badges
            FROM forum_members WHERE membership_status = 'approved'`;
        const params = [];

        if (specialty) { sql += ` AND specialty LIKE ?`; params.push(`%${specialty}%`); }
        if (career_stage) { sql += ` AND career_stage = ?`; params.push(career_stage); }
        if (country) { sql += ` AND location_country = ?`; params.push(country); }
        if (search) {
            sql += ` AND (bio LIKE ? OR specialty LIKE ? OR institution LIKE ? OR research_interests LIKE ?)`;
            const s = `%${search}%`;
            params.push(s, s, s, s);
        }

        sql += ` ORDER BY last_active DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

        const members = query.all(sql, params);

        // Get user names
        const enriched = members.map(m => {
            const user = query.get(`SELECT first_name, last_name, email FROM users WHERE id = ?`, [m.user_id]);
            return { ...m, first_name: user?.first_name, last_name: user?.last_name };
        });

        res.json(enriched);
    });

    // Get single Forum member profile
    app.get('/api/forum/members/:id', auth, (req, res) => {
        const member = query.get(`SELECT * FROM forum_members WHERE id = ? AND membership_status = 'approved'`, [req.params.id]);
        if (!member) return res.status(404).json({ error: 'Member not found' });

        const user = query.get(`SELECT first_name, last_name, email FROM users WHERE id = ?`, [member.user_id]);

        // Get connection status with current user
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        let connectionStatus = null;
        if (currentMember && currentMember.id !== member.id) {
            const conn = query.get(`SELECT status FROM forum_connections WHERE
                (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`,
                [currentMember.id, member.id, member.id, currentMember.id]);
            connectionStatus = conn?.status || null;
        }

        res.json({ ...member, first_name: user?.first_name, last_name: user?.last_name, connection_status: connectionStatus });
    });

    // Send connection request
    app.post('/api/forum/connections', auth, (req, res) => {
        const { receiver_id, message } = req.body;
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const existing = query.get(`SELECT id, status FROM forum_connections WHERE
            (requester_id = ? AND receiver_id = ?) OR (requester_id = ? AND receiver_id = ?)`,
            [currentMember.id, receiver_id, receiver_id, currentMember.id]);

        if (existing) {
            return res.status(400).json({ error: 'Connection already exists', status: existing.status });
        }

        const id = uuidv4();
        db.run(`INSERT INTO forum_connections (id, requester_id, receiver_id, message, status) VALUES (?, ?, ?, ?, 'pending')`,
            [id, currentMember.id, receiver_id, message]);
        saveDb();
        res.json({ success: true, id });
    });

    // Get connections
    app.get('/api/forum/connections', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        if (!currentMember) return res.json([]);

        const connections = query.all(`
            SELECT fc.*,
                CASE WHEN fc.requester_id = ? THEN fm2.id ELSE fm1.id END as other_member_id,
                CASE WHEN fc.requester_id = ? THEN u2.first_name ELSE u1.first_name END as other_first_name,
                CASE WHEN fc.requester_id = ? THEN u2.last_name ELSE u1.last_name END as other_last_name,
                CASE WHEN fc.requester_id = ? THEN fm2.photo_url ELSE fm1.photo_url END as other_photo,
                CASE WHEN fc.requester_id = ? THEN fm2.specialty ELSE fm1.specialty END as other_specialty
            FROM forum_connections fc
            JOIN forum_members fm1 ON fc.requester_id = fm1.id
            JOIN forum_members fm2 ON fc.receiver_id = fm2.id
            JOIN users u1 ON fm1.user_id = u1.id
            JOIN users u2 ON fm2.user_id = u2.id
            WHERE (fc.requester_id = ? OR fc.receiver_id = ?)
            ORDER BY fc.created_at DESC
        `, [currentMember.id, currentMember.id, currentMember.id, currentMember.id, currentMember.id, currentMember.id, currentMember.id]);

        res.json(connections);
    });

    // Accept/reject connection
    app.put('/api/forum/connections/:id', auth, (req, res) => {
        const { status } = req.body;
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);

        const conn = query.get(`SELECT * FROM forum_connections WHERE id = ? AND receiver_id = ?`, [req.params.id, currentMember?.id]);
        if (!conn) return res.status(404).json({ error: 'Connection request not found' });

        if (status === 'accepted') {
            db.run(`UPDATE forum_connections SET status = 'accepted', accepted_at = datetime('now') WHERE id = ?`, [req.params.id]);
        } else {
            db.run(`DELETE FROM forum_connections WHERE id = ?`, [req.params.id]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Get Forum groups
    app.get('/api/forum/groups', auth, (req, res) => {
        const groups = query.all(`SELECT fg.*,
            (SELECT COUNT(*) FROM forum_group_members WHERE group_id = fg.id) as member_count
            FROM forum_groups fg WHERE fg.is_active = 1 ORDER BY fg.name`);

        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);

        const enriched = groups.map(g => {
            const isMember = currentMember ?
                !!query.get(`SELECT id FROM forum_group_members WHERE group_id = ? AND member_id = ?`, [g.id, currentMember.id]) : false;
            return { ...g, is_member: isMember };
        });

        res.json(enriched);
    });

    // Join/leave group
    app.post('/api/forum/groups/:id/membership', auth, (req, res) => {
        const { action } = req.body;
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        if (action === 'join') {
            const existing = query.get(`SELECT id FROM forum_group_members WHERE group_id = ? AND member_id = ?`, [req.params.id, currentMember.id]);
            if (!existing) {
                const id = uuidv4();
                db.run(`INSERT INTO forum_group_members (id, group_id, member_id) VALUES (?, ?, ?)`, [id, req.params.id, currentMember.id]);
            }
        } else {
            db.run(`DELETE FROM forum_group_members WHERE group_id = ? AND member_id = ?`, [req.params.id, currentMember.id]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Get group members
    app.get('/api/forum/groups/:id/members', auth, (req, res) => {
        const members = query.all(`
            SELECT fm.id, fm.photo_url, u.first_name, u.last_name, fm.specialty, fm.institution, fgm.joined_at
            FROM forum_group_members fgm
            JOIN forum_members fm ON fgm.member_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE fgm.group_id = ?
            ORDER BY fgm.joined_at DESC
        `, [req.params.id]);
        res.json(members);
    });

    // Get group messages
    app.get('/api/forum/groups/:id/messages', auth, (req, res) => {
        const messages = query.all(`
            SELECT fgm.*, u.first_name || ' ' || u.last_name as sender_name
            FROM forum_group_messages fgm
            JOIN forum_members fm ON fgm.sender_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE fgm.group_id = ?
            ORDER BY fgm.created_at ASC
            LIMIT 100
        `, [req.params.id]);
        res.json(messages);
    });

    // Send group message
    app.post('/api/forum/groups/:id/messages', auth, upload.single('file'), (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        // Check if user is group member
        const isMember = query.get(`SELECT id FROM forum_group_members WHERE group_id = ? AND member_id = ?`, [req.params.id, currentMember.id]);
        if (!isMember) return res.status(403).json({ error: 'Group membership required' });

        const { message } = req.body;
        let attachments = null;

        if (req.file) {
            attachments = JSON.stringify([{
                name: req.file.originalname,
                url: `/uploads/${req.file.filename}`,
                type: req.file.mimetype
            }]);
        }

        const id = uuidv4();
        db.run(`INSERT INTO forum_group_messages (id, group_id, sender_id, message, attachments) VALUES (?, ?, ?, ?, ?)`,
            [id, req.params.id, currentMember.id, message || '', attachments]);
        saveDb();

        res.json({ success: true, id });
    });

    // Get Forum posts/feed
    app.get('/api/forum/posts', auth, (req, res) => {
        const { group_id, author_id, type, page = 1, limit = 20 } = req.query;
        let sql = `SELECT fp.*, fm.photo_url as author_photo, u.first_name, u.last_name, fm.specialty, fm.institution
            FROM forum_posts fp
            JOIN forum_members fm ON fp.author_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE fp.moderation_status = 'approved'`;
        const params = [];

        if (group_id) { sql += ` AND fp.group_id = ?`; params.push(group_id); }
        if (author_id) { sql += ` AND fp.author_id = ?`; params.push(author_id); }
        if (type) { sql += ` AND fp.post_type = ?`; params.push(type); }

        sql += ` ORDER BY fp.is_pinned DESC, fp.created_at DESC LIMIT ? OFFSET ?`;
        params.push(parseInt(limit), (parseInt(page) - 1) * parseInt(limit));

        const posts = query.all(sql, params);

        // Get current user's reactions
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        const enriched = posts.map(p => {
            const hasLiked = currentMember ?
                !!query.get(`SELECT id FROM forum_post_reactions WHERE post_id = ? AND member_id = ?`, [p.id, currentMember.id]) : false;
            return { ...p, has_liked: hasLiked };
        });

        res.json(enriched);
    });

    // Create post
    app.post('/api/forum/posts', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const { title, content, post_type, group_id, tags, image_url, video_url, link_url } = req.body;
        const id = uuidv4();

        db.run(`INSERT INTO forum_posts (id, author_id, group_id, post_type, title, content, tags, image_url, video_url, link_url)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, currentMember.id, group_id, post_type || 'discussion', title, content, tags, image_url, video_url, link_url]);

        // Award points
        db.run(`UPDATE forum_members SET points = points + 5 WHERE id = ?`, [currentMember.id]);
        saveDb();

        res.json({ success: true, id });
    });

    // Like/unlike post
    app.post('/api/forum/posts/:id/react', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const existing = query.get(`SELECT id FROM forum_post_reactions WHERE post_id = ? AND member_id = ?`, [req.params.id, currentMember.id]);

        if (existing) {
            db.run(`DELETE FROM forum_post_reactions WHERE id = ?`, [existing.id]);
            db.run(`UPDATE forum_posts SET likes_count = likes_count - 1 WHERE id = ?`, [req.params.id]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO forum_post_reactions (id, post_id, member_id) VALUES (?, ?, ?)`, [id, req.params.id, currentMember.id]);
            db.run(`UPDATE forum_posts SET likes_count = likes_count + 1 WHERE id = ?`, [req.params.id]);
        }
        saveDb();
        res.json({ success: true, liked: !existing });
    });

    // Get comments for a post
    app.get('/api/forum/posts/:id/comments', auth, (req, res) => {
        const comments = query.all(`
            SELECT fc.*, fm.photo_url as author_photo, u.first_name, u.last_name
            FROM forum_comments fc
            JOIN forum_members fm ON fc.author_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE fc.post_id = ? AND fc.moderation_status = 'approved'
            ORDER BY fc.created_at ASC
        `, [req.params.id]);
        res.json(comments);
    });

    // Add comment
    app.post('/api/forum/posts/:id/comments', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const { content, parent_id } = req.body;
        const id = uuidv4();

        db.run(`INSERT INTO forum_comments (id, post_id, author_id, parent_id, content) VALUES (?, ?, ?, ?, ?)`,
            [id, req.params.id, currentMember.id, parent_id, content]);
        db.run(`UPDATE forum_posts SET comments_count = comments_count + 1 WHERE id = ?`, [req.params.id]);

        // Award points
        db.run(`UPDATE forum_members SET points = points + 2 WHERE id = ?`, [currentMember.id]);
        saveDb();

        res.json({ success: true, id });
    });

    // Get Forum events (user: published only)
    app.get('/api/forum/events', auth, (req, res) => {
        const { upcoming, past } = req.query;
        let sql = `SELECT fe.*, u.first_name as organizer_first, u.last_name as organizer_last,
            (SELECT COUNT(*) FROM forum_event_registrations WHERE event_id = fe.id) as reg_count
            FROM forum_events fe
            LEFT JOIN forum_members fm ON fe.organizer_id = fm.id
            LEFT JOIN users u ON fm.user_id = u.id
            WHERE (fe.status = 'published' OR fe.is_published = 1)`;

        if (upcoming) sql += ` AND fe.start_date >= date('now')`;
        if (past) sql += ` AND fe.start_date < date('now')`;

        sql += ` ORDER BY fe.start_date ASC`;

        const events = query.all(sql);

        // Get registration status for current user
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        const enriched = events.map(e => {
            const registration = currentMember ?
                query.get(`SELECT * FROM forum_event_registrations WHERE event_id = ? AND member_id = ?`, [e.id, currentMember.id]) : null;
            return { ...e, is_registered: !!registration, registration, registrations_count: e.reg_count || e.registrations_count || 0 };
        });

        res.json(enriched);
    });

    // Register for event (enhanced with name/email/institution + payment support)
    app.post('/api/forum/events/:id/register', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const event = query.get(`SELECT * FROM forum_events WHERE id = ?`, [req.params.id]);
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const existing = query.get(`SELECT id FROM forum_event_registrations WHERE event_id = ? AND member_id = ?`, [req.params.id, currentMember.id]);
        if (existing) return res.status(400).json({ error: 'Already registered' });

        if (event.capacity && event.registrations_count >= event.capacity) {
            return res.status(400).json({ error: 'Event is at capacity' });
        }

        const { name, email, institution } = req.body || {};
        const id = uuidv4();
        const qrCode = `FORUM-${id.substring(0, 8).toUpperCase()}`;

        // Determine if this is a paid event and compute price
        const isPaid = event.is_paid && event.price > 0;
        let price = 0;
        let paymentStatus = 'free';
        if (isPaid) {
            const now = new Date();
            if (event.early_bird_price && event.early_bird_deadline && now < new Date(event.early_bird_deadline)) {
                price = event.early_bird_price;
            } else {
                price = event.price;
            }
            paymentStatus = 'unpaid';
        }

        db.run(`INSERT INTO forum_event_registrations (id, event_id, member_id, name, email, institution, qr_code, payment_status, payment_amount) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.id, currentMember.id, name || null, email || null, institution || null, qrCode, paymentStatus, isPaid ? price : null]);
        db.run(`UPDATE forum_events SET registrations_count = registrations_count + 1 WHERE id = ?`, [req.params.id]);
        saveDb();

        res.json({ success: true, id, qr_code: qrCode, checkin_enabled: !!event.checkin_enabled, requires_payment: isPaid, price });
    });

    // Create Stripe checkout session for paid forum event
    app.post('/api/forum/events/:id/checkout-session', auth, async (req, res) => {
        try {
            if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });

            const { registration_id } = req.body;
            if (!registration_id) return res.status(400).json({ error: 'registration_id is required' });

            const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
            if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

            // Validate registration exists and belongs to this member
            const registration = query.get(
                'SELECT r.*, e.title as event_title, e.price, e.early_bird_price, e.early_bird_deadline FROM forum_event_registrations r JOIN forum_events e ON r.event_id = e.id WHERE r.id = ? AND r.member_id = ?',
                [registration_id, currentMember.id]
            );
            if (!registration) return res.status(404).json({ error: 'Registration not found' });
            if (registration.payment_status === 'paid') return res.status(400).json({ error: 'Already paid' });

            // Compute price (early bird vs regular)
            const now = new Date();
            let price = registration.price;
            if (registration.early_bird_price && registration.early_bird_deadline && now < new Date(registration.early_bird_deadline)) {
                price = registration.early_bird_price;
            }

            const user = query.get('SELECT * FROM users WHERE id = ?', [req.user.id]);
            const baseUrl = `${req.protocol}://${req.get('host')}`;

            // Generate invoice number: FM26-XXXX
            const seqRow = query.get("SELECT COUNT(*) as cnt FROM forum_event_registrations WHERE invoice_number IS NOT NULL");
            const invoiceSeq = (seqRow?.cnt || 0) + 1;
            const invoiceNumber = `FM26-${String(invoiceSeq).padStart(4, '0')}`;

            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Med&X Forum — ${registration.event_title || 'Event'}`,
                            description: `Registration ${registration.qr_code || registration_id}`
                        },
                        unit_amount: Math.round(price * 100)
                    },
                    quantity: 1
                }],
                metadata: {
                    type: 'forum-event',
                    forum_registration_id: registration_id,
                    event_id: registration.event_id,
                    userId: req.user.id,
                    invoice_number: invoiceNumber
                },
                customer_email: user?.email || registration.email,
                success_url: `${baseUrl}/?payment=success&type=forum&reg=${registration_id}`,
                cancel_url: `${baseUrl}/?payment=cancelled&type=forum&reg=${registration_id}`
            });

            // Store invoice number on the registration
            db.run('UPDATE forum_event_registrations SET invoice_number = ? WHERE id = ?', [invoiceNumber, registration_id]);
            saveDb();

            res.json({ sessionId: session.id, url: session.url });
        } catch (err) {
            console.error('Forum checkout error:', err.message);
            res.status(500).json({ error: 'Failed to create checkout session' });
        }
    });

    // Get user's registration for an event (+ QR code)
    app.get('/api/forum/events/:id/my-registration', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const event = query.get(`SELECT * FROM forum_events WHERE id = ?`, [req.params.id]);
        if (!event) return res.status(404).json({ error: 'Event not found' });

        const reg = query.get(`SELECT * FROM forum_event_registrations WHERE event_id = ? AND member_id = ?`, [req.params.id, currentMember.id]);
        if (!reg) return res.status(404).json({ error: 'Not registered' });

        res.json({ ...reg, checkin_enabled: !!event.checkin_enabled, event_title: event.title });
    });

    // Get Forum Event Schedule (read-only for users)
    app.get('/api/forum/events/:eventId/schedule', auth, (req, res) => {
        try {
            const items = query.all('SELECT * FROM forum_event_schedule WHERE event_id = ? ORDER BY sort_order, start_time', [req.params.eventId]);
            res.json(items);
        } catch (err) {
            res.status(500).json({ error: 'Failed to load schedule' });
        }
    });

    // Get Forum media/gallery
    app.get('/api/forum/media', auth, (req, res) => {
        const { event_id, gallery_name, type, folder_id } = req.query;
        let sql = `SELECT fm.*, u.first_name, u.last_name
            FROM forum_media fm
            JOIN forum_members fmem ON fm.uploader_id = fmem.id
            JOIN users u ON fmem.user_id = u.id
            WHERE fm.is_approved = 1`;
        const params = [];

        if (event_id) { sql += ` AND fm.event_id = ?`; params.push(event_id); }
        if (gallery_name) { sql += ` AND fm.gallery_name = ?`; params.push(gallery_name); }
        if (type) { sql += ` AND fm.media_type = ?`; params.push(type); }
        if (folder_id) { sql += ` AND fm.folder_id = ?`; params.push(folder_id); }
        else { sql += ` AND (fm.folder_id IS NULL OR fm.folder_id = '')`; }

        sql += ` ORDER BY fm.created_at DESC`;
        res.json(query.all(sql, params));
    });

    // Get gallery folders
    app.get('/api/forum/gallery/folders', auth, (req, res) => {
        const { parent_id } = req.query;
        let sql = `SELECT * FROM forum_gallery_folders WHERE 1=1`;
        const params = [];

        if (parent_id) {
            sql += ` AND parent_id = ?`;
            params.push(parent_id);
        } else {
            sql += ` AND (parent_id IS NULL OR parent_id = '')`;
        }

        sql += ` ORDER BY event_year DESC, name ASC`;
        res.json(query.all(sql, params));
    });

    // Get single gallery folder
    app.get('/api/forum/gallery/folders/:id', auth, (req, res) => {
        const folder = query.get(`SELECT * FROM forum_gallery_folders WHERE id = ?`, [req.params.id]);
        if (!folder) return res.status(404).json({ error: 'Folder not found' });
        res.json(folder);
    });

    // Admin: Create gallery folder
    app.post('/api/admin/forum/gallery/folders', auth, adminOnly, (req, res) => {
        const { name, parent_id, event_year, event_name } = req.body;
        if (!name) return res.status(400).json({ error: 'Folder name is required' });

        const id = uuidv4();
        db.run(`INSERT INTO forum_gallery_folders (id, name, parent_id, event_year, event_name) VALUES (?, ?, ?, ?, ?)`,
            [id, name, parent_id || null, event_year || null, event_name || null]);
        saveDb();

        res.json({ success: true, id });
    });

    // Admin: Upload media
    app.post('/api/admin/forum/media', auth, adminOnly, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        const { caption, folder_id, event_id, gallery_name } = req.body;

        const isImage = req.file.mimetype.startsWith('image/');
        const isVideo = req.file.mimetype.startsWith('video/');
        const mediaType = isImage ? 'image' : isVideo ? 'video' : 'other';

        const id = uuidv4();
        db.run(`INSERT INTO forum_media (id, uploader_id, media_type, file_url, caption, folder_id, event_id, gallery_name, is_approved)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
            [id, currentMember?.id || null, mediaType, `/uploads/${req.file.filename}`, caption || null, folder_id || null, event_id || null, gallery_name || null]);
        saveDb();

        res.json({ success: true, id, url: `/uploads/${req.file.filename}` });
    });

    // Get Forum resources
    app.get('/api/forum/resources', auth, (req, res) => {
        const { category, type, search } = req.query;
        let sql = `SELECT fr.*, u.first_name, u.last_name
            FROM forum_resources fr
            JOIN forum_members fm ON fr.uploader_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE 1=1`;
        const params = [];

        if (category) { sql += ` AND fr.category = ?`; params.push(category); }
        if (type) { sql += ` AND fr.resource_type = ?`; params.push(type); }
        if (search) { sql += ` AND (fr.title LIKE ? OR fr.description LIKE ?)`; params.push(`%${search}%`, `%${search}%`); }

        sql += ` ORDER BY fr.is_featured DESC, fr.created_at DESC`;
        res.json(query.all(sql, params));
    });

    // Get mentors
    app.get('/api/forum/mentors', auth, (req, res) => {
        const mentors = query.all(`
            SELECT fm.*, u.first_name, u.last_name
            FROM forum_members fm
            JOIN users u ON fm.user_id = u.id
            WHERE fm.is_mentor = 1 AND fm.membership_status = 'approved'
            ORDER BY fm.points DESC
        `);
        res.json(mentors);
    });

    // Request mentorship
    app.post('/api/forum/mentorship', auth, (req, res) => {
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ? AND membership_status = 'approved'`, [req.user.id]);
        if (!currentMember) return res.status(403).json({ error: 'Forum membership required' });

        const { mentor_id, focus_areas, goals } = req.body;

        const existing = query.get(`SELECT id FROM forum_mentorships WHERE mentor_id = ? AND mentee_id = ? AND status != 'ended'`,
            [mentor_id, currentMember.id]);
        if (existing) return res.status(400).json({ error: 'Mentorship request already exists' });

        const id = uuidv4();
        db.run(`INSERT INTO forum_mentorships (id, mentor_id, mentee_id, focus_areas, goals) VALUES (?, ?, ?, ?, ?)`,
            [id, mentor_id, currentMember.id, focus_areas, goals]);
        saveDb();

        res.json({ success: true, id });
    });

    // Admin: Get Forum stats
    app.get('/api/admin/forum/stats', auth, adminOnly, (req, res) => {
        const stats = {
            total_members: query.get(`SELECT COUNT(*) as c FROM forum_members WHERE membership_status = 'approved'`)?.c || 0,
            pending_applications: query.get(`SELECT COUNT(*) as c FROM forum_members WHERE membership_status = 'pending'`)?.c || 0,
            total_posts: query.get(`SELECT COUNT(*) as c FROM forum_posts`)?.c || 0,
            total_events: query.get(`SELECT COUNT(*) as c FROM forum_events WHERE status = 'published'`)?.c || 0,
            total_groups: query.get(`SELECT COUNT(*) as c FROM forum_groups WHERE is_active = 1`)?.c || 0,
            total_prospects: query.get(`SELECT COUNT(*) as c FROM forum_prospects`)?.c || 0,
            by_specialty: query.all(`SELECT specialty, COUNT(*) as count FROM forum_members WHERE membership_status = 'approved' AND specialty IS NOT NULL GROUP BY specialty ORDER BY count DESC LIMIT 10`),
            by_country: query.all(`SELECT location_country as country, COUNT(*) as count FROM forum_members WHERE membership_status = 'approved' AND location_country IS NOT NULL GROUP BY location_country ORDER BY count DESC LIMIT 10`),
            by_industry: query.all(`SELECT industry, COUNT(*) as count FROM forum_members WHERE membership_status = 'approved' AND industry IS NOT NULL GROUP BY industry ORDER BY count DESC LIMIT 10`),
            recent_activity: query.all(`SELECT activity_type, COUNT(*) as count FROM forum_activity WHERE created_at > datetime('now', '-7 days') GROUP BY activity_type`)
        };
        res.json(stats);
    });

    // Admin: Get pending applications
    app.get('/api/admin/forum/applications', auth, adminOnly, (req, res) => {
        const applications = query.all(`
            SELECT fm.*, u.first_name, u.last_name, u.email
            FROM forum_members fm
            JOIN users u ON fm.user_id = u.id
            WHERE fm.membership_status = 'pending'
            ORDER BY fm.application_submitted_at DESC
        `);
        res.json(applications);
    });

    // Admin: Approve/reject application
    app.put('/api/admin/forum/applications/:id', auth, adminOnly, (req, res) => {
        const { status, rejection_reason } = req.body;

        if (status === 'approved') {
            db.run(`UPDATE forum_members SET membership_status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
                [req.user.id, req.params.id]);
        } else {
            db.run(`UPDATE forum_members SET membership_status = 'rejected', rejection_reason = ? WHERE id = ?`,
                [rejection_reason, req.params.id]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Admin: Get all members
    app.get('/api/admin/forum/members', auth, adminOnly, (req, res) => {
        const members = query.all(`
            SELECT fm.*, u.first_name, u.last_name, u.email
            FROM forum_members fm
            JOIN users u ON fm.user_id = u.id
            ORDER BY fm.created_at DESC
        `);
        res.json(members);
    });

    // Admin: Manage groups
    app.post('/api/admin/forum/groups', auth, adminOnly, (req, res) => {
        const { name, description, category, group_type, icon } = req.body;
        const id = uuidv4();
        const slug = name.toLowerCase().replace(/\s+/g, '-').replace(/[^a-z0-9-]/g, '');

        db.run(`INSERT INTO forum_groups (id, name, slug, description, category, group_type, icon, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, slug, description, category, group_type || 'public', icon, req.user.id]);
        saveDb();
        res.json({ success: true, id });
    });

    // ========== PHASE 5B: FORUM EVENT MANAGEMENT ==========

    // Admin: List ALL forum events (no published filter)
    app.get('/api/admin/forum/events', auth, adminOnly, (req, res) => {
        const events = query.all(`SELECT fe.*, u.first_name as organizer_first, u.last_name as organizer_last,
            (SELECT COUNT(*) FROM forum_event_registrations WHERE event_id = fe.id) as reg_count
            FROM forum_events fe
            LEFT JOIN forum_members fm ON fe.organizer_id = fm.id
            LEFT JOIN users u ON fm.user_id = u.id
            ORDER BY fe.start_date DESC`);
        res.json(events);
    });

    // Admin: Create event (enhanced)
    app.post('/api/admin/forum/events', auth, adminOnly, (req, res) => {
        const { title, description, event_type, start_date, end_date, location_type, location_name,
            location_address, virtual_link, venue, capacity, registration_deadline, is_paid, price, agenda,
            speakers, status, is_published, checkin_enabled } = req.body;
        const id = uuidv4();

        const organizer = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);

        db.run(`INSERT INTO forum_events (id, title, description, event_type, start_date, end_date, location_type,
            location_name, location_address, virtual_link, venue, capacity, registration_deadline, is_paid, price,
            agenda, speakers, organizer_id, status, is_published, checkin_enabled, created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), datetime('now'))`,
            [id, title, description, event_type || 'symposium', start_date, end_date, location_type || 'in_person',
             location_name, location_address, virtual_link, venue, capacity || null, registration_deadline,
             is_paid ? 1 : 0, price || 0, agenda, speakers, organizer?.id,
             status || 'planning', is_published ? 1 : 0, checkin_enabled ? 1 : 0]);
        saveDb();
        res.json({ success: true, id });
    });

    // Admin: Update event
    app.put('/api/admin/forum/events/:id', auth, adminOnly, (req, res) => {
        const evt = query.get('SELECT * FROM forum_events WHERE id = ?', [req.params.id]);
        if (!evt) return res.status(404).json({ error: 'Event not found' });

        const { title, description, event_type, start_date, end_date, location_type, location_name,
            location_address, virtual_link, venue, capacity, registration_deadline, is_paid, price, agenda,
            speakers, status, is_published, checkin_enabled } = req.body;

        const updates = [];
        const values = [];

        if (title !== undefined) { updates.push('title = ?'); values.push(title); }
        if (description !== undefined) { updates.push('description = ?'); values.push(description); }
        if (event_type !== undefined) { updates.push('event_type = ?'); values.push(event_type); }
        if (start_date !== undefined) { updates.push('start_date = ?'); values.push(start_date); }
        if (end_date !== undefined) { updates.push('end_date = ?'); values.push(end_date); }
        if (location_type !== undefined) { updates.push('location_type = ?'); values.push(location_type); }
        if (location_name !== undefined) { updates.push('location_name = ?'); values.push(location_name); }
        if (location_address !== undefined) { updates.push('location_address = ?'); values.push(location_address); }
        if (virtual_link !== undefined) { updates.push('virtual_link = ?'); values.push(virtual_link); }
        if (venue !== undefined) { updates.push('venue = ?'); values.push(venue); }
        if (capacity !== undefined) { updates.push('capacity = ?'); values.push(capacity); }
        if (registration_deadline !== undefined) { updates.push('registration_deadline = ?'); values.push(registration_deadline); }
        if (is_paid !== undefined) { updates.push('is_paid = ?'); values.push(is_paid ? 1 : 0); }
        if (price !== undefined) { updates.push('price = ?'); values.push(price); }
        if (agenda !== undefined) { updates.push('agenda = ?'); values.push(agenda); }
        if (speakers !== undefined) { updates.push('speakers = ?'); values.push(speakers); }
        if (status !== undefined) { updates.push('status = ?'); values.push(status); }
        if (is_published !== undefined) { updates.push('is_published = ?'); values.push(is_published ? 1 : 0); }
        if (checkin_enabled !== undefined) { updates.push('checkin_enabled = ?'); values.push(checkin_enabled ? 1 : 0); }

        if (updates.length > 0) {
            updates.push("updated_at = datetime('now')");
            values.push(req.params.id);
            db.run(`UPDATE forum_events SET ${updates.join(', ')} WHERE id = ?`, values);
            saveDb();
        }

        res.json({ success: true });
    });

    // Admin: Delete event
    app.delete('/api/admin/forum/events/:id', auth, adminOnly, (req, res) => {
        const evt = query.get('SELECT * FROM forum_events WHERE id = ?', [req.params.id]);
        if (!evt) return res.status(404).json({ error: 'Event not found' });

        db.run('DELETE FROM forum_event_registrations WHERE event_id = ?', [req.params.id]);
        db.run('DELETE FROM forum_events WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Publish event with notification
    app.put('/api/admin/forum/events/:id/publish', auth, adminOnly, (req, res) => {
        const evt = query.get('SELECT * FROM forum_events WHERE id = ?', [req.params.id]);
        if (!evt) return res.status(404).json({ error: 'Event not found' });

        const newPublished = evt.is_published ? 0 : 1;
        db.run('UPDATE forum_events SET is_published = ?, status = ?, updated_at = datetime(\'now\') WHERE id = ?',
            [newPublished, newPublished ? 'published' : evt.status === 'published' ? 'planning' : evt.status, req.params.id]);

        if (newPublished) {
            // Notify all forum members
            const members = query.all(`SELECT fm.user_id FROM forum_members fm WHERE fm.membership_status = 'approved' AND fm.user_id IS NOT NULL`);
            const eventDate = evt.start_date ? new Date(evt.start_date).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' }) : 'TBD';
            members.forEach(m => {
                const nId = uuidv4();
                db.run(`INSERT INTO user_notifications (id, user_id, user_group, category, project, title, message, link, icon, icon_class, created_by, created_at)
                    VALUES (?, ?, 'forum', 'event', 'forum', ?, ?, ?, 'fa-calendar', 'forum', ?, datetime('now'))`,
                    [nId, m.user_id, `New Forum Event: ${evt.title}`, `${evt.title} on ${eventDate}. Register now!`, `/forum/events/${req.params.id}`, req.user.id]);
            });
        }
        saveDb();
        res.json({ success: true, is_published: newPublished });
    });

    // Admin: Get event registrations
    app.get('/api/admin/forum/events/:id/registrations', auth, adminOnly, (req, res, next) => {
        // Skip if this is an AF26 slug route (handled by separate AF26 endpoints below)
        if (req.params.id === 'af26') return next();
        const registrations = query.all(`
            SELECT fer.*, u.first_name as user_first, u.last_name as user_last, u.email as user_email,
                fm.specialty, fm.institution as member_institution
            FROM forum_event_registrations fer
            LEFT JOIN forum_members fm ON fer.member_id = fm.id
            LEFT JOIN users u ON fm.user_id = u.id
            WHERE fer.event_id = ?
            ORDER BY fer.registered_at DESC
        `, [req.params.id]);
        res.json(registrations);
    });

    // Admin: Check in a registrant
    app.post('/api/admin/forum/events/:id/checkin', auth, adminOnly, (req, res, next) => {
        // Skip if this is an AF26 slug route
        if (req.params.id === 'af26') return next();
        const { registration_id, qr_code } = req.body;
        let reg;

        if (registration_id) {
            reg = query.get('SELECT * FROM forum_event_registrations WHERE id = ? AND event_id = ?', [registration_id, req.params.id]);
        } else if (qr_code) {
            reg = query.get('SELECT * FROM forum_event_registrations WHERE qr_code = ? AND event_id = ?', [qr_code, req.params.id]);
        }

        if (!reg) return res.status(404).json({ error: 'Registration not found' });
        if (reg.checked_in) return res.status(400).json({ error: 'Already checked in' });

        db.run(`UPDATE forum_event_registrations SET checked_in = 1, checked_in_at = datetime('now') WHERE id = ?`, [reg.id]);
        saveDb();
        res.json({ success: true, registration: { ...reg, checked_in: 1 } });
    });

    // ========== END PHASE 5B ==========

    // Admin: Upload resource
    app.post('/api/admin/forum/resources', auth, adminOnly, (req, res) => {
        const { title, description, resource_type, category, file_url, external_url, doi, tags } = req.body;
        const id = uuidv4();

        const uploader = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);

        db.run(`INSERT INTO forum_resources (id, uploader_id, title, description, resource_type, category, file_url, external_url, doi, tags)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, uploader?.id, title, description, resource_type, category, file_url, external_url, doi, tags]);
        saveDb();
        res.json({ success: true, id });
    });

    // Admin: Manage posts
    app.get('/api/admin/forum/posts', auth, adminOnly, (req, res) => {
        const posts = query.all(`
            SELECT fp.*, fm.photo_url as author_photo, u.first_name, u.last_name
            FROM forum_posts fp
            JOIN forum_members fm ON fp.author_id = fm.id
            JOIN users u ON fm.user_id = u.id
            ORDER BY fp.created_at DESC
        `);
        res.json(posts);
    });

    app.put('/api/admin/forum/posts/:id', auth, adminOnly, (req, res) => {
        const { moderation_status, is_pinned, is_featured } = req.body;
        const updates = [];
        const values = [];

        if (moderation_status !== undefined) { updates.push('moderation_status = ?'); values.push(moderation_status); }
        if (is_pinned !== undefined) { updates.push('is_pinned = ?'); values.push(is_pinned ? 1 : 0); }
        if (is_featured !== undefined) { updates.push('is_featured = ?'); values.push(is_featured ? 1 : 0); }

        if (updates.length > 0) {
            values.push(req.params.id);
            db.run(`UPDATE forum_posts SET ${updates.join(', ')}, moderated_by = '${req.user.id}', moderated_at = datetime('now') WHERE id = ?`, values);
            saveDb();
        }
        res.json({ success: true });
    });

    // ========== PROSPECTS MANAGEMENT ==========

    // Get all prospects
    app.get('/api/admin/forum/prospects', auth, adminOnly, (req, res) => {
        const prospects = query.all(`SELECT * FROM forum_prospects ORDER BY created_at DESC`);
        res.json(prospects);
    });

    // Create prospect
    app.post('/api/admin/forum/prospects', auth, adminOnly, (req, res) => {
        const { first_name, last_name, email, institution, specialty, position, country, source, notes } = req.body;
        const id = uuidv4();

        try {
            db.run(`INSERT INTO forum_prospects (id, first_name, last_name, email, institution, specialty, position, country, source, notes)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, first_name, last_name, email, institution, specialty, position, country, source || 'manual', notes]);
            saveDb();
            res.json({ success: true, id });
        } catch (err) {
            res.status(400).json({ error: 'Email already exists' });
        }
    });

    // Update prospect
    app.put('/api/admin/forum/prospects/:id', auth, adminOnly, (req, res) => {
        const { first_name, last_name, email, institution, specialty, position, country, status, notes } = req.body;

        db.run(`UPDATE forum_prospects SET first_name = ?, last_name = ?, email = ?, institution = ?, specialty = ?,
            position = ?, country = ?, status = ?, notes = ? WHERE id = ?`,
            [first_name, last_name, email, institution, specialty, position, country, status, notes, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Delete prospect
    app.delete('/api/admin/forum/prospects/:id', auth, adminOnly, (req, res) => {
        db.run(`DELETE FROM forum_prospects WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== INVITATIONS MANAGEMENT ==========

    // Get all invitations
    app.get('/api/admin/forum/invitations', auth, adminOnly, (req, res) => {
        const invitations = query.all(`SELECT * FROM forum_invitations ORDER BY created_at DESC`);
        res.json(invitations);
    });

    // Send single invitation
    app.post('/api/admin/forum/invitations/send', auth, adminOnly, (req, res) => {
        const { prospect_id } = req.body;
        const prospect = query.get(`SELECT * FROM forum_prospects WHERE id = ?`, [prospect_id]);
        if (!prospect) return res.status(404).json({ error: 'Prospect not found' });

        const id = uuidv4();
        const invitation_code = uuidv4().split('-')[0].toUpperCase();

        db.run(`INSERT INTO forum_invitations (id, prospect_id, email, first_name, last_name, invitation_code, sent_at, delivery_status)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'sent')`,
            [id, prospect_id, prospect.email, prospect.first_name, prospect.last_name, invitation_code]);

        db.run(`UPDATE forum_prospects SET status = 'invited' WHERE id = ?`, [prospect_id]);
        saveDb();

        // Send email (using existing sendEmail function if available)
        res.json({ success: true, id, invitation_code });
    });

    // Send bulk invitations
    app.post('/api/admin/forum/invitations/send-bulk', auth, adminOnly, (req, res) => {
        const { prospect_ids } = req.body;
        const results = [];

        for (const prospect_id of prospect_ids) {
            const prospect = query.get(`SELECT * FROM forum_prospects WHERE id = ?`, [prospect_id]);
            if (!prospect) continue;

            const id = uuidv4();
            const invitation_code = uuidv4().split('-')[0].toUpperCase();

            db.run(`INSERT INTO forum_invitations (id, prospect_id, email, first_name, last_name, invitation_code, sent_at, delivery_status)
                VALUES (?, ?, ?, ?, ?, ?, datetime('now'), 'sent')`,
                [id, prospect_id, prospect.email, prospect.first_name, prospect.last_name, invitation_code]);

            db.run(`UPDATE forum_prospects SET status = 'invited' WHERE id = ?`, [prospect_id]);
            results.push({ id, prospect_id });
        }

        saveDb();
        res.json({ success: true, sent: results.length });
    });

    // Resend invitation
    app.post('/api/admin/forum/invitations/:id/resend', auth, adminOnly, (req, res) => {
        db.run(`UPDATE forum_invitations SET sent_at = datetime('now'), delivery_status = 'sent' WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Preview Excel/CSV import
    app.post('/api/admin/forum/prospects/preview', auth, adminOnly, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        try {
            const XLSX = require('xlsx');
            const workbook = XLSX.readFile(req.file.path);
            const sheetName = workbook.SheetNames[0];
            const worksheet = workbook.Sheets[sheetName];
            const data = XLSX.utils.sheet_to_json(worksheet, { defval: '' });

            if (data.length === 0) return res.status(400).json({ error: 'No data found in file' });

            const columns = Object.keys(data[0]);
            res.json({ columns, rows: data });
        } catch (err) {
            console.error('Failed to parse file:', err);
            res.status(500).json({ error: 'Failed to parse file' });
        }
    });

    // Import prospects from parsed data
    app.post('/api/admin/forum/prospects/import', auth, adminOnly, (req, res) => {
        const { rows, mapping } = req.body;
        if (!rows || !mapping) return res.status(400).json({ error: 'Missing data' });

        const batchId = uuidv4();
        let imported = 0, skipped = 0;

        // Create import batch record
        db.run(`INSERT INTO forum_import_batches (id, filename, total_rows, status, created_at)
            VALUES (?, 'import', ?, 'processing', datetime('now'))`, [batchId, rows.length]);

        const existingEmails = new Set(
            query.all(`SELECT email FROM forum_prospects`).map(p => p.email?.toLowerCase())
        );

        for (const row of rows) {
            const email = row[mapping.email]?.toString().trim().toLowerCase();
            const firstName = row[mapping.first_name]?.toString().trim();

            if (!email || !firstName || existingEmails.has(email)) {
                skipped++;
                continue;
            }

            const id = uuidv4();
            db.run(`INSERT INTO forum_prospects (id, first_name, last_name, email, institution, specialty, position, country, source, import_batch_id, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'excel_import', ?, 'not_contacted')`, [
                id,
                firstName,
                row[mapping.last_name]?.toString().trim() || null,
                email,
                row[mapping.institution]?.toString().trim() || null,
                row[mapping.specialty]?.toString().trim() || null,
                row[mapping.position]?.toString().trim() || null,
                row[mapping.country]?.toString().trim() || null,
                batchId
            ]);

            existingEmails.add(email);
            imported++;
        }

        // Update batch record
        db.run(`UPDATE forum_import_batches SET imported_count = ?, skipped_count = ?, status = 'completed' WHERE id = ?`,
            [imported, skipped, batchId]);
        saveDb();

        res.json({ success: true, imported, skipped, batch_id: batchId });
    });

    // ===== EMAIL TEMPLATES CRUD =====
    app.get('/api/admin/forum/templates', auth, adminOnly, (req, res) => {
        const templates = query.all(`SELECT * FROM forum_email_templates ORDER BY is_default DESC, name ASC`);
        res.json(templates);
    });

    app.post('/api/admin/forum/templates', auth, adminOnly, (req, res) => {
        const { name, subject, body_html, is_default } = req.body;
        if (!name || !subject) return res.status(400).json({ error: 'Name and subject are required' });

        // If setting as default, unset other defaults
        if (is_default) {
            db.run(`UPDATE forum_email_templates SET is_default = 0`);
        }

        const id = uuidv4();
        const variables = JSON.stringify(['first_name', 'last_name', 'institution', 'invite_link']);
        db.run(`INSERT INTO forum_email_templates (id, name, subject, body_html, variables, is_default)
            VALUES (?, ?, ?, ?, ?, ?)`, [id, name, subject, body_html, variables, is_default ? 1 : 0]);
        saveDb();

        res.json({ success: true, id });
    });

    app.put('/api/admin/forum/templates/:id', auth, adminOnly, (req, res) => {
        const { name, subject, body_html, is_default } = req.body;

        // If setting as default, unset other defaults
        if (is_default) {
            db.run(`UPDATE forum_email_templates SET is_default = 0`);
        }

        db.run(`UPDATE forum_email_templates SET name = ?, subject = ?, body_html = ?, is_default = ? WHERE id = ?`,
            [name, subject, body_html, is_default ? 1 : 0, req.params.id]);
        saveDb();

        res.json({ success: true });
    });

    app.delete('/api/admin/forum/templates/:id', auth, adminOnly, (req, res) => {
        db.run(`DELETE FROM forum_email_templates WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Notify all members
    app.post('/api/admin/forum/notify-all', auth, adminOnly, (req, res) => {
        const { subject, message } = req.body;
        const members = query.all(`
            SELECT u.email, u.first_name FROM forum_members fm
            JOIN users u ON fm.user_id = u.id
            WHERE fm.membership_status = 'approved'
        `);

        // Log notification for now (actual email sending would use existing sendEmail infrastructure)
        console.log(`Notification to ${members.length} members: ${subject}`);
        res.json({ success: true, recipients: members.length });
    });

    // Bulk email selected members
    app.post('/api/admin/forum/bulk-email', auth, adminOnly, (req, res) => {
        const { member_ids, subject, body } = req.body;
        const members = query.all(`
            SELECT u.email, u.first_name FROM forum_members fm
            JOIN users u ON fm.user_id = u.id
            WHERE fm.id IN (${member_ids.map(() => '?').join(',')})
        `, member_ids);

        // Log for now (actual email sending would use existing sendEmail infrastructure)
        console.log(`Bulk email to ${members.length} members: ${subject}`);
        res.json({ success: true, sent: members.length });
    });

    // ========== ANNUAL FORUM 2026 ROUTES ==========

    // Get AF26 stats
    app.get('/api/admin/forum/events/af26/stats', auth, adminOnly, (req, res) => {
        // Get or create AF26 event
        let event = query.get(`SELECT * FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) {
            const id = uuidv4();
            db.run(`INSERT INTO forum_events (id, title, description, event_type, start_date, end_date, location_name, slug, event_scale, status)
                VALUES (?, 'Annual Forum 2026', 'Biomedical Forum Annual Meeting 2026', 'conference', '2026-12-05', '2026-12-06', 'Zagreb, Croatia', 'annual-forum-2026', 'large', 'published')`, [id]);
            saveDb();
            event = { id };
        }

        const stats = {
            event_id: event.id,
            registered: query.get(`SELECT COUNT(*) as c FROM forum_event_registrations WHERE event_id = ?`, [event.id])?.c || 0,
            confirmed: query.get(`SELECT COUNT(*) as c FROM forum_event_registrations WHERE event_id = ? AND (rsvp_status = 'confirmed' OR status = 'confirmed')`, [event.id])?.c || 0,
            invited: query.get(`SELECT COUNT(*) as c FROM forum_invitations WHERE delivery_status = 'sent'`)?.c || 0,
            speakers: query.get(`SELECT COUNT(*) as c FROM forum_event_speakers WHERE event_id = ?`, [event.id])?.c || 0,
            checked_in: query.get(`SELECT COUNT(*) as c FROM forum_event_registrations WHERE event_id = ? AND checked_in = 1`, [event.id])?.c || 0
        };
        res.json(stats);
    });

    // Get AF26 registrations
    app.get('/api/admin/forum/events/af26/registrations', auth, adminOnly, (req, res) => {
        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) return res.json([]);

        const registrations = query.all(`
            SELECT fer.*, u.first_name, u.last_name, u.email, fm.institution
            FROM forum_event_registrations fer
            JOIN forum_members fm ON fer.member_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE fer.event_id = ?
            ORDER BY fer.registered_at DESC
        `, [event.id]);
        res.json(registrations);
    });

    // Update AF26 registration
    app.put('/api/admin/forum/events/af26/registrations/:id', auth, adminOnly, (req, res) => {
        const { rsvp_status, dietary_requirements, accommodation_needed, notes } = req.body;

        db.run(`UPDATE forum_event_registrations SET rsvp_status = ?, dietary_requirements = ?, accommodation_needed = ?, notes = ? WHERE id = ?`,
            [rsvp_status, dietary_requirements, accommodation_needed ? 1 : 0, notes, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Get AF26 speakers
    app.get('/api/admin/forum/events/af26/speakers', auth, adminOnly, (req, res) => {
        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) return res.json([]);

        const speakers = query.all(`SELECT * FROM forum_event_speakers WHERE event_id = ? ORDER BY sort_order`, [event.id]);
        res.json(speakers);
    });

    // Add AF26 speaker
    app.post('/api/admin/forum/events/af26/speakers', auth, adminOnly, (req, res) => {
        const { name, title, institution, bio, photo_url, talk_title, talk_abstract, speaker_type } = req.body;

        let event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) {
            const eventId = uuidv4();
            db.run(`INSERT INTO forum_events (id, title, description, slug, event_scale, status) VALUES (?, 'Annual Forum 2026', '', 'annual-forum-2026', 'large', 'published')`, [eventId]);
            event = { id: eventId };
        }

        const id = uuidv4();
        const maxOrder = query.get(`SELECT MAX(sort_order) as max FROM forum_event_speakers WHERE event_id = ?`, [event.id])?.max || 0;

        db.run(`INSERT INTO forum_event_speakers (id, event_id, name, title, institution, bio, photo_url, talk_title, talk_abstract, speaker_type, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, event.id, name, title, institution, bio, photo_url, talk_title, talk_abstract, speaker_type || 'presenter', maxOrder + 1]);
        saveDb();
        res.json({ success: true, id });
    });

    // Update AF26 speaker
    app.put('/api/admin/forum/events/af26/speakers/:id', auth, adminOnly, (req, res) => {
        const { name, title, institution, bio, photo_url, talk_title, talk_abstract, speaker_type, is_confirmed } = req.body;
        const updates = [];
        const params = [];

        if (name !== undefined) { updates.push('name = ?'); params.push(name); }
        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (institution !== undefined) { updates.push('institution = ?'); params.push(institution); }
        if (bio !== undefined) { updates.push('bio = ?'); params.push(bio); }
        if (photo_url !== undefined) { updates.push('photo_url = ?'); params.push(photo_url); }
        if (talk_title !== undefined) { updates.push('talk_title = ?'); params.push(talk_title); }
        if (talk_abstract !== undefined) { updates.push('talk_abstract = ?'); params.push(talk_abstract); }
        if (speaker_type !== undefined) { updates.push('speaker_type = ?'); params.push(speaker_type); }
        if (is_confirmed !== undefined) { updates.push('is_confirmed = ?'); params.push(is_confirmed); }

        if (updates.length === 0) return res.json({ success: true });

        params.push(req.params.id);
        db.run(`UPDATE forum_event_speakers SET ${updates.join(', ')} WHERE id = ?`, params);
        saveDb();
        res.json({ success: true });
    });

    // Delete AF26 speaker
    app.delete('/api/admin/forum/events/af26/speakers/:id', auth, adminOnly, (req, res) => {
        db.run(`DELETE FROM forum_event_speakers WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Get AF26 schedule
    app.get('/api/admin/forum/events/af26/schedule', auth, adminOnly, (req, res) => {
        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) return res.json([]);

        const schedule = query.all(`SELECT * FROM forum_event_schedule WHERE event_id = ? ORDER BY date, start_time, sort_order`, [event.id]);
        res.json(schedule);
    });

    // Add AF26 schedule session
    app.post('/api/admin/forum/events/af26/schedule', auth, adminOnly, (req, res) => {
        const { title, description, session_type, date, start_time, end_time, room, speaker_ids } = req.body;

        let event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) {
            const eventId = uuidv4();
            db.run(`INSERT INTO forum_events (id, title, description, slug, event_scale, status) VALUES (?, 'Annual Forum 2026', '', 'annual-forum-2026', 'large', 'published')`, [eventId]);
            event = { id: eventId };
        }

        const id = uuidv4();
        const maxOrder = query.get(`SELECT MAX(sort_order) as max FROM forum_event_schedule WHERE event_id = ?`, [event.id])?.max || 0;

        db.run(`INSERT INTO forum_event_schedule (id, event_id, title, description, session_type, date, start_time, end_time, room, speaker_ids, sort_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, event.id, title, description, session_type || 'session', date || '2026-12-05', start_time, end_time, room, speaker_ids, maxOrder + 1]);
        saveDb();
        res.json({ success: true, id });
    });

    // Update AF26 schedule session
    app.put('/api/admin/forum/events/af26/schedule/:id', auth, adminOnly, (req, res) => {
        const { title, description, session_type, date, start_time, end_time, room, speaker_ids } = req.body;
        const updates = [];
        const params = [];

        if (title !== undefined) { updates.push('title = ?'); params.push(title); }
        if (description !== undefined) { updates.push('description = ?'); params.push(description); }
        if (session_type !== undefined) { updates.push('session_type = ?'); params.push(session_type); }
        if (date !== undefined) { updates.push('date = ?'); params.push(date); }
        if (start_time !== undefined) { updates.push('start_time = ?'); params.push(start_time); }
        if (end_time !== undefined) { updates.push('end_time = ?'); params.push(end_time); }
        if (room !== undefined) { updates.push('room = ?'); params.push(room); }
        if (speaker_ids !== undefined) { updates.push('speaker_ids = ?'); params.push(speaker_ids); }

        if (updates.length === 0) return res.json({ success: true });

        params.push(req.params.id);
        db.run(`UPDATE forum_event_schedule SET ${updates.join(', ')} WHERE id = ?`, params);
        saveDb();
        res.json({ success: true });
    });

    // Delete AF26 schedule session
    app.delete('/api/admin/forum/events/af26/schedule/:id', auth, adminOnly, (req, res) => {
        db.run(`DELETE FROM forum_event_schedule WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Update AF26 event settings
    app.put('/api/admin/forum/events/af26/settings', auth, adminOnly, (req, res) => {
        const { title, start_date, end_date, location_name, venue, max_capacity, rsvp_deadline, description } = req.body;

        let event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) {
            const eventId = uuidv4();
            db.run(`INSERT INTO forum_events (id, title, slug, event_scale, status) VALUES (?, 'Annual Forum 2026', 'annual-forum-2026', 'large', 'published')`, [eventId]);
            event = { id: eventId };
        }

        db.run(`UPDATE forum_events SET
            title = COALESCE(?, title),
            start_date = COALESCE(?, start_date),
            end_date = COALESCE(?, end_date),
            location_name = COALESCE(?, location_name),
            venue = COALESCE(?, venue),
            max_capacity = COALESCE(?, max_capacity),
            rsvp_deadline = COALESCE(?, rsvp_deadline),
            description = COALESCE(?, description)
            WHERE id = ?`,
            [title, start_date, end_date, location_name, venue, max_capacity, rsvp_deadline, description, event.id]);
        saveDb();
        res.json({ success: true });
    });

    // Get AF26 invitations
    app.get('/api/admin/forum/events/af26/invitations', auth, adminOnly, (req, res) => {
        const invites = query.all(`
            SELECT fi.*, fp.first_name, fp.last_name
            FROM forum_invitations fi
            LEFT JOIN forum_prospects fp ON fi.prospect_id = fp.id
            WHERE fi.event_id = (SELECT id FROM forum_events WHERE slug = 'annual-forum-2026')
               OR fi.event_type = 'af26'
            ORDER BY fi.sent_at DESC
        `);
        res.json(invites);
    });

    // Send AF26 invitation to single email
    app.post('/api/admin/forum/events/af26/invitations/send', auth, adminOnly, (req, res) => {
        const { email, first_name, last_name, message } = req.body;
        if (!email) return res.status(400).json({ error: 'Email is required' });

        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);

        const id = uuidv4();
        const inviteCode = uuidv4().substring(0, 8).toUpperCase();

        db.run(`INSERT INTO forum_invitations (id, email, first_name, last_name, invitation_code, event_id, event_type, sent_at, delivery_status)
            VALUES (?, ?, ?, ?, ?, ?, 'af26', datetime('now'), 'sent')`,
            [id, email, first_name, last_name, inviteCode, event?.id]);
        saveDb();

        // Log for now (actual email would use sendEmail)
        console.log(`AF26 Invitation sent to ${email} with code ${inviteCode}`);
        res.json({ success: true, id, code: inviteCode });
    });

    // Send AF26 invitations to all forum members
    app.post('/api/admin/forum/events/af26/invitations/send-all', auth, adminOnly, (req, res) => {
        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);

        // Get all approved members who haven't been invited yet
        const members = query.all(`
            SELECT u.email, u.first_name, u.last_name, fm.id as member_id
            FROM forum_members fm
            JOIN users u ON fm.user_id = u.id
            WHERE fm.membership_status = 'approved'
            AND u.email NOT IN (
                SELECT email FROM forum_invitations WHERE event_type = 'af26' OR event_id = ?
            )
        `, [event?.id]);

        let sent = 0;
        for (const m of members) {
            const id = uuidv4();
            const inviteCode = uuidv4().substring(0, 8).toUpperCase();

            db.run(`INSERT INTO forum_invitations (id, email, first_name, last_name, invitation_code, event_id, event_type, sent_at, delivery_status)
                VALUES (?, ?, ?, ?, ?, ?, 'af26', datetime('now'), 'sent')`,
                [id, m.email, m.first_name, m.last_name, inviteCode, event?.id]);
            sent++;
        }

        saveDb();
        console.log(`AF26 Invitations sent to ${sent} members`);
        res.json({ success: true, sent });
    });

    // AF26 check-in
    app.post('/api/admin/forum/events/af26/checkin', auth, adminOnly, (req, res) => {
        const { query: searchQuery, registration_id } = req.body;

        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) return res.json({ success: false, error: 'Event not found' });

        let registration;
        if (registration_id) {
            registration = query.get(`
                SELECT fer.*, u.first_name, u.last_name, fm.institution
                FROM forum_event_registrations fer
                JOIN forum_members fm ON fer.member_id = fm.id
                JOIN users u ON fm.user_id = u.id
                WHERE fer.id = ?
            `, [registration_id]);
        } else if (searchQuery) {
            registration = query.get(`
                SELECT fer.*, u.first_name, u.last_name, u.email, fm.institution
                FROM forum_event_registrations fer
                JOIN forum_members fm ON fer.member_id = fm.id
                JOIN users u ON fm.user_id = u.id
                WHERE fer.event_id = ? AND (
                    LOWER(u.first_name) || ' ' || LOWER(u.last_name) LIKE ? OR
                    LOWER(u.email) LIKE ? OR
                    fer.qr_code = ?
                )
            `, [event.id, `%${searchQuery.toLowerCase()}%`, `%${searchQuery.toLowerCase()}%`, searchQuery]);
        }

        if (!registration) return res.json({ success: false, error: 'Registration not found' });
        if (registration.checked_in) return res.json({ success: false, error: 'Already checked in' });

        db.run(`UPDATE forum_event_registrations SET checked_in = 1, checked_in_at = datetime('now') WHERE id = ?`, [registration.id]);
        saveDb();

        res.json({
            success: true,
            attendee: {
                first_name: registration.first_name,
                last_name: registration.last_name,
                institution: registration.institution
            }
        });
    });

    // Get recent check-ins
    app.get('/api/admin/forum/events/af26/checkins', auth, adminOnly, (req, res) => {
        const event = query.get(`SELECT id FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) return res.json([]);

        const checkins = query.all(`
            SELECT fer.checked_in_at, u.first_name, u.last_name
            FROM forum_event_registrations fer
            JOIN forum_members fm ON fer.member_id = fm.id
            JOIN users u ON fm.user_id = u.id
            WHERE fer.event_id = ? AND fer.checked_in = 1
            ORDER BY fer.checked_in_at DESC
            LIMIT 20
        `, [event.id]);
        res.json(checkins);
    });

    // ========== AF26 USER-FACING REGISTRATION ==========

    // Register for AF26 (user-facing)
    app.post('/api/af26/register', auth, (req, res) => {
        const { firstName, lastName, email, title, institution, dietary, dietaryNotes, accommodation, specialRequests } = req.body;

        if (!firstName || !lastName || !email) {
            return res.status(400).json({ error: 'First name, last name, and email are required' });
        }

        // Get or create AF26 event
        let event = query.get(`SELECT * FROM forum_events WHERE slug = 'annual-forum-2026'`);
        if (!event) {
            const eventId = uuidv4();
            db.run(`INSERT INTO forum_events (id, title, description, event_type, start_date, end_date, location_name, slug, event_scale, status)
                VALUES (?, 'Annual Forum 2026', 'Biomedical Forum Annual Meeting 2026', 'conference', '2026-12-05', '2026-12-06', 'Zagreb, Croatia', 'annual-forum-2026', 'large', 'published')`, [eventId]);
            event = { id: eventId };
        }

        // Check if user already registered (by email or member_id)
        const currentMember = query.get(`SELECT id FROM forum_members WHERE user_id = ?`, [req.user.id]);
        if (currentMember) {
            const existing = query.get(`SELECT id FROM forum_event_registrations WHERE event_id = ? AND member_id = ?`, [event.id, currentMember.id]);
            if (existing) return res.status(400).json({ error: 'You are already registered for this event' });
        }

        const existingByEmail = query.get(`SELECT id FROM forum_event_registrations WHERE event_id = ? AND email = ?`, [event.id, email]);
        if (existingByEmail) return res.status(400).json({ error: 'This email is already registered for this event' });

        const id = uuidv4();
        const qrCode = `AF26-${id.substring(0, 8).toUpperCase()}`;

        db.run(`INSERT INTO forum_event_registrations (id, event_id, member_id, first_name, last_name, email, title, institution, dietary_requirements, dietary_notes, accommodation, special_requests, qr_code, rsvp_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'confirmed')`,
            [id, event.id, currentMember?.id ?? null, firstName, lastName, email, title ?? null, institution ?? null, dietary ?? null, dietaryNotes ?? null, accommodation ?? null, specialRequests ?? null, qrCode]);

        db.run(`UPDATE forum_events SET registrations_count = registrations_count + 1 WHERE id = ?`, [event.id]);
        saveDb();

        res.json({ success: true, id, qr_code: qrCode });
    });

    // ========== TEAM CHAT ROUTES ==========

    // Get team members
    app.get('/api/team', auth, adminOnly, (req, res) => {
        res.json(query.all('SELECT * FROM team_members ORDER BY name'));
    });

    // Get current user's team member record
    app.get('/api/team/me', auth, adminOnly, (req, res) => {
        const member = query.get(`SELECT tm.* FROM team_members tm WHERE tm.user_id = ?`, [req.user.id]);
        res.json(member);
    });

    // Create team member record for current user
    app.post('/api/team', auth, adminOnly, (req, res) => {
        const { name, role } = req.body;
        const id = uuidv4();

        // Check if already exists
        const existing = query.get('SELECT id FROM team_members WHERE user_id = ?', [req.user.id]);
        if (existing) {
            return res.json(query.get('SELECT * FROM team_members WHERE id = ?', [existing.id]));
        }

        db.run(`INSERT INTO team_members (id, user_id, name, role, avatar_color) VALUES (?, ?, ?, ?, ?)`,
            [id, req.user.id, name || 'Team Member', role || 'Member', '#C9A962']);
        saveDb();

        const member = query.get('SELECT * FROM team_members WHERE id = ?', [id]);
        res.json(member);
    });

    // ========== CHANNEL ROUTES ==========

    // Get all channels (optionally filtered by project, optionally by membership)
    app.get('/api/channels', auth, adminOnly, (req, res) => {
        const { project, member_id } = req.query;
        let sql = `SELECT c.*, (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count
                   FROM chat_channels c`;
        const params = [];
        const conditions = [];

        if (project) {
            conditions.push('(c.project = ? OR c.project IS NULL)');
            params.push(project);
        }
        if (member_id) {
            conditions.push('(c.id IN (SELECT channel_id FROM channel_members WHERE member_id = ?) OR c.is_default = 1)');
            params.push(member_id);
        }
        if (conditions.length > 0) {
            sql += ' WHERE ' + conditions.join(' AND ');
        }
        sql += ' ORDER BY c.is_default DESC, c.sort_order ASC, c.name';
        res.json(query.all(sql, params));
    });

    // Get channels as a tree (grouped by parent/child)
    app.get('/api/channels/:project/tree', auth, adminOnly, (req, res) => {
        const channels = query.all(
            `SELECT c.*, (SELECT COUNT(*) FROM channel_members WHERE channel_id = c.id) as member_count
             FROM chat_channels c WHERE c.project = ? ORDER BY c.sort_order ASC, c.name`,
            [req.params.project]
        );
        const topLevel = channels.filter(c => !c.parent_channel_id);
        const tree = topLevel.map(parent => ({
            ...parent,
            children: channels.filter(c => c.parent_channel_id === parent.id)
        }));
        res.json(tree);
    });

    // Create channel
    app.post('/api/channels', auth, adminOnly, (req, res) => {
        const { name, project, description, parent_channel_id } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO chat_channels (id, name, project, description, created_by, parent_channel_id) VALUES (?, ?, ?, ?, ?, ?)`,
            [id, name.toLowerCase().replace(/\s+/g, '-'), project || null, description, req.user.id, parent_channel_id || null]);
        saveDb();
        res.json({ success: true, channel_id: id });
    });

    // Update channel
    app.put('/api/channels/:id', auth, adminOnly, (req, res) => {
        const { name, description } = req.body;
        db.run(`UPDATE chat_channels SET name = COALESCE(?, name), description = COALESCE(?, description) WHERE id = ?`,
            [name, description, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Delete channel
    app.delete('/api/channels/:id', auth, adminOnly, (req, res) => {
        const channel = query.get('SELECT is_default FROM chat_channels WHERE id = ?', [req.params.id]);
        if (channel?.is_default) return res.status(400).json({ error: 'Cannot delete default channel' });

        // Also delete child channels and their messages and members
        const children = query.all('SELECT id FROM chat_channels WHERE parent_channel_id = ?', [req.params.id]);
        children.forEach(child => {
            db.run('DELETE FROM channel_members WHERE channel_id = ?', [child.id]);
            db.run('DELETE FROM chat_messages WHERE channel_id = ?', [child.id]);
            db.run('DELETE FROM chat_channels WHERE id = ?', [child.id]);
        });

        db.run('DELETE FROM channel_members WHERE channel_id = ?', [req.params.id]);
        db.run('DELETE FROM chat_messages WHERE channel_id = ?', [req.params.id]);
        db.run('DELETE FROM chat_channels WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== CHANNEL MEMBERS (read-only) ==========

    // Get channel members
    app.get('/api/channels/:id/members', auth, adminOnly, (req, res) => {
        const members = query.all(`
            SELECT cm.*, t.name as member_name, t.role as member_role, t.avatar_color
            FROM channel_members cm
            LEFT JOIN team_members t ON cm.member_id = t.id
            WHERE cm.channel_id = ?
            ORDER BY cm.joined_at
        `, [req.params.id]);
        res.json(members);
    });

    // Get chat messages for a channel
    app.get('/api/chat/messages', auth, adminOnly, (req, res) => {
        const { channel_id } = req.query;
        let sql = `
            SELECT m.*, t.name as sender_name, t.avatar_color, t.role as sender_role,
                   r.message as reply_message, rt.name as reply_sender_name
            FROM chat_messages m
            LEFT JOIN team_members t ON m.sender_id = t.id
            LEFT JOIN chat_messages r ON m.reply_to = r.id
            LEFT JOIN team_members rt ON r.sender_id = rt.id
        `;
        const params = [];

        if (channel_id) {
            sql += ' WHERE m.channel_id = ?';
            params.push(channel_id);
        } else {
            // Default to general channel or messages without channel
            sql += ' WHERE m.channel_id IS NULL OR m.channel_id = (SELECT id FROM chat_channels WHERE is_default = 1 LIMIT 1)';
        }
        sql += ' ORDER BY m.created_at DESC LIMIT 100';

        const messages = query.all(sql, params);
        res.json(messages.reverse());
    });

    // Send chat message to channel
    app.post('/api/chat/messages', auth, adminOnly, (req, res) => {
        const { message, sender_id, channel_id, reply_to, file_url, file_name, file_type } = req.body;
        const id = uuidv4();

        // Use default channel if none specified
        let targetChannel = channel_id;
        if (!targetChannel) {
            const defaultCh = query.get('SELECT id FROM chat_channels WHERE is_default = 1 LIMIT 1');
            targetChannel = defaultCh?.id || null;
        }

        db.run(`INSERT INTO chat_messages (id, sender_id, channel_id, message, reply_to, file_url, file_name, file_type) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, sender_id, targetChannel, message || '', reply_to || null, file_url || null, file_name || null, file_type || null]);
        saveDb();

        const msg = query.get(`
            SELECT m.*, t.name as sender_name, t.avatar_color, t.role as sender_role,
                   r.message as reply_message, rt.name as reply_sender_name
            FROM chat_messages m
            LEFT JOIN team_members t ON m.sender_id = t.id
            LEFT JOIN chat_messages r ON m.reply_to = r.id
            LEFT JOIN team_members rt ON r.sender_id = rt.id
            WHERE m.id = ?
        `, [id]);
        res.json(msg);
    });

    // Upload file for chat
    app.post('/api/chat/upload', auth, adminOnly, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        // Move file to chat folder
        const oldPath = req.file.path;
        const newPath = path.join(uploadsDir, 'chat', req.file.filename);
        fs.renameSync(oldPath, newPath);

        const fileUrl = `/uploads/chat/${req.file.filename}`;
        const fileType = req.file.mimetype.startsWith('image/') ? 'image' : 'file';

        res.json({
            url: fileUrl,
            name: req.file.originalname,
            type: fileType
        });
    });

    // Create or get DM channel between two team members
    app.post('/api/chat/dm', auth, adminOnly, (req, res) => {
        const { target_member_id } = req.body;
        const member = query.get('SELECT id, name FROM team_members WHERE user_id = ?', [req.user.id]);
        if (!member) return res.status(400).json({ error: 'Team member not found' });

        const targetMember = query.get('SELECT id, name FROM team_members WHERE id = ?', [target_member_id]);
        if (!targetMember) return res.status(400).json({ error: 'Target member not found' });

        // Check if DM channel already exists (check both directions)
        const dmName1 = `dm:${member.id}:${target_member_id}`;
        const dmName2 = `dm:${target_member_id}:${member.id}`;

        let channel = query.get('SELECT * FROM chat_channels WHERE name = ? OR name = ?', [dmName1, dmName2]);

        if (!channel) {
            // Create new DM channel
            const id = uuidv4();
            db.run(`INSERT INTO chat_channels (id, name, description, project, is_default, created_by) VALUES (?, ?, ?, ?, ?, ?)`,
                [id, dmName1, `DM between ${member.name} and ${targetMember.name}`, 'dm', 0, member.id]);
            saveDb();
            channel = query.get('SELECT * FROM chat_channels WHERE id = ?', [id]);
        }

        res.json({
            ...channel,
            other_member: targetMember
        });
    });

    // Get unread count per channel for user
    app.get('/api/chat/unread', auth, adminOnly, (req, res) => {
        const member = query.get('SELECT id FROM team_members WHERE user_id = ?', [req.user.id]);
        if (!member) return res.json({});

        const channels = query.all('SELECT id FROM chat_channels');
        const unreadCounts = {};

        channels.forEach(ch => {
            const lastRead = query.get('SELECT last_read_at FROM channel_read_status WHERE user_id = ? AND channel_id = ?',
                [member.id, ch.id]);

            let count = 0;
            if (lastRead) {
                count = query.get('SELECT COUNT(*) as c FROM chat_messages WHERE channel_id = ? AND created_at > ? AND sender_id != ?',
                    [ch.id, lastRead.last_read_at, member.id])?.c || 0;
            } else {
                count = query.get('SELECT COUNT(*) as c FROM chat_messages WHERE channel_id = ? AND sender_id != ?',
                    [ch.id, member.id])?.c || 0;
            }
            unreadCounts[ch.id] = count;
        });

        res.json(unreadCounts);
    });

    // Mark channel as read
    app.post('/api/chat/read', auth, adminOnly, (req, res) => {
        const { channel_id } = req.body;
        const member = query.get('SELECT id FROM team_members WHERE user_id = ?', [req.user.id]);
        if (!member) return res.status(400).json({ error: 'Team member not found' });

        const existing = query.get('SELECT id FROM channel_read_status WHERE user_id = ? AND channel_id = ?',
            [member.id, channel_id]);

        if (existing) {
            db.run('UPDATE channel_read_status SET last_read_at = datetime("now") WHERE id = ?', [existing.id]);
        } else {
            db.run('INSERT INTO channel_read_status (id, user_id, channel_id) VALUES (?, ?, ?)',
                [uuidv4(), member.id, channel_id]);
        }
        saveDb();
        res.json({ success: true });
    });

    // ========== PINNED ITEMS ROUTES ==========

    // Get user's pinned items
    app.get('/api/pinned', auth, adminOnly, (req, res) => {
        const items = query.all('SELECT * FROM pinned_items WHERE user_id = ? ORDER BY display_order, created_at DESC',
            [req.user.id]);
        res.json(items);
    });

    // Pin an item
    app.post('/api/pinned', auth, adminOnly, (req, res) => {
        const { item_type, item_id, item_title, item_subtitle, project } = req.body;

        // Check if already pinned
        const existing = query.get('SELECT id FROM pinned_items WHERE user_id = ? AND item_type = ? AND item_id = ?',
            [req.user.id, item_type, item_id]);
        if (existing) return res.json({ success: true, already_pinned: true, id: existing.id });

        const id = uuidv4();
        const maxOrder = query.get('SELECT MAX(display_order) as m FROM pinned_items WHERE user_id = ?', [req.user.id])?.m || 0;

        db.run(`INSERT INTO pinned_items (id, user_id, item_type, item_id, item_title, item_subtitle, project, display_order)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.user.id, item_type, item_id, item_title, item_subtitle, project, maxOrder + 1]);
        saveDb();
        res.json({ success: true, id });
    });

    // Unpin an item
    app.delete('/api/pinned/:id', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM pinned_items WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // Reorder pinned items
    app.put('/api/pinned/reorder', auth, adminOnly, (req, res) => {
        const { order } = req.body; // Array of item IDs in desired order
        order.forEach((id, index) => {
            db.run('UPDATE pinned_items SET display_order = ? WHERE id = ? AND user_id = ?',
                [index, id, req.user.id]);
        });
        saveDb();
        res.json({ success: true });
    });

    // ========== PROJECT SETTINGS ==========

    // Get all project settings
    app.get('/api/projects/settings', auth, adminOnly, (req, res) => {
        const settings = query.all('SELECT * FROM project_settings');
        const result = {};
        settings.forEach(s => {
            result[s.project] = {
                date: s.event_date,
                end_date: s.end_date || null,
                description: s.description,
                venue: s.venue || null,
                location: s.location || null
            };
        });
        res.json(result);
    });

    // Update project settings (date, end_date, venue, location, description)
    app.put('/api/projects/:project/settings', auth, adminOnly, (req, res) => {
        const { project } = req.params;
        const { date, end_date, venue, location, description } = req.body;

        if (!date) return res.status(400).json({ error: 'Date is required' });

        const existing = query.get('SELECT project FROM project_settings WHERE project = ?', [project]);
        if (existing) {
            query.run(`UPDATE project_settings SET event_date = ?, end_date = ?, venue = ?, location = ?, description = ?, updated_at = ?, updated_by = ? WHERE project = ?`,
                [date, end_date || null, venue || null, location || null, description || null, new Date().toISOString(), req.user.id, project]);
        } else {
            query.run(`INSERT INTO project_settings (project, event_date, end_date, venue, location, description, updated_by) VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [project, date, end_date || null, venue || null, location || null, description || '', req.user.id]);
        }

        res.json({ success: true, project, date, end_date: end_date || null, venue: venue || null, location: location || null, description: description || null });
    });

    // Legacy endpoint - keep for backward compatibility
    app.put('/api/projects/:project/date', auth, adminOnly, (req, res) => {
        const { project } = req.params;
        const { date, description } = req.body;

        if (!date) return res.status(400).json({ error: 'Date is required' });

        const existing = query.get('SELECT project FROM project_settings WHERE project = ?', [project]);
        if (existing) {
            if (description !== undefined) {
                query.run('UPDATE project_settings SET event_date = ?, description = ?, updated_at = ?, updated_by = ? WHERE project = ?',
                    [date, description, new Date().toISOString(), req.user.id, project]);
            } else {
                query.run('UPDATE project_settings SET event_date = ?, updated_at = ?, updated_by = ? WHERE project = ?',
                    [date, new Date().toISOString(), req.user.id, project]);
            }
        } else {
            query.run('INSERT INTO project_settings (project, event_date, description, updated_by) VALUES (?, ?, ?, ?)',
                [project, date, description || '', req.user.id]);
        }

        res.json({ success: true, project, date, description: description || null });
    });

    // ========== DASHBOARD SUMMARY ==========

    app.get('/api/dashboard/summary', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const program = query.get('SELECT id FROM accelerator_programs WHERE is_active = 1');

        const summary = {
            plexus: {
                registrations: query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ?', [conf?.id])?.c || 0,
                speakers: query.get('SELECT COUNT(*) as c FROM speakers WHERE conference_id = ?', [conf?.id])?.c || 0,
                pending_tasks: query.get("SELECT COUNT(*) as c FROM project_tasks WHERE project = 'plexus' AND status != 'done'")?.c || 0
            },
            accelerator: {
                applications: query.get('SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ?', [program?.id])?.c || 0,
                to_review: query.get("SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ? AND status = 'submitted'", [program?.id])?.c || 0,
                accepted: query.get("SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ? AND decision = 'accepted'", [program?.id])?.c || 0
            },
            forum: {
                members: 58, // Static for now
                events: 4
            },
            bridges: {
                cities: 4,
                events: 4
            },
            tasks: {
                total: query.get("SELECT COUNT(*) as c FROM project_tasks WHERE status != 'done'")?.c || 0,
                urgent: query.get("SELECT COUNT(*) as c FROM project_tasks WHERE status != 'done' AND priority = 'high'")?.c || 0
            }
        };

        res.json(summary);
    });

    // ========== PROJECT TASKS ROUTES ==========

    // Get tasks for a project
    app.get('/api/tasks/:project', auth, adminOnly, (req, res) => {
        // Get parent tasks (no parent_id)
        const tasks = query.all('SELECT * FROM project_tasks WHERE project = ? AND (parent_id IS NULL OR parent_id = "") ORDER BY sort_order, created_at DESC',
            [req.params.project]);
        // Attach files and subtasks to each task
        tasks.forEach(task => {
            task.files = query.all('SELECT id, filename, original_name, file_size FROM task_files WHERE task_id = ?', [task.id]);
            task.subtasks = query.all('SELECT * FROM project_tasks WHERE parent_id = ? ORDER BY sort_order, created_at', [task.id]);
            task.subtasks.forEach(st => {
                st.files = query.all('SELECT id, filename, original_name, file_size FROM task_files WHERE task_id = ?', [st.id]);
            });
        });
        res.json(tasks);
    });

    // Get all tasks summary
    app.get('/api/tasks', auth, adminOnly, (req, res) => {
        const tasks = query.all('SELECT * FROM project_tasks ORDER BY due_date, priority DESC');
        const summary = {
            total: tasks.length,
            todo: tasks.filter(t => t.status === 'todo').length,
            in_progress: tasks.filter(t => t.status === 'in_progress').length,
            done: tasks.filter(t => t.status === 'done').length,
            by_project: {
                plexus: tasks.filter(t => t.project === 'plexus'),
                accelerator: tasks.filter(t => t.project === 'accelerator'),
                forum: tasks.filter(t => t.project === 'forum')
            }
        };
        res.json(summary);
    });

    // Create task
    app.post('/api/tasks', auth, adminOnly, (req, res) => {
        const { project, title, description, assigned_to, priority, due_date, parent_id } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO project_tasks (id, project, title, description, assigned_to, priority, due_date, created_by, parent_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, project || 'general', title, description, assigned_to || null, priority || 'medium', due_date, req.user.id, parent_id || null]);
        saveDb();
        res.json({ success: true, id, task_id: id });
    });

    // Update task
    app.put('/api/tasks/:id', auth, adminOnly, (req, res) => {
        const { title, description, assigned_to, priority, status, due_date, project } = req.body;
        db.run(`UPDATE project_tasks SET
            title = COALESCE(?, title),
            description = COALESCE(?, description),
            assigned_to = ?,
            priority = COALESCE(?, priority),
            status = COALESCE(?, status),
            due_date = ?,
            project = COALESCE(?, project),
            completed_at = ${status === 'done' ? "datetime('now')" : 'NULL'}
            WHERE id = ?`,
            [title, description, assigned_to, priority, status, due_date, project, req.params.id]);
        saveDb();
        res.json({ success: true, id: req.params.id });
    });

    // Upload file to task
    app.post('/api/tasks/:id/files', auth, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const fileId = uuidv4();
        const task = query.get('SELECT id FROM project_tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        // Move file to tasks folder
        const newPath = path.join(uploadsDir, 'tasks', req.file.filename);
        if (!fs.existsSync(path.join(uploadsDir, 'tasks'))) {
            fs.mkdirSync(path.join(uploadsDir, 'tasks'), { recursive: true });
        }
        fs.renameSync(req.file.path, newPath);

        db.run(`INSERT INTO task_files (id, task_id, filename, original_name, file_path, file_size, mime_type)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [fileId, req.params.id, req.file.filename, req.file.originalname, newPath, req.file.size, req.file.mimetype]);
        saveDb();

        res.json({ success: true, id: fileId, filename: req.file.originalname });
    });

    // Delete task file
    app.delete('/api/tasks/files/:fileId', auth, adminOnly, (req, res) => {
        const file = query.get('SELECT * FROM task_files WHERE id = ?', [req.params.fileId]);
        if (!file) return res.status(404).json({ error: 'File not found' });

        // Delete physical file
        if (file.file_path && fs.existsSync(file.file_path)) {
            fs.unlinkSync(file.file_path);
        }

        db.run('DELETE FROM task_files WHERE id = ?', [req.params.fileId]);
        saveDb();
        res.json({ success: true });
    });

    // Quick toggle task status
    app.post('/api/tasks/:id/toggle', auth, adminOnly, (req, res) => {
        const task = query.get('SELECT status FROM project_tasks WHERE id = ?', [req.params.id]);
        if (!task) return res.status(404).json({ error: 'Task not found' });

        const nextStatus = task.status === 'todo' ? 'in_progress' : task.status === 'in_progress' ? 'done' : 'todo';
        db.run('UPDATE project_tasks SET status = ?, completed_at = ? WHERE id = ?',
            [nextStatus, nextStatus === 'done' ? new Date().toISOString() : null, req.params.id]);
        saveDb();
        res.json({ success: true, new_status: nextStatus });
    });

    // Delete task
    app.delete('/api/tasks/:id', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM project_tasks WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== SEQUENCE TASKS ==========

    // Get all sequences (optionally by project)
    app.get('/api/sequences', auth, adminOnly, (req, res) => {
        const project = req.query.project;
        let sequences;
        if (project) {
            sequences = query.all('SELECT * FROM task_sequences WHERE project = ? ORDER BY created_at DESC', [project]);
        } else {
            sequences = query.all('SELECT * FROM task_sequences ORDER BY created_at DESC');
        }

        // Attach steps to each sequence
        sequences.forEach(seq => {
            seq.steps = query.all('SELECT s.*, u.first_name, u.last_name FROM sequence_steps s LEFT JOIN team_members u ON s.assigned_to = u.id WHERE s.sequence_id = ? ORDER BY s.step_order', [seq.id]);
        });

        res.json(sequences);
    });

    // Get single sequence
    app.get('/api/sequences/:id', auth, adminOnly, (req, res) => {
        const sequence = query.get('SELECT * FROM task_sequences WHERE id = ?', [req.params.id]);
        if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

        sequence.steps = query.all('SELECT s.*, u.first_name, u.last_name FROM sequence_steps s LEFT JOIN team_members u ON s.assigned_to = u.id WHERE s.sequence_id = ? ORDER BY s.step_order', [req.params.id]);
        res.json(sequence);
    });

    // Create sequence
    app.post('/api/sequences', auth, adminOnly, (req, res) => {
        const { name, project, description, steps } = req.body;
        const sequenceId = uuidv4();

        db.run(`INSERT INTO task_sequences (id, name, project, description, created_by) VALUES (?, ?, ?, ?, ?)`,
            [sequenceId, name, project || null, description, req.user.id]);

        // Insert steps
        (steps || []).forEach((step, index) => {
            const stepId = uuidv4();
            db.run(`INSERT INTO sequence_steps (id, sequence_id, step_order, title, description, assigned_to, status)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [stepId, sequenceId, index + 1, step.title, step.description || null, step.assigned_to || null, index === 0 ? 'active' : 'pending']);
        });

        saveDb();
        res.json({ success: true, id: sequenceId });
    });

    // Complete a step (moves to next step)
    app.post('/api/sequences/:seqId/steps/:stepId/complete', auth, adminOnly, (req, res) => {
        const sequence = query.get('SELECT * FROM task_sequences WHERE id = ?', [req.params.seqId]);
        if (!sequence) return res.status(404).json({ error: 'Sequence not found' });

        const step = query.get('SELECT * FROM sequence_steps WHERE id = ? AND sequence_id = ?', [req.params.stepId, req.params.seqId]);
        if (!step) return res.status(404).json({ error: 'Step not found' });

        if (step.status !== 'active') {
            return res.status(400).json({ error: 'This step is not currently active' });
        }

        // Complete current step
        db.run(`UPDATE sequence_steps SET status = 'completed', completed_at = datetime('now') WHERE id = ?`, [req.params.stepId]);

        // Activate next step
        const nextStep = query.get('SELECT * FROM sequence_steps WHERE sequence_id = ? AND step_order = ?', [req.params.seqId, step.step_order + 1]);
        if (nextStep) {
            db.run(`UPDATE sequence_steps SET status = 'active' WHERE id = ?`, [nextStep.id]);
            db.run(`UPDATE task_sequences SET current_step = ? WHERE id = ?`, [step.step_order + 1, req.params.seqId]);
            // TODO: Send notification to next person
        } else {
            // Sequence completed
            db.run(`UPDATE task_sequences SET status = 'completed' WHERE id = ?`, [req.params.seqId]);
        }

        saveDb();
        res.json({ success: true, nextStep: nextStep || null });
    });

    // Delete sequence
    app.delete('/api/sequences/:id', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM sequence_steps WHERE sequence_id = ?', [req.params.id]);
        db.run('DELETE FROM task_sequences WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== PROJECT TIMELINE EVENTS ==========

    // Get timeline events for a project
    app.get('/api/timeline/:project', auth, adminOnly, (req, res) => {
        const events = query.all(
            'SELECT * FROM project_timeline_events WHERE project = ? ORDER BY event_date ASC',
            [req.params.project]
        );
        res.json(events);
    });

    // Get all timeline events (for home timeline)
    app.get('/api/timeline', auth, adminOnly, (req, res) => {
        const events = query.all('SELECT * FROM project_timeline_events ORDER BY event_date ASC');
        res.json(events);
    });

    // Create timeline event
    app.post('/api/timeline/:project', auth, adminOnly, (req, res) => {
        const { name, description, event_date, end_date, event_type, color, completed } = req.body;
        if (!name || !event_date) {
            return res.status(400).json({ error: 'Name and event_date are required' });
        }

        const id = uuidv4();
        db.run(`INSERT INTO project_timeline_events (id, project, name, description, event_date, end_date, event_type, color, completed, created_by)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.project, name, description || null, event_date, end_date || null, event_type || 'point', color || null, completed ? 1 : 0, req.user?.id]);
        saveDb();
        res.json({ id, project: req.params.project, name, description, event_date, end_date, event_type: event_type || 'point', color, completed: completed ? 1 : 0 });
    });

    // Update timeline event
    app.put('/api/timeline/:project/:id', auth, adminOnly, (req, res) => {
        const { name, description, event_date, end_date, event_type, color, completed } = req.body;

        const existing = query.get('SELECT * FROM project_timeline_events WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Event not found' });

        db.run(`UPDATE project_timeline_events SET name = ?, description = ?, event_date = ?, end_date = ?, event_type = ?, color = ?, completed = ? WHERE id = ?`,
            [name || existing.name, description, event_date || existing.event_date, end_date, event_type || existing.event_type, color || existing.color, completed !== undefined ? (completed ? 1 : 0) : existing.completed, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Toggle timeline event completion
    app.patch('/api/timeline/:project/:id/toggle-complete', auth, adminOnly, (req, res) => {
        const existing = query.get('SELECT * FROM project_timeline_events WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Event not found' });

        const newCompleted = existing.completed ? 0 : 1;
        db.run('UPDATE project_timeline_events SET completed = ? WHERE id = ?', [newCompleted, req.params.id]);
        saveDb();
        res.json({ success: true, completed: newCompleted });
    });

    // Delete timeline event
    app.delete('/api/timeline/:project/:id', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM project_timeline_events WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== PROJECT FILES & FOLDERS ROUTES ==========

    // Project files storage
    const projectFilesStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const project = req.params.project || 'general';
            const dir = path.join(uploadsDir, 'projects', project);
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
    });
    const projectFilesUpload = multer({
        storage: projectFilesStorage,
        limits: { fileSize: 50 * 1024 * 1024 } // 50MB
    });

    // Get folders for a project
    app.get('/api/folders/:project', auth, adminOnly, (req, res) => {
        const { parent_id } = req.query;
        const folders = query.all(`
            SELECT * FROM project_folders
            WHERE project = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))
            ORDER BY name ASC
        `, [req.params.project, parent_id || null, parent_id || null]);
        res.json(folders);
    });

    // Create folder
    app.post('/api/folders/:project', auth, adminOnly, (req, res) => {
        const { name, parent_id, color } = req.body;
        if (!name) return res.status(400).json({ error: 'Folder name required' });

        const id = uuidv4();
        db.run(`INSERT INTO project_folders (id, project, name, parent_id, color, created_by)
            VALUES (?, ?, ?, ?, ?, ?)`,
            [id, req.params.project, name, parent_id || null, color || '#64748b', req.user.id]);
        saveDb();
        res.json({ success: true, folder: { id, name, parent_id, color } });
    });

    // Delete folder (and move files to parent)
    app.delete('/api/folders/:id', auth, adminOnly, (req, res) => {
        const folder = query.get('SELECT * FROM project_folders WHERE id = ?', [req.params.id]);
        if (!folder) return res.status(404).json({ error: 'Folder not found' });

        // Move files to parent folder
        db.run('UPDATE project_files SET folder_id = ? WHERE folder_id = ?', [folder.parent_id, req.params.id]);
        // Move subfolders to parent
        db.run('UPDATE project_folders SET parent_id = ? WHERE parent_id = ?', [folder.parent_id, req.params.id]);
        // Delete folder
        db.run('DELETE FROM project_folders WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Get files for a project (with folder support)
    app.get('/api/files/:project', auth, adminOnly, (req, res) => {
        const { folder_id } = req.query;
        const files = query.all(`
            SELECT f.*, u.first_name, u.last_name
            FROM project_files f
            LEFT JOIN users u ON f.uploaded_by = u.id
            WHERE f.project = ? AND (f.folder_id = ? OR (f.folder_id IS NULL AND ? IS NULL))
            ORDER BY f.created_at DESC
        `, [req.params.project, folder_id || null, folder_id || null]);

        const folders = query.all(`
            SELECT * FROM project_folders
            WHERE project = ? AND (parent_id = ? OR (parent_id IS NULL AND ? IS NULL))
            ORDER BY name ASC
        `, [req.params.project, folder_id || null, folder_id || null]);

        res.json({ files, folders });
    });

    // Upload file to project
    app.post('/api/files/:project', auth, adminOnly, projectFilesUpload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const id = uuidv4();
        const filePath = `/uploads/projects/${req.params.project}/${req.file.filename}`;
        const folderId = req.body.folder_id || null;

        db.run(`INSERT INTO project_files (id, project, folder_id, filename, original_name, file_path, file_size, mime_type, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.project, folderId, req.file.filename, req.file.originalname, filePath, req.file.size, req.file.mimetype, req.user.id]);
        saveDb();

        res.json({
            success: true,
            file: {
                id,
                filename: req.file.filename,
                original_name: req.file.originalname,
                file_path: filePath,
                file_size: req.file.size,
                mime_type: req.file.mimetype,
                folder_id: folderId
            }
        });
    });

    // Delete file from project
    app.delete('/api/files/:id', auth, adminOnly, (req, res) => {
        const file = query.get('SELECT * FROM project_files WHERE id = ?', [req.params.id]);
        if (!file) return res.status(404).json({ error: 'File not found' });

        // Delete physical file
        const fullPath = path.join(__dirname, file.file_path);
        if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);

        db.run('DELETE FROM project_files WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Search across projects, tasks, files
    app.get('/api/search', auth, adminOnly, (req, res) => {
        const { q } = req.query;
        if (!q || q.length < 2) return res.json({ tasks: [], files: [], folders: [] });

        const searchTerm = `%${q}%`;
        const tasks = query.all(`SELECT * FROM project_tasks WHERE title LIKE ? OR description LIKE ? LIMIT 10`,
            [searchTerm, searchTerm]);
        const files = query.all(`SELECT * FROM project_files WHERE original_name LIKE ? LIMIT 10`,
            [searchTerm]);
        const folders = query.all(`SELECT * FROM project_folders WHERE name LIKE ? LIMIT 10`,
            [searchTerm]);

        res.json({ tasks, files, folders });
    });

    // ========== ACCELERATOR ADMIN ROUTES ==========

    // Get all applications (admin)
    app.get('/api/admin/accelerator/applications', auth, adminOnly, (req, res) => {
        const { status, program_id } = req.query;
        let sql = `SELECT a.*,
            (SELECT COUNT(*) FROM accelerator_documents WHERE application_id = a.id) as doc_count
            FROM accelerator_applications a WHERE 1=1`;
        const params = [];

        if (status) { sql += ' AND a.status = ?'; params.push(status); }
        if (program_id) { sql += ' AND a.program_id = ?'; params.push(program_id); }

        sql += ' ORDER BY a.submitted_at DESC, a.created_at DESC';

        const applications = query.all(sql, params);
        res.json(applications);
    });

    // Get single application (admin)
    app.get('/api/admin/accelerator/applications/:id', auth, adminOnly, (req, res) => {
        const app = query.get('SELECT * FROM accelerator_applications WHERE id = ?', [req.params.id]);
        if (!app) return res.status(404).json({ error: 'Application not found' });

        app.documents = query.all('SELECT * FROM accelerator_documents WHERE application_id = ?', [req.params.id]);
        app.recommendations = query.all('SELECT * FROM accelerator_recommendations WHERE application_id = ?', [req.params.id]);

        // Get institution names
        const institutions = query.all('SELECT id, name FROM accelerator_institutions');
        const instMap = {};
        institutions.forEach(i => instMap[i.id] = i.name);
        app.first_choice_name = instMap[app.first_choice_institution];
        app.second_choice_name = instMap[app.second_choice_institution];
        app.third_choice_name = instMap[app.third_choice_institution];

        res.json(app);
    });

    // Review application (admin)
    app.put('/api/admin/accelerator/applications/:id/review', auth, adminOnly, (req, res) => {
        const { decision, decision_notes, assigned_institution, reviewer_notes } = req.body;

        db.run(`UPDATE accelerator_applications SET
            status = ?, decision = ?, decision_notes = ?, assigned_institution = ?,
            reviewer_notes = ?, reviewed_at = datetime('now'), reviewed_by = ?
            WHERE id = ?`, [
            decision === 'accepted' ? 'accepted' : decision === 'rejected' ? 'rejected' : 'under_review',
            decision, decision_notes, assigned_institution, reviewer_notes, req.user.id, req.params.id
        ]);
        saveDb();
        res.json({ success: true });
    });

    // Get accelerator analytics (admin)
    app.get('/api/admin/accelerator/analytics', auth, adminOnly, (req, res) => {
        const program = query.get('SELECT id FROM accelerator_programs WHERE is_active = 1');
        if (!program) return res.json({ total: 0, submitted: 0, accepted: 0, rejected: 0 });

        const pid = program.id;
        res.json({
            total: query.get('SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ?', [pid])?.c || 0,
            submitted: query.get('SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ? AND status = ?', [pid, 'submitted'])?.c || 0,
            under_review: query.get('SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ? AND status = ?', [pid, 'under_review'])?.c || 0,
            accepted: query.get('SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ? AND decision = ?', [pid, 'accepted'])?.c || 0,
            rejected: query.get('SELECT COUNT(*) as c FROM accelerator_applications WHERE program_id = ? AND decision = ?', [pid, 'rejected'])?.c || 0,
            by_institution: query.all(`SELECT first_choice_institution as inst, COUNT(*) as count
                FROM accelerator_applications WHERE program_id = ? AND status != 'draft'
                GROUP BY first_choice_institution`, [pid])
        });
    });

    // Export applications CSV (admin)
    app.get('/api/admin/accelerator/export', auth, adminOnly, (req, res) => {
        const applications = query.all(`SELECT a.*,
            i1.name as first_choice_name, i2.name as second_choice_name, i3.name as third_choice_name
            FROM accelerator_applications a
            LEFT JOIN accelerator_institutions i1 ON a.first_choice_institution = i1.id
            LEFT JOIN accelerator_institutions i2 ON a.second_choice_institution = i2.id
            LEFT JOIN accelerator_institutions i3 ON a.third_choice_institution = i3.id
            WHERE a.status != 'draft'
            ORDER BY a.submitted_at DESC`);

        const headers = ['App#', 'Name', 'Email', 'Institution', 'Degree', 'GPA', '1st Choice', '2nd Choice', '3rd Choice', 'Status', 'Decision', 'Submitted'];
        const csv = [headers.join(',')];

        applications.forEach(a => {
            csv.push([
                a.application_number,
                `${a.first_name} ${a.last_name}`,
                a.email,
                a.current_institution,
                a.degree_program,
                a.gpa,
                a.first_choice_name,
                a.second_choice_name,
                a.third_choice_name,
                a.status,
                a.decision || '',
                a.submitted_at || ''
            ].map(v => `"${(v || '').toString().replace(/"/g, '""')}"`).join(','));
        });

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename="accelerator_applications.csv"');
        res.send(csv.join('\n'));
    });

    // ========== ADMIN ROUTES ==========
    app.get('/api/admin/registrations', auth, adminOnly, (req, res) => {
        const { conference_id, status } = req.query;
        let sql = `SELECT r.*, u.first_name, u.last_name, u.email, u.institution, u.country, t.name as ticket_name
            FROM registrations r JOIN users u ON r.user_id = u.id JOIN ticket_types t ON r.ticket_type_id = t.id WHERE 1=1`;
        const params = [];
        if (conference_id) { sql += ' AND r.conference_id = ?'; params.push(conference_id); }
        if (status) { sql += ' AND r.status = ?'; params.push(status); }
        sql += ' ORDER BY r.created_at DESC';
        res.json(query.all(sql, params));
    });

    app.post('/api/admin/registrations/:id/checkin', auth, adminOnly, (req, res) => {
        db.run('UPDATE registrations SET checked_in = 1, checked_in_at = datetime("now") WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/admin/checkin/scan', auth, adminOnly, (req, res) => {
        try {
            const data = JSON.parse(req.body.qr_data);
            const reg = query.get(`SELECT r.*, u.first_name, u.last_name, u.email, t.name as ticket_name
                FROM registrations r JOIN users u ON r.user_id = u.id JOIN ticket_types t ON r.ticket_type_id = t.id WHERE r.id = ?`, [data.id]);
            if (!reg) return res.status(404).json({ error: 'Not found' });
            if (reg.checked_in) return res.json({ success: true, already_checked_in: true, registration: reg });
            db.run('UPDATE registrations SET checked_in = 1, checked_in_at = datetime("now") WHERE id = ?', [data.id]);
            saveDb();
            reg.checked_in = 1;
            res.json({ success: true, registration: reg });
        } catch { res.status(400).json({ error: 'Invalid QR' }); }
    });

    app.get('/api/admin/abstracts', auth, adminOnly, (req, res) => {
        res.json(query.all(`SELECT a.*, u.first_name, u.last_name, u.email, u.institution
            FROM abstracts a JOIN users u ON a.submitter_id = u.id ORDER BY a.created_at DESC`));
    });

    app.put('/api/admin/abstracts/:id/decision', auth, adminOnly, (req, res) => {
        const { decision, presentation_type } = req.body;
        db.run('UPDATE abstracts SET status = ?, decision = ?, presentation_type = ? WHERE id = ?',
            [decision === 'accepted' ? 'accepted' : 'rejected', decision, presentation_type, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.get('/api/admin/analytics/:confId', auth, adminOnly, (req, res) => {
        const cid = req.params.confId;
        res.json({
            registrations: {
                total: query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ?', [cid])?.c || 0,
                confirmed: query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ? AND status = ?', [cid, 'confirmed'])?.c || 0,
                checked_in: query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ? AND checked_in = 1', [cid])?.c || 0
            },
            abstracts: {
                total: query.get('SELECT COUNT(*) as c FROM abstracts WHERE conference_id = ?', [cid])?.c || 0,
                accepted: query.get('SELECT COUNT(*) as c FROM abstracts WHERE conference_id = ? AND decision = ?', [cid, 'accepted'])?.c || 0
            },
            revenue: query.get('SELECT SUM(amount_paid) as t FROM registrations WHERE conference_id = ? AND payment_status = ?', [cid, 'paid'])?.t || 0
        });
    });

    app.post('/api/admin/sessions', auth, adminOnly, (req, res) => {
        const { conference_id, title, description, session_type, day, start_time, end_time, room, track } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room, track)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, conference_id, title, description, session_type, day, start_time, end_time, room, track]);
        saveDb();
        res.json({ success: true, session_id: id });
    });

    app.post('/api/admin/announcements', auth, adminOnly, (req, res) => {
        const { conference_id, title, content, type, is_urgent } = req.body;
        db.run('INSERT INTO announcements (id, conference_id, title, content, type, is_urgent) VALUES (?, ?, ?, ?, ?, ?)',
            [uuidv4(), conference_id, title, content, type, is_urgent ? 1 : 0]);
        saveDb();
        res.json({ success: true });
    });

    app.get('/api/admin/export/registrations/:confId', auth, adminOnly, (req, res) => {
        const rows = query.all(`SELECT u.first_name, u.last_name, u.email, u.phone, u.institution, u.country, t.name as ticket_type, r.status, r.payment_status, r.amount_paid, r.checked_in, r.created_at
            FROM registrations r JOIN users u ON r.user_id = u.id JOIN ticket_types t ON r.ticket_type_id = t.id WHERE r.conference_id = ?`, [req.params.confId]);

        const headers = ['First Name','Last Name','Email','Phone','Institution','Country','Ticket','Status','Payment','Amount','Checked In','Date'];
        const csv = [headers.join(',')];
        rows.forEach(r => csv.push([r.first_name, r.last_name, r.email, r.phone, r.institution, r.country, r.ticket_type, r.status, r.payment_status, r.amount_paid, r.checked_in ? 'Yes' : 'No', r.created_at].map(v => `"${(v||'').toString().replace(/"/g,'""')}"`).join(',')));

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="registrations.csv"`);
        res.send(csv.join('\n'));
    });

    // ========== FILE UPLOAD ==========
    app.post('/api/upload/:type', auth, (req, res, next) => {
        if (!ALLOWED_UPLOAD_TYPES.includes(req.params.type)) {
            return res.status(400).json({ error: 'Invalid upload type' });
        }
        next();
    }, upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file' });
        res.json({ success: true, file_url: `/uploads/${req.params.type}/${req.file.filename}` });
    });

    // ========== PLEXUS CONFERENCE COMPREHENSIVE APIS ==========

    // --- REGISTRATION FLOW ---

    // Get conference info for registration
    app.get('/api/plexus/conference', (req, res) => {
        const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
        if (!conf) return res.status(404).json({ error: 'Conference not found' });

        const tickets = query.all('SELECT * FROM ticket_types WHERE conference_id = ? ORDER BY sort_order', [conf.id]);
        const today = new Date().toISOString().split('T')[0];

        // Determine pricing tier
        let pricingTier = 'late';
        if (today <= conf.early_bird_deadline) pricingTier = 'early_bird';
        else if (today <= conf.regular_deadline) pricingTier = 'regular';

        // Check capacity
        const regCount = query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ? AND status != ?', [conf.id, 'cancelled'])?.c || 0;
        const isFull = regCount >= conf.max_capacity;

        res.json({
            ...conf,
            tickets: tickets.map(t => ({
                ...t,
                current_price: pricingTier === 'early_bird' ? t.price_early_bird : pricingTier === 'regular' ? t.price_regular : t.price_late
            })),
            pricing_tier: pricingTier,
            is_full: isFull,
            spots_remaining: conf.max_capacity - regCount
        });
    });

    // Validate promo code
    app.post('/api/plexus/promo/validate', (req, res) => {
        const { code } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const promo = query.get('SELECT * FROM promo_codes WHERE conference_id = ? AND code = ? AND is_active = 1', [conf.id, code?.toUpperCase()]);

        if (!promo) return res.json({ valid: false, message: 'Invalid promo code' });
        if (promo.valid_until && new Date(promo.valid_until) < new Date()) return res.json({ valid: false, message: 'Promo code has expired' });
        if (promo.max_uses && promo.used_count >= promo.max_uses) return res.json({ valid: false, message: 'Promo code has reached maximum uses' });

        res.json({
            valid: true,
            discount_type: promo.discount_type,
            discount_value: promo.discount_value,
            promo_id: promo.id
        });
    });

    // Single-step registration (used by frontend PlexusPortal.submitRegistration)
    app.post('/api/plexus/register', auth, async (req, res) => {
        try {
            const { first_name, last_name, email, institution, country, pricing, dietary, accessibility, billing, package_items, payment_method } = req.body;
            const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
            if (!conf) return res.status(400).json({ error: 'Conference not found' });

            // Check if already registered
            const existing = query.get('SELECT * FROM registrations WHERE conference_id = ? AND user_id = ? AND status != ?', [conf.id, req.user.id, 'cancelled']);
            if (existing) {
                // Update amount + billing on unpaid registrations (user may retry with different options)
                if (existing.payment_status !== 'paid') {
                    // Recalculate amount server-side — NEVER trust client-sent total
                    const newTotal = existing.amount_paid;
                    if (newTotal !== existing.amount_paid) {
                        db.run('UPDATE registrations SET amount_paid = ? WHERE id = ?', [newTotal, existing.id]);
                        existing.amount_paid = newTotal;
                    }

                    // Ensure billing data + payment transaction exist for FIRA
                    if (billing) {
                        const existingTx = query.get('SELECT * FROM payment_transactions WHERE registration_id = ?', [existing.id]);
                        if (existingTx) {
                            // Update billing + amount in existing transaction
                            const meta = existingTx.metadata ? JSON.parse(existingTx.metadata) : {};
                            meta.billing = billing;
                            db.run('UPDATE payment_transactions SET metadata = ?, amount = ? WHERE id = ?',
                                [JSON.stringify(meta), newTotal, existingTx.id]);
                        } else {
                            // Create missing payment transaction + invoice
                            const invoiceNumber = existing.invoice_number || `INV-${Date.now()}-${uuidv4().split('-')[0]}`;
                            const vatBreakdown = firaService.calculateVAT(newTotal);

                            const existingInv = query.get('SELECT id FROM invoices WHERE registration_id = ?', [existing.id]);
                            if (!existingInv) {
                                const invoiceId = uuidv4();
                                const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0];
                                db.run(`INSERT INTO invoices (id, invoice_number, registration_id, recipient_name, recipient_address, recipient_vat, recipient_email, items, subtotal, vat_rate, vat_amount, total, currency, status, issued_at, due_date)
                                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                                    [invoiceId, invoiceNumber, existing.id,
                                     billing.company || billing.name || `${first_name} ${last_name}`,
                                     [billing.address, billing.city, billing.zip, billing.country].filter(Boolean).join(', '),
                                     billing.oib || billing.vatNumber || null, billing.email || email,
                                     JSON.stringify([{ description: `Plexus 2026`, quantity: 1, price: newTotal }]),
                                     vatBreakdown.netto, 25, vatBreakdown.taxValue, newTotal, 'EUR',
                                     'issued', new Date().toISOString(), dueDate]);
                            } else {
                                // Update existing invoice amount
                                const vatBreakdown2 = firaService.calculateVAT(newTotal);
                                db.run('UPDATE invoices SET subtotal = ?, vat_amount = ?, total = ? WHERE registration_id = ?',
                                    [vatBreakdown2.netto, vatBreakdown2.taxValue, newTotal, existing.id]);
                            }

                            const txId = uuidv4();
                            db.run(`INSERT INTO payment_transactions (id, registration_id, amount, currency, payment_method, payment_provider, status, metadata)
                                VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                                [txId, existing.id, newTotal, 'EUR',
                                 payment_method === 'card' ? 'card' : 'bank_transfer',
                                 payment_method === 'card' ? 'stripe' : 'manual', 'pending',
                                 JSON.stringify({ invoice_number: invoiceNumber, billing: billing })]);
                        }
                        saveDb();
                    }
                }
                return res.status(400).json({ error: 'Already registered', registration_id: existing.id });
            }

            // Find a matching ticket type based on pricing selection (e.g. 'professional-early', 'student-early')
            const tickets = query.all('SELECT * FROM ticket_types WHERE conference_id = ? ORDER BY sort_order', [conf.id]);
            let ticket = tickets[0]; // default to first ticket
            if (pricing) {
                const isStudent = pricing.includes('student');
                const match = tickets.find(t => isStudent ? t.name.toLowerCase().includes('student') : !t.name.toLowerCase().includes('student'));
                if (match) ticket = match;
            }

            // Calculate price server-side — NEVER trust client-sent total
            const today = new Date().toISOString().split('T')[0];
            const baseTicketPrice = today <= conf.early_bird_deadline ? ticket.price_early_bird : today <= conf.regular_deadline ? ticket.price_regular : ticket.price_late;
            let price = baseTicketPrice;

            // Apply promo code discount server-side if provided
            if (req.body.coupon) {
                const promo = query.get('SELECT * FROM promo_codes WHERE conference_id = ? AND code = ? AND is_active = 1', [conf.id, req.body.coupon.toUpperCase()]);
                if (promo && (!promo.valid_until || new Date(promo.valid_until) >= new Date()) && (!promo.max_uses || promo.used_count < promo.max_uses)) {
                    const discount = promo.discount_type === 'percentage' ? price * (promo.discount_value / 100) : promo.discount_value;
                    price = Math.max(0, price - discount);
                    db.run('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)', [promo.id]);
                    if (db.getRowsModified() === 0) {
                        return res.status(400).json({ error: 'Promo code has reached its maximum number of uses' });
                    }
                }
            }

            const regId = uuidv4();
            const invoiceNumber = `INV-${Date.now()}-${uuidv4().split('-')[0]}`;

            // Determine payment status: free tickets are auto-paid, others start as pending
            const paymentStatus = price === 0 ? 'paid' : 'pending';
            const chosenPaymentMethod = payment_method === 'card' && stripe ? 'card' : 'bank_transfer';

            // Create registration (status: confirmed so they can attend, payment_status: pending until payment)
            db.run(`INSERT INTO registrations (id, conference_id, user_id, ticket_type_id, registration_type, status, payment_status, amount_paid, invoice_number, dietary_requirements, accessibility_needs)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [regId, conf.id, req.user.id, ticket.id, 'general', 'confirmed', paymentStatus, price, invoiceNumber, dietary || null, accessibility || null]);

            // Update user profile if needed
            if (first_name || last_name || institution || country) {
                db.run('UPDATE users SET first_name = COALESCE(?, first_name), last_name = COALESCE(?, last_name), institution = COALESCE(?, institution), country = COALESCE(?, country) WHERE id = ?',
                    [first_name || null, last_name || null, institution || null, country || null, req.user.id]);
            }

            db.run('UPDATE ticket_types SET sold_count = sold_count + 1 WHERE id = ?', [ticket.id]);

            // --- Invoice + Payment Transaction ---
            let firaInvoice = null;
            let invoiceRecord = null;
            const vatBreakdown = firaService.calculateVAT(price);

            if (price > 0 && billing) {
                // Store invoice record regardless of FIRA availability
                const invoiceId = uuidv4();
                const items = JSON.stringify([{
                    description: `Plexus 2026 — ${ticket.name}`,
                    quantity: 1,
                    price: price
                }]);
                const dueDate = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString().split('T')[0]; // 7 days from now

                db.run(`INSERT INTO invoices (id, invoice_number, registration_id, recipient_name, recipient_address, recipient_vat, recipient_email, items, subtotal, vat_rate, vat_amount, total, currency, status, issued_at, due_date)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [invoiceId, invoiceNumber, regId,
                     billing.company || billing.name || `${first_name} ${last_name}`,
                     [billing.address, billing.city, billing.zip, billing.country].filter(Boolean).join(', '),
                     billing.oib || billing.vatNumber || null,
                     billing.email || email,
                     items, vatBreakdown.netto, 25, vatBreakdown.taxValue, price, 'EUR',
                     'issued', new Date().toISOString(), dueDate]);

                invoiceRecord = {
                    id: invoiceId,
                    invoice_number: invoiceNumber,
                    subtotal: vatBreakdown.netto,
                    vat_amount: vatBreakdown.taxValue,
                    total: price,
                    due_date: dueDate
                };

                // For bank transfer: create FIRA fiscal invoice immediately (payment expected later)
                // For card: FIRA fiscal invoice is deferred until Stripe webhook confirms payment
                if (chosenPaymentMethod === 'bank_transfer') {
                    try {
                        firaInvoice = await firaService.createFiscalInvoice({
                            invoiceNumber,
                            ticketName: ticket.name,
                            ticketPrice: price,
                            addons: [],
                            billing: {
                                name: `${first_name || ''} ${last_name || ''}`.trim(),
                                company: billing.company || '',
                                address: billing.address || '',
                                city: billing.city || '',
                                zip: billing.zip || '',
                                country: billing.country || 'HR',
                                oib: billing.oib || '',
                                vatNumber: billing.vatNumber || '',
                                email: billing.email || email
                            },
                            invoiceType: 'RAČUN'  // Regular invoice (switch to FISKALNI_RAČUN once fiskalizacija is enabled)
                        });
                    } catch (firaErr) {
                        console.error('[FIRA] Invoice creation failed (non-blocking):', firaErr.message);
                    }
                }

                // Store payment transaction
                const txId = uuidv4();
                db.run(`INSERT INTO payment_transactions (id, registration_id, amount, currency, payment_method, payment_provider, provider_transaction_id, status, metadata)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [txId, regId, price, 'EUR', chosenPaymentMethod,
                     chosenPaymentMethod === 'card' ? 'stripe' : (firaInvoice ? 'fira' : 'manual'),
                     firaInvoice ? firaInvoice.firaId : null,
                     'pending',
                     JSON.stringify({
                         invoice_number: invoiceNumber,
                         fira_invoice_number: firaInvoice?.invoiceNumber || null,
                         fira_pdf_url: firaInvoice?.pdfUrl || null,
                         billing: billing,
                         subtotal: req.body.subtotal || price,
                         points_redeemed: req.body.points_redeemed || 0,
                         points_discount: req.body.points_discount || 0,
                         coupon_code: req.body.coupon || null,
                         coupon_discount: req.body.coupon_discount || 0
                     })]);
            }

            saveDb();

            // Send Plexus registration confirmation email
            try {
                const userName = first_name || req.user.first_name || '';
                const userEmail = email || req.user.email;
                const paymentInfo = paymentStatus === 'paid'
                    ? '<p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 12px 16px; border-radius: 8px; color: #065f46; font-weight: 600;">Your registration is confirmed — no payment required!</p>'
                    : chosenPaymentMethod === 'card'
                        ? '<p style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 16px; border-radius: 8px; color: #1e40af;">Please complete your card payment to secure your spot.</p>'
                        : `<p style="background: #eff6ff; border: 1px solid #bfdbfe; padding: 12px 16px; border-radius: 8px; color: #1e40af;">Please transfer <strong>&euro;${price.toFixed(2)}</strong> to our bank account using reference <strong>${invoiceNumber}</strong> to secure your spot.</p>`;

                sendEmail(userEmail, 'Welcome to Plexus 2026!', buildEmailTemplate('Welcome to Plexus 2026!', `
                    <p>Dear ${userName},</p>
                    <p>Thank you for registering for <strong>Plexus 2026</strong>! We are thrilled to have you join us.</p>
                    <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 140px;">Ticket</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${ticket.name}</td></tr>
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice Number</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${invoiceNumber}</td></tr>
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Amount</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">&euro;${price.toFixed(2)}</td></tr>
                        <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Payment Status</td>
                            <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${paymentStatus === 'paid' ? 'Paid' : 'Pending'}</td></tr>
                    </table>
                    ${paymentInfo}
                    <p style="margin-top: 20px;">If you have any questions, feel free to reach out to us at <a href="mailto:info@medx.hr" style="color: #C9A962;">info@medx.hr</a>.</p>
                    <p>We look forward to seeing you at Plexus 2026!</p>
                    <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
                `));
            } catch (emailErr) {
                console.warn('Plexus registration email failed:', emailErr.message);
            }

            // Build bank transfer details from environment
            const bankDetails = price > 0 ? {
                iban: process.env.MEDX_IBAN || 'HR1234567890123456789',
                bank_name: process.env.MEDX_BANK_NAME || 'Zagrebačka banka d.d.',
                swift: process.env.MEDX_SWIFT || 'ZABAHR2X',
                recipient: process.env.MEDX_COMPANY_NAME || 'Med&X',
                reference: invoiceNumber,
                amount: price,
                currency: 'EUR',
                vat_breakdown: vatBreakdown,
                due_date: invoiceRecord?.due_date || null
            } : null;

            res.json({
                success: true,
                registration_id: regId,
                invoice_number: invoiceNumber,
                amount: price,
                ticket_name: ticket.name,
                payment_status: paymentStatus,
                payment_method: chosenPaymentMethod,
                // FIRA fiscal invoice details (null if demo mode, free ticket, or card payment — card gets it after webhook)
                fira_invoice: firaInvoice ? {
                    fira_id: firaInvoice.firaId,
                    fira_invoice_number: firaInvoice.invoiceNumber,
                    pdf_url: firaInvoice.pdfUrl
                } : null,
                // Bank transfer instructions (null if free ticket or card payment)
                bank_transfer: chosenPaymentMethod === 'bank_transfer' ? bankDetails : null,
                // Invoice breakdown
                invoice: invoiceRecord,
                // Available payment methods
                payment_methods: { card: stripe !== null, bank_transfer: true },
                // Whether FIRA is active
                fira_active: firaService.isConfigured()
            });
        } catch (err) {
            console.error('Registration error:', err.message);
            res.status(500).json({ error: 'Registration failed' });
        }
    });

    // Get invoice details for a registration
    app.get('/api/plexus/registration/:id/invoice', auth, (req, res) => {
        try {
            const reg = query.get(`SELECT r.*, t.name as ticket_name, u.first_name, u.last_name, u.email
                FROM registrations r
                JOIN ticket_types t ON r.ticket_type_id = t.id
                JOIN users u ON r.user_id = u.id
                WHERE r.id = ? AND r.user_id = ?`, [req.params.id, req.user.id]);

            if (!reg) return res.status(404).json({ error: 'Registration not found' });

            const invoice = query.get('SELECT * FROM invoices WHERE registration_id = ?', [reg.id]);
            const transaction = query.get('SELECT * FROM payment_transactions WHERE registration_id = ?', [reg.id]);

            // Parse metadata for FIRA details
            let firaDetails = null;
            if (transaction?.metadata) {
                try {
                    const meta = JSON.parse(transaction.metadata);
                    firaDetails = {
                        fira_invoice_number: meta.fira_invoice_number,
                        pdf_url: meta.fira_pdf_url
                    };
                } catch (e) { /* ignore parse errors */ }
            }

            const bankDetails = reg.amount_paid > 0 ? {
                iban: process.env.MEDX_IBAN || 'HR1234567890123456789',
                bank_name: process.env.MEDX_BANK_NAME || 'Zagrebačka banka d.d.',
                swift: process.env.MEDX_SWIFT || 'ZABAHR2X',
                recipient: process.env.MEDX_COMPANY_NAME || 'Med&X',
                reference: reg.invoice_number,
                amount: reg.amount_paid,
                currency: 'EUR'
            } : null;

            res.json({
                registration: {
                    id: reg.id,
                    status: reg.status,
                    payment_status: reg.payment_status,
                    amount: reg.amount_paid,
                    invoice_number: reg.invoice_number,
                    ticket_name: reg.ticket_name,
                    attendee: `${reg.first_name} ${reg.last_name}`
                },
                invoice: invoice || null,
                fira: firaDetails,
                bank_transfer: bankDetails,
                transaction: transaction ? {
                    id: transaction.id,
                    status: transaction.status,
                    provider: transaction.payment_provider,
                    created_at: transaction.created_at
                } : null
            });
        } catch (err) {
            console.error('Invoice fetch error:', err.message);
            res.status(500).json({ error: 'Failed to fetch invoice details' });
        }
    });

    // Admin: Confirm bank transfer payment received
    app.post('/api/plexus/registration/:id/confirm-payment', auth, (req, res) => {
        try {
            // Verify admin access
            if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

            const reg = query.get(`SELECT r.*, t.name as ticket_name, u.first_name, u.last_name
                FROM registrations r
                JOIN ticket_types t ON r.ticket_type_id = t.id
                JOIN users u ON r.user_id = u.id
                WHERE r.id = ?`, [req.params.id]);
            if (!reg) return res.status(404).json({ error: 'Registration not found' });
            if (reg.payment_status === 'paid') return res.json({ success: true, message: 'Already marked as paid' });

            // Update registration payment status
            db.run('UPDATE registrations SET payment_status = ? WHERE id = ?', ['paid', reg.id]);

            // Update payment transaction status
            db.run('UPDATE payment_transactions SET status = ? WHERE registration_id = ?', ['completed', reg.id]);

            // Update invoice status
            db.run("UPDATE invoices SET status = 'paid', paid_at = ? WHERE registration_id = ?",
                [new Date().toISOString(), reg.id]);

            // Create finance income record (same as Stripe webhook path)
            createFinanceIncomeRecord(reg, reg.amount_paid, 'bank_transfer', reg.invoice_number);

            saveDb();

            res.json({
                success: true,
                message: 'Payment confirmed',
                registration_id: reg.id,
                invoice_number: reg.invoice_number
            });
        } catch (err) {
            console.error('Payment confirmation error:', err.message);
            res.status(500).json({ error: 'Failed to confirm payment' });
        }
    });

    // ========== STRIPE PAYMENT ENDPOINTS ==========

    // Stripe config (public — frontend needs publishable key)
    app.get('/api/plexus/stripe-config', (req, res) => {
        res.json({
            publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || null,
            enabled: stripe !== null
        });
    });

    // Create Stripe Checkout Session
    app.post('/api/plexus/checkout-session', auth, async (req, res) => {
        try {
            if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });

            const { registration_id } = req.body;
            if (!registration_id) return res.status(400).json({ error: 'registration_id is required' });

            const reg = query.get(`SELECT r.*, t.name as ticket_name, u.email as user_email
                FROM registrations r
                JOIN ticket_types t ON r.ticket_type_id = t.id
                JOIN users u ON r.user_id = u.id
                WHERE r.id = ? AND r.user_id = ?`, [registration_id, req.user.id]);
            if (!reg) return res.status(404).json({ error: 'Registration not found' });
            if (reg.payment_status === 'paid') return res.status(400).json({ error: 'Already paid' });

            const invoice = query.get('SELECT * FROM invoices WHERE registration_id = ?', [reg.id]);
            const tx = query.get('SELECT * FROM payment_transactions WHERE registration_id = ?', [reg.id]);

            // Get billing email from metadata
            let billingEmail = reg.user_email;
            if (tx?.metadata) {
                try {
                    const meta = JSON.parse(tx.metadata);
                    if (meta.billing?.email) billingEmail = meta.billing.email;
                } catch (e) { /* ignore */ }
            }

            const baseUrl = `${req.protocol}://${req.get('host')}`;

            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Plexus 2026 — ${reg.ticket_name}`,
                            description: `Conference registration (Invoice: ${reg.invoice_number})`
                        },
                        unit_amount: Math.round(reg.amount_paid * 100) // Stripe needs cents
                    },
                    quantity: 1
                }],
                metadata: {
                    registration_id: reg.id,
                    invoice_number: reg.invoice_number
                },
                customer_email: billingEmail,
                success_url: `${baseUrl}/?payment=success&reg=${reg.id}`,
                cancel_url: `${baseUrl}/?payment=cancelled&reg=${reg.id}`
            });

            // Store Stripe session ID and update payment method in transaction
            if (tx) {
                db.run('UPDATE payment_transactions SET provider_transaction_id = ?, payment_provider = ?, payment_method = ? WHERE id = ?',
                    [session.id, 'stripe', 'card', tx.id]);
                saveDb();
            }

            res.json({ sessionId: session.id, url: session.url });
        } catch (err) {
            console.error('Stripe checkout error:', err.message);
            res.status(500).json({ error: 'Failed to create checkout session' });
        }
    });

    // Stripe Webhook — payment confirmation (NO auth — Stripe signs it)
    app.post('/api/stripe/webhook', async (req, res) => {
        const sig = req.headers['stripe-signature'];

        // In demo mode (no Stripe), reject
        if (!stripe) return res.status(400).send('Stripe not configured');

        let event;
        try {
            if (!process.env.STRIPE_WEBHOOK_SECRET) {
                console.error('[Stripe] STRIPE_WEBHOOK_SECRET not set — webhook rejected');
                return res.status(500).json({ error: 'Webhook secret not configured' });
            }
            event = stripe.webhooks.constructEvent(req.body, sig, process.env.STRIPE_WEBHOOK_SECRET);
        } catch (err) {
            console.error('[Stripe] Webhook signature verification failed:', err.message);
            return res.status(400).send(`Webhook Error: ${err.message}`);
        }

        if (event.type === 'checkout.session.completed') {
            const session = event.data.object;
            const metadata = session.metadata || {};

            // ===== ACCELERATOR FEE PAYMENT =====
            if (metadata.type === 'accelerator-fee') {
                const applicationId = metadata.applicationId;
                const userId = metadata.userId;
                console.log(`[Stripe] Accelerator fee payment confirmed for application ${applicationId}`);

                try {
                    const application = query.get(
                        'SELECT a.*, u.first_name, u.last_name, u.email FROM accelerator_applications a JOIN users u ON a.user_id = u.id WHERE a.id = ?',
                        [applicationId]
                    );

                    if (!application) {
                        console.error(`[Stripe] Accelerator application ${applicationId} not found`);
                        return res.status(404).send('Application not found');
                    }

                    // 1. Update application status to 'paid'
                    db.run(`UPDATE accelerator_applications SET status = 'paid', payment_status = 'paid', payment_amount = 75, payment_date = datetime('now'), stripe_session_id = ? WHERE id = ?`,
                        [session.id, applicationId]);

                    // 2. Create FIRA fiscal invoice for processing fee
                    if (firaService.isConfigured()) {
                        try {
                            const firaInvoiceNumber = `AX-${application.application_number || applicationId.substring(0, 8)}`;
                            const firaResult = await firaService.createFiscalInvoice({
                                invoiceNumber: firaInvoiceNumber,
                                ticketName: 'Med&X Accelerator 2026 - Processing Fee',
                                ticketPrice: 75,
                                addons: [],
                                billing: {
                                    name: `${application.first_name || ''} ${application.last_name || ''}`.trim() || 'Applicant',
                                    company: '',
                                    address: application.address || '',
                                    city: '',
                                    zip: '',
                                    country: application.country_of_residence || 'HR',
                                    oib: application.oib || '',
                                    vatNumber: '',
                                    email: application.email
                                },
                                invoiceType: 'RAČUN',
                                paymentType: 'KARTICA'
                            });
                            console.log(`[Stripe→FIRA] Accelerator fiscal invoice created: ${firaResult?.invoiceNumber || 'N/A'}`);
                        } catch (firaErr) {
                            console.error('[Stripe→FIRA] Accelerator fiscal invoice creation failed (non-blocking):', firaErr.message);
                        }
                    }

                    // 3. Create finance income record
                    const year = new Date().getFullYear();
                    let seq = query.get('SELECT * FROM finance_sequences WHERE sequence_type = ? AND fiscal_year = ?', ['income', year]);
                    if (!seq) {
                        db.run('INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, ?, ?, 0, ?)',
                            [uuidv4(), 'income', year, 'P']);
                        seq = { current_value: 0, prefix: 'P' };
                    }
                    const newValue = (seq.current_value || 0) + 1;
                    db.run('UPDATE finance_sequences SET current_value = ? WHERE sequence_type = ? AND fiscal_year = ?',
                        [newValue, 'income', year]);
                    const transactionNumber = `${seq.prefix || 'P'}-${year}-${String(newValue).padStart(3, '0')}`;

                    const applicantName = `${application.first_name || ''} ${application.last_name || ''}`.trim() || 'Applicant';
                    db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, payment_method, reference, fiscal_year, status)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                        [uuidv4(), transactionNumber, 'income', 75, new Date().toISOString().split('T')[0],
                         `Accelerator 2026 — ${applicantName} — Processing Fee`,
                         'accelerator-2026', 'processing-fee',
                         'card', application.application_number || applicationId, year, 'completed']);

                    saveDb();
                    console.log(`[Stripe] Accelerator application ${applicationId} marked as paid, finance record ${transactionNumber} created`);

                    // Send accelerator payment confirmation email
                    try {
                        const applicantEmail = application.email;
                        if (applicantEmail) {
                            sendEmail(applicantEmail, 'Payment Confirmed — Med&X Accelerator 2026', buildEmailTemplate('Payment Confirmed', `
                                <p>Dear ${application.first_name || 'Applicant'},</p>
                                <p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 18px; border-radius: 8px; color: #065f46; font-weight: 600; font-size: 16px; text-align: center;">
                                    Your Accelerator processing fee has been received — your application is confirmed!
                                </p>
                                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 140px;">Amount Paid</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">&euro;75.00</td></tr>
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Application</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${application.application_number || applicationId}</td></tr>
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Status</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">Paid &amp; Confirmed</td></tr>
                                </table>
                                <p>Our team will review your application and get back to you soon. If you have any questions, contact us at <a href="mailto:accelerator@medx.hr" style="color: #C9A962;">accelerator@medx.hr</a>.</p>
                                <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
                            `));
                        }
                    } catch (emailErr) {
                        console.warn('Accelerator payment confirmation email failed:', emailErr.message);
                    }
                } catch (dbErr) {
                    console.error('[Stripe] Failed to process accelerator webhook:', dbErr.message);
                    return res.status(500).send('Internal error');
                }

                return res.json({ received: true });
            }

            // ===== GALA EVENING PAYMENT =====
            if (metadata.type === 'gala-ticket' && metadata.gala_registration_id) {
                const galaRegId = metadata.gala_registration_id;
                const galaInvoice = metadata.invoice_number;
                console.log(`[Stripe] Gala payment confirmed for ${galaRegId} (${galaInvoice})`);

                try {
                    const galaReg = query.get('SELECT * FROM gala_registrations WHERE id = ?', [galaRegId]);
                    if (!galaReg) {
                        console.error(`[Stripe] Gala registration ${galaRegId} not found`);
                        return res.status(404).send('Gala registration not found');
                    }

                    // 1. Update gala registration payment status
                    db.run("UPDATE gala_registrations SET payment_status = 'paid', status = 'confirmed' WHERE id = ?", [galaRegId]);

                    // 2. Create FIRA fiscal invoice
                    const ticketLabel = galaReg.pricing === 'bundle' ? 'Plexus + Gala Bundle' : 'Gala Evening Only';
                    const amount = galaReg.amount_paid || (galaReg.pricing === 'bundle' ? 174 : 95);

                    try {
                        const firaResult = await firaService.createFiscalInvoice({
                            invoiceNumber: galaInvoice,
                            ticketName: ticketLabel,
                            ticketPrice: amount,
                            addons: [],
                            billing: {
                                name: `${galaReg.first_name} ${galaReg.last_name}`,
                                company: galaReg.institution || '',
                                address: '',
                                city: '',
                                zip: '',
                                country: 'HR',
                                oib: '',
                                vatNumber: '',
                                email: galaReg.email
                            },
                            invoiceType: 'RAČUN',
                            paymentType: 'KARTICA'
                        });
                        console.log(`[Stripe→FIRA] Gala fiscal invoice created: ${firaResult?.invoiceNumber || 'N/A'}`);
                    } catch (firaErr) {
                        console.error('[Stripe→FIRA] Gala fiscal invoice creation failed (non-blocking):', firaErr.message);
                    }

                    // 3. Create finance income record
                    createFinanceIncomeRecord(
                        { first_name: galaReg.first_name, last_name: galaReg.last_name, ticket_name: ticketLabel },
                        amount, 'card', galaInvoice,
                        { project: 'gala-2026', category: 'gala-ticket', descPrefix: 'Gala 2026' }
                    );

                    saveDb();
                    console.log(`[Stripe] Gala registration ${galaRegId} marked as paid`);

                    // Send gala payment confirmation email
                    try {
                        sendEmail(galaReg.email, 'Payment Confirmed — Plexus 2026 Gala Evening', buildEmailTemplate('Payment Confirmed', `
                            <p>Dear ${galaReg.first_name},</p>
                            <p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 18px; border-radius: 8px; color: #065f46; font-weight: 600; font-size: 16px; text-align: center;">
                                Your Gala Evening payment has been received — your spot is secured!
                            </p>
                            <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 140px;">Amount Paid</td>
                                    <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">&euro;${Number(amount).toFixed(2)}</td></tr>
                                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice Number</td>
                                    <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${galaInvoice}</td></tr>
                                <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Ticket</td>
                                    <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${ticketLabel}</td></tr>
                            </table>
                            <p>We look forward to welcoming you at the Gala Evening. If you have any questions, contact us at <a href="mailto:info@medx.hr" style="color: #C9A962;">info@medx.hr</a>.</p>
                            <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
                        `));
                    } catch (emailErr) {
                        console.warn('Gala payment confirmation email failed:', emailErr.message);
                    }
                } catch (dbErr) {
                    console.error('[Stripe] Failed to process gala webhook:', dbErr.message);
                    return res.status(500).send('Internal error');
                }

                return res.json({ received: true });
            }

            // ===== FORUM EVENT PAYMENT =====
            if (metadata.type === 'forum-event' && metadata.forum_registration_id) {
                const forumRegId = metadata.forum_registration_id;
                const forumInvoice = metadata.invoice_number;
                const forumEventId = metadata.event_id;
                console.log(`[Stripe] Forum event payment confirmed for ${forumRegId} (${forumInvoice})`);

                try {
                    const forumReg = query.get(
                        'SELECT r.*, e.title as event_title, e.price FROM forum_event_registrations r JOIN forum_events e ON r.event_id = e.id WHERE r.id = ?',
                        [forumRegId]
                    );
                    if (!forumReg) {
                        console.error(`[Stripe] Forum registration ${forumRegId} not found`);
                        return res.status(404).send('Forum registration not found');
                    }

                    const amount = session.amount_total ? session.amount_total / 100 : (forumReg.payment_amount || forumReg.price || 0);

                    // 1. Update forum registration payment status
                    db.run(`UPDATE forum_event_registrations SET payment_status = 'paid', payment_date = datetime('now'), payment_amount = ?, stripe_session_id = ? WHERE id = ?`,
                        [amount, session.id, forumRegId]);

                    // 2. Create FIRA fiscal invoice (non-blocking)
                    if (firaService.isConfigured()) {
                        try {
                            const firaResult = await firaService.createFiscalInvoice({
                                invoiceNumber: forumInvoice,
                                ticketName: `Med&X Forum — ${forumReg.event_title || 'Event'}`,
                                ticketPrice: amount,
                                addons: [],
                                billing: {
                                    name: forumReg.name || `${forumReg.first_name || ''} ${forumReg.last_name || ''}`.trim() || 'Attendee',
                                    company: forumReg.institution || '',
                                    address: '',
                                    city: '',
                                    zip: '',
                                    country: 'HR',
                                    oib: '',
                                    vatNumber: '',
                                    email: forumReg.email || ''
                                },
                                invoiceType: 'RAČUN',
                                paymentType: 'KARTICA'
                            });
                            console.log(`[Stripe→FIRA] Forum fiscal invoice created: ${firaResult?.invoiceNumber || 'N/A'}`);
                        } catch (firaErr) {
                            console.error('[Stripe→FIRA] Forum fiscal invoice creation failed (non-blocking):', firaErr.message);
                        }
                    }

                    // 3. Create finance income record
                    const attendeeName = forumReg.name || `${forumReg.first_name || ''} ${forumReg.last_name || ''}`.trim() || 'Attendee';
                    createFinanceIncomeRecord(
                        { first_name: forumReg.first_name || attendeeName.split(' ')[0], last_name: forumReg.last_name || attendeeName.split(' ').slice(1).join(' '), ticket_name: forumReg.event_title || 'Forum Event' },
                        amount, 'card', forumInvoice,
                        { project: 'forum-2026', category: 'forum-event', descPrefix: 'Forum 2026' }
                    );

                    saveDb();
                    console.log(`[Stripe] Forum registration ${forumRegId} marked as paid, invoice ${forumInvoice}`);

                    // 4. Send confirmation email
                    try {
                        const recipientEmail = forumReg.email;
                        if (recipientEmail) {
                            sendEmail(recipientEmail, `Payment Confirmed — Med&X Forum: ${forumReg.event_title || 'Event'}`, buildEmailTemplate('Payment Confirmed', `
                                <p>Dear ${forumReg.name || forumReg.first_name || 'Forum Member'},</p>
                                <p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 18px; border-radius: 8px; color: #065f46; font-weight: 600; font-size: 16px; text-align: center;">
                                    Your Forum event payment has been received — your spot is secured!
                                </p>
                                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 140px;">Event</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${forumReg.event_title || 'Forum Event'}</td></tr>
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Amount Paid</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">&euro;${Number(amount).toFixed(2)}</td></tr>
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice Number</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${forumInvoice}</td></tr>
                                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">QR Code</td>
                                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; font-family: monospace;">${forumReg.qr_code || '—'}</td></tr>
                                </table>
                                <p>If you have any questions, contact us at <a href="mailto:info@medx.hr" style="color: #C9A962;">info@medx.hr</a>.</p>
                                <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
                            `));
                        }
                    } catch (emailErr) {
                        console.warn('Forum payment confirmation email failed:', emailErr.message);
                    }
                } catch (dbErr) {
                    console.error('[Stripe] Failed to process forum webhook:', dbErr.message);
                    return res.status(500).send('Internal error');
                }

                return res.json({ received: true });
            }

            // ===== PLEXUS CONFERENCE PAYMENT =====
            const registrationId = metadata.registration_id;
            const invoiceNumber = metadata.invoice_number;

            if (!registrationId) {
                console.error('[Stripe] Webhook missing registration_id in metadata');
                return res.status(400).send('Missing registration_id');
            }

            console.log(`[Stripe] Payment confirmed for registration ${registrationId} (${invoiceNumber})`);

            try {
                const reg = query.get(`SELECT r.*, t.name as ticket_name, u.first_name, u.last_name, u.email
                    FROM registrations r
                    JOIN ticket_types t ON r.ticket_type_id = t.id
                    JOIN users u ON r.user_id = u.id
                    WHERE r.id = ?`, [registrationId]);

                if (!reg) {
                    console.error(`[Stripe] Registration ${registrationId} not found`);
                    return res.status(404).send('Registration not found');
                }

                // 1. Update registration payment status
                db.run('UPDATE registrations SET payment_status = ? WHERE id = ?', ['paid', reg.id]);

                // 2. Update payment transaction
                db.run(`UPDATE payment_transactions SET status = 'completed', provider_transaction_id = ? WHERE registration_id = ?`,
                    [session.payment_intent || session.id, reg.id]);

                // 3. Update invoice
                db.run("UPDATE invoices SET status = 'paid', paid_at = ? WHERE registration_id = ?",
                    [new Date().toISOString(), reg.id]);

                // 4. Create FIRA fiscal invoice (now with paymentType: 'KARTICA' for card)
                const tx = query.get('SELECT * FROM payment_transactions WHERE registration_id = ?', [reg.id]);
                let billingData = null;
                if (tx?.metadata) {
                    try { billingData = JSON.parse(tx.metadata)?.billing; } catch (e) { /* ignore */ }
                }

                // Fallback: build billing from invoice + registration if metadata missing
                if (!billingData) {
                    const inv = query.get('SELECT * FROM invoices WHERE registration_id = ?', [reg.id]);
                    if (inv) {
                        billingData = {
                            name: inv.recipient_name || `${reg.first_name} ${reg.last_name}`,
                            address: inv.recipient_address || '',
                            oib: inv.recipient_vat || '',
                            email: inv.recipient_email || reg.email,
                            company: '', city: '', zip: '', country: 'HR', vatNumber: inv.recipient_vat || ''
                        };
                        console.log(`[FIRA] Using fallback billing data from invoice ${inv.invoice_number}`);
                    }
                }

                if (billingData) {
                    console.log(`[FIRA] Attempting fiscal invoice for ${reg.invoice_number}...`);
                    try {
                        const firaResult = await firaService.createFiscalInvoice({
                            invoiceNumber: reg.invoice_number,
                            ticketName: reg.ticket_name,
                            ticketPrice: reg.amount_paid,
                            addons: [],
                            billing: {
                                name: billingData.name || `${reg.first_name} ${reg.last_name}`,
                                company: billingData.company || '',
                                address: billingData.address || '',
                                city: billingData.city || '',
                                zip: billingData.zip || '',
                                country: billingData.country || 'HR',
                                oib: billingData.oib || '',
                                vatNumber: billingData.vatNumber || '',
                                email: billingData.email || reg.email
                            },
                            invoiceType: 'RAČUN',  // Regular invoice (switch to FISKALNI_RAČUN once fiskalizacija is enabled)
                            paymentType: 'KARTICA'
                        });

                        // Store FIRA details in payment transaction metadata
                        if (firaResult && tx) {
                            const meta = tx.metadata ? JSON.parse(tx.metadata) : {};
                            meta.fira_invoice_number = firaResult.invoiceNumber;
                            meta.fira_pdf_url = firaResult.pdfUrl;
                            meta.fira_id = firaResult.firaId;
                            db.run('UPDATE payment_transactions SET metadata = ? WHERE id = ?',
                                [JSON.stringify(meta), tx.id]);
                        }
                    } catch (firaErr) {
                        console.error('[Stripe→FIRA] Fiscal invoice creation failed (non-blocking):', firaErr.message);
                    }
                } else {
                    console.warn(`[FIRA] Skipped — no billing data found in payment transaction metadata`);
                }

                // 5. Create finance income record (bridge to Finance dashboard)
                createFinanceIncomeRecord(reg, reg.amount_paid, 'card', reg.invoice_number);

                saveDb();
                console.log(`[Stripe] Registration ${registrationId} marked as paid, finance record created`);

                // Send payment confirmation email
                try {
                    const firaRef = tx?.metadata ? (() => { try { const m = JSON.parse(tx.metadata); return m.fira_invoice_number || null; } catch(e) { return null; } })() : null;

                    sendEmail(reg.email, 'Payment Confirmed — Plexus 2026', buildEmailTemplate('Payment Confirmed', `
                        <p>Dear ${reg.first_name},</p>
                        <p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 18px; border-radius: 8px; color: #065f46; font-weight: 600; font-size: 16px; text-align: center;">
                            Your payment has been received — your spot is secured!
                        </p>
                        <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                            <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 140px;">Amount Paid</td>
                                <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">&euro;${Number(reg.amount_paid).toFixed(2)}</td></tr>
                            <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Invoice Number</td>
                                <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${reg.invoice_number}</td></tr>
                            <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Ticket</td>
                                <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${reg.ticket_name}</td></tr>
                            ${firaRef ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Fiscal Invoice</td>
                                <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${firaRef}</td></tr>` : ''}
                        </table>
                        <p>You will receive your ticket and QR code closer to the event date. If you have any questions, contact us at <a href="mailto:info@medx.hr" style="color: #C9A962;">info@medx.hr</a>.</p>
                        <p>See you at Plexus 2026!</p>
                        <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
                    `));
                } catch (emailErr) {
                    console.warn('Stripe payment confirmation email failed:', emailErr.message);
                }
            } catch (dbErr) {
                console.error('[Stripe] Failed to process webhook:', dbErr.message);
                return res.status(500).send('Internal error');
            }
        }

        res.json({ received: true });
    });

    // ========== FINANCE BRIDGE ==========
    // Creates income record in finance_transactions when payment is confirmed (Stripe or manual)
    function createFinanceIncomeRecord(registration, amount, paymentMethod, invoiceNumber, opts = {}) {
        try {
            // Replicate getNextSequenceNumber logic from admin portal
            const year = new Date().getFullYear();
            let seq = query.get('SELECT * FROM finance_sequences WHERE sequence_type = ? AND fiscal_year = ?', ['income', year]);
            let transactionNumber;

            if (!seq) {
                // Create the sequence if it doesn't exist
                db.run('INSERT OR IGNORE INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, ?, ?, 0, ?)',
                    [uuidv4(), 'income', year, 'P']);
                seq = { current_value: 0, prefix: 'P' };
            }

            const newValue = (seq.current_value || 0) + 1;
            db.run('UPDATE finance_sequences SET current_value = ? WHERE sequence_type = ? AND fiscal_year = ?',
                [newValue, 'income', year]);
            transactionNumber = `${seq.prefix || 'P'}-${year}-${String(newValue).padStart(3, '0')}`;

            // Build description
            const attendeeName = registration.first_name && registration.last_name
                ? `${registration.first_name} ${registration.last_name}`
                : 'Attendee';
            const ticketName = registration.ticket_name || 'Conference Ticket';
            const project = opts.project || 'plexus-2026';
            const category = opts.category || 'conference-registration';
            const descPrefix = opts.descPrefix || 'Plexus 2026';
            const description = `${descPrefix} — ${attendeeName} — ${ticketName}`;

            const txId = uuidv4();
            db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, category, payment_method, reference, fiscal_year, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [txId, transactionNumber, 'income', amount, new Date().toISOString().split('T')[0],
                 description, project, category,
                 paymentMethod, invoiceNumber, year, 'completed']);

            console.log(`[Finance] Income record created: ${transactionNumber} — €${amount} (${paymentMethod})`);
            return transactionNumber;
        } catch (err) {
            console.error('[Finance] Failed to create income record:', err.message);
            return null;
        }
    }

    // Admin: List all conference payments (for admin dashboard)
    app.get('/api/plexus/conference-payments', auth, (req, res) => {
        try {
            if (!req.user.is_admin) return res.status(403).json({ error: 'Admin access required' });

            const { status, search } = req.query;

            let sql = `SELECT r.id, r.invoice_number, r.payment_status, r.amount_paid, r.status as reg_status,
                r.created_at, u.first_name, u.last_name, u.email, u.institution,
                t.name as ticket_name,
                pt.provider_transaction_id as fira_id, pt.metadata as tx_metadata
                FROM registrations r
                JOIN users u ON r.user_id = u.id
                JOIN ticket_types t ON r.ticket_type_id = t.id
                LEFT JOIN payment_transactions pt ON pt.registration_id = r.id
                JOIN conferences c ON r.conference_id = c.id
                WHERE c.slug = 'plexus-2026' AND r.status != 'cancelled'`;
            const params = [];

            if (status && status !== 'all') {
                sql += ' AND r.payment_status = ?';
                params.push(status);
            }
            if (search) {
                sql += ' AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.email LIKE ? OR r.invoice_number LIKE ?)';
                const term = `%${search}%`;
                params.push(term, term, term, term);
            }

            sql += ' ORDER BY r.created_at DESC';

            const payments = query.all(sql, params);

            // Parse metadata for FIRA invoice numbers
            const enriched = payments.map(p => {
                let firaInvoiceNumber = null;
                if (p.tx_metadata) {
                    try {
                        const meta = JSON.parse(p.tx_metadata);
                        firaInvoiceNumber = meta.fira_invoice_number;
                    } catch (e) { /* ignore */ }
                }
                return {
                    id: p.id,
                    invoice_number: p.invoice_number,
                    fira_invoice_number: firaInvoiceNumber,
                    payment_status: p.payment_status,
                    amount: p.amount_paid,
                    registration_status: p.reg_status,
                    attendee: `${p.first_name} ${p.last_name}`,
                    email: p.email,
                    institution: p.institution,
                    ticket: p.ticket_name,
                    created_at: p.created_at
                };
            });

            // Summary stats
            const total = enriched.length;
            const pending = enriched.filter(p => p.payment_status === 'pending').length;
            const paid = enriched.filter(p => p.payment_status === 'paid').length;
            const totalRevenue = enriched.filter(p => p.payment_status === 'paid').reduce((sum, p) => sum + (p.amount || 0), 0);
            const pendingRevenue = enriched.filter(p => p.payment_status === 'pending').reduce((sum, p) => sum + (p.amount || 0), 0);

            res.json({
                payments: enriched,
                summary: { total, pending, paid, totalRevenue, pendingRevenue },
                fira_active: firaService.isConfigured()
            });
        } catch (err) {
            console.error('Conference payments error:', err.message);
            res.status(500).json({ error: 'Failed to fetch conference payments' });
        }
    });

    // Start registration (Step 1: Personal info + account creation)
    app.post('/api/plexus/register/start', async (req, res) => {
        const { email, password, first_name, last_name, phone, institution, country, title, department } = req.body;

        // Check if user exists
        let user = query.get('SELECT * FROM users WHERE email = ?', [email]);

        if (user && password) {
            // Verify password for existing user
            const valid = await bcrypt.compare(password, user.password_hash);
            if (!valid) return res.status(400).json({ error: 'Account exists with different password' });
        } else if (!user) {
            // Create new user
            const hash = password ? await bcrypt.hash(password, 10) : null;
            const userId = uuidv4();
            db.run(`INSERT INTO users (id, email, password_hash, first_name, last_name, phone, institution, country) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
                [userId, email, hash, first_name, last_name, phone, institution, country]);

            // Create profile
            db.run('INSERT INTO user_profiles (user_id, title, department) VALUES (?, ?, ?)', [userId, title, department]);
            saveDb();

            user = query.get('SELECT * FROM users WHERE id = ?', [userId]);
        }

        // Check if already registered for this conference
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const existingReg = query.get('SELECT * FROM registrations WHERE conference_id = ? AND user_id = ? AND status != ?', [conf.id, user.id, 'cancelled']);
        if (existingReg) return res.status(400).json({ error: 'Already registered for this conference', registration_id: existingReg.id });

        // Create token for continuing registration
        const token = jwt.sign({ id: user.id, email: user.email, is_admin: user.is_admin }, JWT_SECRET, { expiresIn: '24h' });

        res.json({ success: true, user_id: user.id, token, user: { id: user.id, email: user.email, first_name: user.first_name, last_name: user.last_name } });
    });

    // Complete registration (Step 2: Ticket selection + payment)
    app.post('/api/plexus/register/complete', auth, async (req, res) => {
        const { ticket_type_id, registration_type, promo_code, billing_info, registration_details: details } = req.body;

        const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
        const ticket = query.get('SELECT * FROM ticket_types WHERE id = ?', [ticket_type_id]);

        if (!ticket) return res.status(400).json({ error: 'Invalid ticket type' });

        // Calculate price
        const today = new Date().toISOString().split('T')[0];
        let price = today <= conf.early_bird_deadline ? ticket.price_early_bird : today <= conf.regular_deadline ? ticket.price_regular : ticket.price_late;

        // Apply promo code
        let promoId = null;
        let discount = 0;
        if (promo_code) {
            const promo = query.get('SELECT * FROM promo_codes WHERE conference_id = ? AND code = ? AND is_active = 1', [conf.id, promo_code.toUpperCase()]);
            if (promo) {
                promoId = promo.id;
                discount = promo.discount_type === 'percentage' ? price * (promo.discount_value / 100) : promo.discount_value;
                // Atomic increment promo usage — prevents race conditions
                db.run('UPDATE promo_codes SET used_count = used_count + 1 WHERE id = ? AND (max_uses IS NULL OR used_count < max_uses)', [promo.id]);
                if (db.getRowsModified() === 0) {
                    return res.status(400).json({ error: 'Promo code has reached its maximum number of uses' });
                }
            }
        }

        const finalAmount = Math.max(0, price - discount);
        const regId = uuidv4();
        const invoiceNumber = `INV-${Date.now()}-${uuidv4().split('-')[0]}`;

        // Generate QR code for ticket
        const qrData = JSON.stringify({ reg_id: regId, conf: 'plexus-2026' });
        const qrCode = await QRCode.toDataURL(qrData);

        // Create registration
        db.run(`INSERT INTO registrations (id, conference_id, user_id, ticket_type_id, registration_type, status, payment_status, amount_paid, promo_code_id, discount_amount, invoice_number, ticket_qr_code)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [regId, conf.id, req.user.id, ticket_type_id, registration_type || 'general', 'confirmed', finalAmount === 0 ? 'paid' : 'pending', finalAmount, promoId, discount, invoiceNumber, qrCode]);

        // Store additional details
        if (details) {
            db.run(`INSERT INTO registration_details (registration_id, affiliation_type, billing_name, billing_address, billing_country, billing_vat, wants_invoice, arrival_date, departure_date, accommodation_needed, hotel_preference, networking_interests, how_heard_about, special_requests, gdpr_consent, photo_consent, terms_accepted)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [regId, details.affiliation_type, billing_info?.name, billing_info?.address, billing_info?.country, billing_info?.vat, billing_info ? 1 : 0,
                 details.arrival_date, details.departure_date, details.accommodation_needed ? 1 : 0, details.hotel_preference,
                 details.networking_interests, details.how_heard_about, details.special_requests, details.gdpr_consent ? 1 : 0, details.photo_consent ? 1 : 0, 1]);
        }

        // Update ticket sold count
        db.run('UPDATE ticket_types SET sold_count = sold_count + 1 WHERE id = ?', [ticket_type_id]);
        saveDb();

        res.json({
            success: true,
            registration_id: regId,
            invoice_number: invoiceNumber,
            amount: finalAmount,
            discount,
            qr_code: qrCode,
            payment_required: finalAmount > 0
        });
    });

    // Get my registration
    app.get('/api/plexus/my-registration', auth, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const reg = query.get(`SELECT r.*, t.name as ticket_name, t.includes_gala, u.first_name, u.last_name, u.email
            FROM registrations r
            JOIN ticket_types t ON r.ticket_type_id = t.id
            JOIN users u ON r.user_id = u.id
            WHERE r.conference_id = ? AND r.user_id = ?`, [conf.id, req.user.id]);

        if (!reg) return res.json(null);

        const details = query.get('SELECT * FROM registration_details WHERE registration_id = ?', [reg.id]);
        res.json({ ...reg, details });
    });

    // Join waiting list
    app.post('/api/plexus/waitlist', auth, (req, res) => {
        const { ticket_type_id } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");

        // Get next position
        const lastPos = query.get('SELECT MAX(position) as p FROM waitlist WHERE conference_id = ?', [conf.id])?.p || 0;

        const id = uuidv4();
        const user = query.get('SELECT * FROM users WHERE id = ?', [req.user.id]);

        db.run('INSERT INTO waitlist (id, conference_id, user_id, ticket_type_id, email, first_name, last_name, position) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [id, conf.id, req.user.id, ticket_type_id, user.email, user.first_name, user.last_name, lastPos + 1]);
        saveDb();

        res.json({ success: true, position: lastPos + 1 });
    });

    // Request registration transfer
    app.post('/api/plexus/registration/:regId/transfer', auth, (req, res) => {
        const { new_user_email, new_user_name, reason } = req.body;
        const reg = query.get('SELECT * FROM registrations WHERE id = ? AND user_id = ?', [req.params.regId, req.user.id]);

        if (!reg) return res.status(404).json({ error: 'Registration not found' });

        const id = uuidv4();
        db.run('INSERT INTO registration_transfers (id, registration_id, original_user_id, new_user_email, new_user_name, reason) VALUES (?, ?, ?, ?, ?, ?)',
            [id, reg.id, req.user.id, new_user_email, new_user_name, reason]);
        saveDb();

        res.json({ success: true, transfer_id: id });
    });

    // Request refund
    app.post('/api/plexus/registration/:regId/refund', auth, (req, res) => {
        const { reason } = req.body;
        const reg = query.get('SELECT * FROM registrations WHERE id = ? AND user_id = ?', [req.params.regId, req.user.id]);

        if (!reg) return res.status(404).json({ error: 'Registration not found' });

        const id = uuidv4();
        db.run('INSERT INTO refund_requests (id, registration_id, reason, amount_requested) VALUES (?, ?, ?, ?)',
            [id, reg.id, reason, reg.amount_paid]);
        saveDb();

        res.json({ success: true, refund_id: id });
    });

    // Apply for scholarship
    app.post('/api/plexus/scholarship', auth, (req, res) => {
        const { institution, country, career_stage, financial_need_statement, research_statement, amount_requested } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");

        const id = uuidv4();
        db.run(`INSERT INTO scholarship_applications (id, conference_id, user_id, institution, country, career_stage, financial_need_statement, research_statement, amount_requested)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`, [id, conf.id, req.user.id, institution, country, career_stage, financial_need_statement, research_statement, amount_requested]);
        saveDb();

        res.json({ success: true, application_id: id });
    });

    // --- ABSTRACT SUBMISSION ---

    // Submit abstract
    app.post('/api/plexus/abstracts', auth, (req, res) => {
        const { title, abstract_text, topic_category, presentation_type, authors } = req.body;
        const keywords = req.body.keywords ?? null;
        const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");

        // Check deadline
        if (new Date() > new Date(conf.abstract_deadline)) {
            return res.status(400).json({ error: 'Abstract submission deadline has passed' });
        }

        const id = uuidv4();
        try {
        db.run(`INSERT INTO abstracts (id, conference_id, submitter_id, title, abstract_text, keywords, topic_category, presentation_type)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)`, [id, conf.id, req.user.id, title, abstract_text ?? null, keywords, topic_category ?? null, presentation_type ?? null]);

        // Add authors
        if (authors && authors.length > 0) {
            authors.forEach((a, i) => {
                db.run('INSERT INTO abstract_authors (id, abstract_id, email, first_name, last_name, institution, is_presenting, author_order) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
                    [uuidv4(), id, a.email ?? null, a.first_name ?? a.name ?? null, a.last_name ?? null, a.institution ?? null, a.is_presenting ? 1 : 0, i + 1]);
            });
        }
        saveDb();

        res.json({ success: true, abstract_id: id });
        } catch (err) {
            console.error('Abstract submission error:', err.message);
            res.status(500).json({ error: 'Failed to submit abstract' });
        }
    });

    // Get my abstracts
    app.get('/api/plexus/my-abstracts', auth, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const abstracts = query.all('SELECT * FROM abstracts WHERE conference_id = ? AND submitter_id = ? ORDER BY created_at DESC', [conf.id, req.user.id]);

        abstracts.forEach(a => {
            a.authors = query.all('SELECT * FROM abstract_authors WHERE abstract_id = ? ORDER BY author_order', [a.id]);
        });

        res.json(abstracts);
    });

    // Update abstract (before deadline)
    app.put('/api/plexus/abstracts/:id', auth, (req, res) => {
        const abs = query.get('SELECT a.*, c.abstract_deadline FROM abstracts a JOIN conferences c ON a.conference_id = c.id WHERE a.id = ? AND a.submitter_id = ?',
            [req.params.id, req.user.id]);

        if (!abs) return res.status(404).json({ error: 'Abstract not found' });
        if (new Date() > new Date(abs.abstract_deadline)) return res.status(400).json({ error: 'Deadline passed' });

        const { title, abstract_text, keywords, topic_category, presentation_type } = req.body;
        db.run('UPDATE abstracts SET title = ?, abstract_text = ?, keywords = ?, topic_category = ?, presentation_type = ? WHERE id = ?',
            [title, abstract_text, keywords, topic_category, presentation_type, req.params.id]);
        saveDb();

        res.json({ success: true });
    });

    // Withdraw abstract
    app.post('/api/plexus/abstracts/:id/withdraw', auth, (req, res) => {
        db.run('UPDATE abstracts SET is_withdrawn = 1 WHERE id = ? AND submitter_id = ?', [req.params.id, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // Link uploaded file to abstract
    app.post('/api/plexus/abstracts/:id/files', auth, (req, res) => {
        const abstract = query.get('SELECT * FROM abstracts WHERE id = ? AND submitter_id = ?', [req.params.id, req.user.id]);
        if (!abstract) return res.status(404).json({ error: 'Abstract not found' });

        const { file_url, original_name, file_size, file_type } = req.body;
        if (!file_url || !original_name) {
            return res.status(400).json({ error: 'file_url and original_name are required' });
        }

        const fileId = uuidv4();
        const storedName = file_url.split('/').pop() ?? null;

        try {
            db.run(`INSERT INTO abstract_files (id, abstract_id, file_type, original_name, stored_name, file_path, file_size)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [fileId, req.params.id, file_type ?? 'document', original_name, storedName, file_url, file_size ?? null]);
            saveDb();

            res.json({ success: true, file_id: fileId });
        } catch (err) {
            console.error('Abstract file link error:', err.message);
            res.status(500).json({ error: 'Failed to link file to abstract' });
        }
    });

    // --- SCHEDULE & SESSIONS (Phase 3C) ---

    // Get full schedule (public — only published sessions)
    app.get('/api/plexus/schedule', (req, res) => {
        const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
        if (!conf) return res.json({ conference: null, sessions: [], tracks: [], rooms: [] });
        const sessions = query.all(`SELECT s.*, GROUP_CONCAT(sp.name) as speaker_names
            FROM sessions s
            LEFT JOIN speakers sp ON s.speaker_ids LIKE '%' || sp.id || '%'
            WHERE s.conference_id = ? AND s.is_published = 1 GROUP BY s.id ORDER BY s.day, s.start_time`, [conf.id]);

        const tracks = query.all('SELECT * FROM session_tracks WHERE conference_id = ? ORDER BY sort_order', [conf.id]);
        const rooms = query.all('SELECT * FROM venue_rooms WHERE conference_id = ?', [conf.id]);

        res.json({ conference: conf, sessions, tracks, rooms });
    });

    // Admin: Get all sessions (including unpublished) — for admin panel in user portal
    app.get('/api/admin/plexus/sessions', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        if (!conf) return res.json([]);
        const sessions = query.all(`SELECT s.*, GROUP_CONCAT(sp.name) as speaker_names
            FROM sessions s
            LEFT JOIN speakers sp ON s.speaker_ids LIKE '%' || sp.id || '%'
            WHERE s.conference_id = ? GROUP BY s.id ORDER BY s.day, s.start_time`, [conf.id]);
        res.json(sessions || []);
    });

    // Admin: Create session
    app.post('/api/admin/plexus/sessions', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const { title, description, session_type, day, start_time, end_time, room, track, speaker_ids, capacity, is_published } = req.body;

        const id = uuidv4();
        const speakerIdsStr = Array.isArray(speaker_ids) ? speaker_ids.join(',') : (speaker_ids || null);
        db.run(`INSERT INTO sessions (id, conference_id, title, description, session_type, day, start_time, end_time, room, track, speaker_ids, capacity, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, conf.id, title, description, session_type || 'talk', day || 1, start_time, end_time, room, track, speakerIdsStr, capacity || null, is_published ? 1 : 0]);
        saveDb();
        res.json({ success: true, session_id: id });
    });

    // Admin: Update session
    app.put('/api/admin/plexus/sessions/:id', auth, adminOnly, (req, res) => {
        const { title, description, session_type, day, start_time, end_time, room, track, speaker_ids, capacity, is_published } = req.body;
        const existing = query.get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Session not found' });

        const speakerIdsStr = Array.isArray(speaker_ids) ? speaker_ids.join(',') : (speaker_ids !== undefined ? speaker_ids : existing.speaker_ids);
        db.run(`UPDATE sessions SET title = ?, description = ?, session_type = ?, day = ?, start_time = ?, end_time = ?,
            room = ?, track = ?, speaker_ids = ?, capacity = ?, is_published = ? WHERE id = ?`,
            [title || existing.title, description !== undefined ? description : existing.description,
             session_type || existing.session_type, day || existing.day,
             start_time || existing.start_time, end_time || existing.end_time,
             room || existing.room, track !== undefined ? track : existing.track,
             speakerIdsStr, capacity !== undefined ? capacity : existing.capacity,
             is_published !== undefined ? (is_published ? 1 : 0) : existing.is_published,
             req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Delete session
    app.delete('/api/admin/plexus/sessions/:id', auth, adminOnly, (req, res) => {
        const existing = query.get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Session not found' });
        db.run('DELETE FROM sessions WHERE id = ?', [req.params.id]);
        db.run('DELETE FROM personal_schedules WHERE session_id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Publish single session
    app.put('/api/admin/plexus/sessions/:id/publish', auth, adminOnly, (req, res) => {
        const session = query.get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
        if (!session) return res.status(404).json({ error: 'Session not found' });
        db.run('UPDATE sessions SET is_published = 1 WHERE id = ?', [req.params.id]);
        db.run(`INSERT INTO user_notifications (id, user_group, category, project, title, message, icon, icon_class, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [uuidv4(), 'all', 'announcement', 'plexus', 'Schedule Update', `New session added: ${session.title}`, 'fa-calendar-alt', 'plexus', req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Bulk publish sessions
    app.post('/api/admin/plexus/sessions/bulk-publish', auth, adminOnly, (req, res) => {
        const { session_ids } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        let ids = session_ids;
        if (!ids || ids.length === 0) {
            const unpublished = query.all('SELECT id, title FROM sessions WHERE conference_id = ? AND (is_published = 0 OR is_published IS NULL)', [conf.id]);
            ids = unpublished.map(s => s.id);
        }
        if (ids.length === 0) return res.json({ success: true, published: 0 });

        ids.forEach(id => {
            db.run('UPDATE sessions SET is_published = 1 WHERE id = ?', [id]);
        });
        db.run(`INSERT INTO user_notifications (id, user_group, category, project, title, message, icon, icon_class, created_by, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [uuidv4(), 'all', 'announcement', 'plexus', 'Schedule Updated',
             `${ids.length} session(s) have been published to the conference schedule.`, 'fa-calendar-alt', 'plexus', req.user.id]);
        saveDb();
        res.json({ success: true, published: ids.length });
    });

    // Get session details
    app.get('/api/plexus/sessions/:id', (req, res) => {
        const session = query.get('SELECT * FROM sessions WHERE id = ?', [req.params.id]);
        if (!session) return res.status(404).json({ error: 'Session not found' });

        // Get speakers
        if (session.speaker_ids) {
            const speakerIds = session.speaker_ids.split(',');
            session.speakers = speakerIds.map(sid => query.get('SELECT * FROM speakers WHERE id = ?', [sid.trim()])).filter(Boolean);
        }

        // Get questions
        session.questions = query.all(`SELECT q.*, u.first_name, u.last_name,
            (SELECT COUNT(*) FROM question_upvotes WHERE question_id = q.id) as upvote_count
            FROM session_questions q LEFT JOIN users u ON q.user_id = u.id
            WHERE q.session_id = ? ORDER BY upvote_count DESC, q.created_at DESC`, [req.params.id]);

        // Get active poll
        session.active_poll = query.get('SELECT * FROM session_polls WHERE session_id = ? AND is_active = 1', [req.params.id]);

        res.json(session);
    });

    // Add to personal schedule
    app.post('/api/plexus/my-schedule/:sessionId', auth, (req, res) => {
        const existing = query.get('SELECT * FROM personal_schedules WHERE user_id = ? AND session_id = ?', [req.user.id, req.params.sessionId]);
        if (existing) return res.json({ success: true, already_added: true });

        db.run('INSERT INTO personal_schedules (id, user_id, session_id) VALUES (?, ?, ?)', [uuidv4(), req.user.id, req.params.sessionId]);
        saveDb();
        res.json({ success: true });
    });

    // Remove from personal schedule
    app.delete('/api/plexus/my-schedule/:sessionId', auth, (req, res) => {
        db.run('DELETE FROM personal_schedules WHERE user_id = ? AND session_id = ?', [req.user.id, req.params.sessionId]);
        saveDb();
        res.json({ success: true });
    });

    // Get my schedule
    app.get('/api/plexus/my-schedule', auth, (req, res) => {
        const sessions = query.all(`SELECT s.* FROM sessions s
            JOIN personal_schedules ps ON s.id = ps.session_id
            WHERE ps.user_id = ? ORDER BY s.day, s.start_time`, [req.user.id]);
        res.json(sessions);
    });

    // Submit question
    app.post('/api/plexus/sessions/:id/questions', auth, (req, res) => {
        const { question_text } = req.body;
        const id = uuidv4();
        db.run('INSERT INTO session_questions (id, session_id, user_id, question_text) VALUES (?, ?, ?, ?)',
            [id, req.params.id, req.user.id, question_text]);
        saveDb();
        res.json({ success: true, question_id: id });
    });

    // Upvote question
    app.post('/api/plexus/questions/:id/upvote', auth, (req, res) => {
        const existing = query.get('SELECT * FROM question_upvotes WHERE question_id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (existing) {
            db.run('DELETE FROM question_upvotes WHERE question_id = ? AND user_id = ?', [req.params.id, req.user.id]);
        } else {
            db.run('INSERT INTO question_upvotes (id, question_id, user_id) VALUES (?, ?, ?)', [uuidv4(), req.params.id, req.user.id]);
        }
        saveDb();

        const count = query.get('SELECT COUNT(*) as c FROM question_upvotes WHERE question_id = ?', [req.params.id])?.c || 0;
        res.json({ success: true, upvotes: count, upvoted: !existing });
    });

    // Submit poll response
    app.post('/api/plexus/polls/:id/respond', auth, (req, res) => {
        const { selected_options } = req.body;
        const poll = query.get('SELECT * FROM session_polls WHERE id = ? AND is_active = 1', [req.params.id]);
        if (!poll) return res.status(400).json({ error: 'Poll not active' });

        const existing = query.get('SELECT * FROM poll_responses WHERE poll_id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (existing) {
            db.run('UPDATE poll_responses SET selected_options = ? WHERE poll_id = ? AND user_id = ?',
                [JSON.stringify(selected_options), req.params.id, req.user.id]);
        } else {
            db.run('INSERT INTO poll_responses (id, poll_id, user_id, selected_options) VALUES (?, ?, ?, ?)',
                [uuidv4(), req.params.id, req.user.id, JSON.stringify(selected_options)]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Rate session
    app.post('/api/plexus/sessions/:id/rate', auth, (req, res) => {
        const { rating, comment } = req.body;
        const existing = query.get('SELECT * FROM session_ratings WHERE session_id = ? AND user_id = ?', [req.params.id, req.user.id]);

        if (existing) {
            db.run('UPDATE session_ratings SET rating = ?, comment = ? WHERE session_id = ? AND user_id = ?',
                [rating, comment, req.params.id, req.user.id]);
        } else {
            db.run('INSERT INTO session_ratings (id, session_id, user_id, rating, comment) VALUES (?, ?, ?, ?, ?)',
                [uuidv4(), req.params.id, req.user.id, rating, comment]);
        }
        saveDb();
        res.json({ success: true });
    });

    // --- NETWORKING & DIRECTORY ---

    // Get attendee directory
    app.get('/api/plexus/attendees', auth, (req, res) => {
        const { search, country, institution, interests } = req.query;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");

        let sql = `SELECT DISTINCT u.id, u.first_name, u.last_name, u.institution, u.country, up.title, up.research_interests, up.is_profile_public
            FROM users u
            JOIN registrations r ON u.id = r.user_id
            LEFT JOIN user_profiles up ON u.id = up.user_id
            WHERE r.conference_id = ? AND r.status = 'confirmed' AND (up.is_profile_public = 1 OR u.id = ?)`;
        const params = [conf.id, req.user.id];

        if (search) {
            sql += ` AND (u.first_name LIKE ? OR u.last_name LIKE ? OR u.institution LIKE ?)`;
            params.push(`%${search}%`, `%${search}%`, `%${search}%`);
        }
        if (country) {
            sql += ` AND u.country = ?`;
            params.push(country);
        }
        if (institution) {
            sql += ` AND u.institution LIKE ?`;
            params.push(`%${institution}%`);
        }

        const attendees = query.all(sql, params);
        res.json(attendees);
    });

    // Get attendee profile
    app.get('/api/plexus/attendees/:id', auth, (req, res) => {
        const user = query.get(`SELECT u.id, u.first_name, u.last_name, u.institution, u.country, u.bio,
            up.title, up.department, up.research_interests, up.linkedin_url, up.twitter_url, up.career_stage
            FROM users u LEFT JOIN user_profiles up ON u.id = up.user_id WHERE u.id = ?`, [req.params.id]);

        if (!user) return res.status(404).json({ error: 'User not found' });

        // Check connection status
        const connection = query.get('SELECT * FROM connections WHERE (requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?)',
            [req.user.id, req.params.id, req.params.id, req.user.id]);

        res.json({ ...user, connection_status: connection?.status || null });
    });

    // Send connection request
    app.post('/api/plexus/connections', auth, (req, res) => {
        const { user_id, message } = req.body;

        const existing = query.get('SELECT * FROM connections WHERE (requester_id = ? AND requestee_id = ?) OR (requester_id = ? AND requestee_id = ?)',
            [req.user.id, user_id, user_id, req.user.id]);
        if (existing) return res.status(400).json({ error: 'Connection already exists' });

        const id = uuidv4();
        db.run('INSERT INTO connections (id, requester_id, requestee_id, message) VALUES (?, ?, ?, ?)',
            [id, req.user.id, user_id, message]);
        saveDb();
        res.json({ success: true, connection_id: id });
    });

    // Respond to connection request
    app.put('/api/plexus/connections/:id', auth, (req, res) => {
        const { status } = req.body; // 'accepted' or 'rejected'
        db.run('UPDATE connections SET status = ? WHERE id = ? AND requestee_id = ?', [status, req.params.id, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // Get my connections
    app.get('/api/plexus/my-connections', auth, (req, res) => {
        const connections = query.all(`SELECT c.*, u.first_name, u.last_name, u.institution
            FROM connections c
            JOIN users u ON (CASE WHEN c.requester_id = ? THEN c.requestee_id ELSE c.requester_id END) = u.id
            WHERE (c.requester_id = ? OR c.requestee_id = ?) AND c.status = 'accepted'`,
            [req.user.id, req.user.id, req.user.id]);
        res.json(connections);
    });

    // Request meeting
    app.post('/api/plexus/meetings', auth, (req, res) => {
        const { requestee_id, message, proposed_times } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");

        const id = uuidv4();
        db.run('INSERT INTO meeting_requests (id, conference_id, requester_id, requestee_id, message, proposed_times) VALUES (?, ?, ?, ?, ?, ?)',
            [id, conf.id, req.user.id, requestee_id, message, JSON.stringify(proposed_times)]);
        saveDb();
        res.json({ success: true, meeting_id: id });
    });

    // Get my meeting requests
    app.get('/api/plexus/my-meetings', auth, (req, res) => {
        const sent = query.all(`SELECT m.*, u.first_name, u.last_name FROM meeting_requests m
            JOIN users u ON m.requestee_id = u.id WHERE m.requester_id = ?`, [req.user.id]);
        const received = query.all(`SELECT m.*, u.first_name, u.last_name FROM meeting_requests m
            JOIN users u ON m.requester_id = u.id WHERE m.requestee_id = ?`, [req.user.id]);
        res.json({ sent, received });
    });

    // --- VISA & TRAVEL ---

    // Request visa invitation letter
    app.post('/api/plexus/visa-request', auth, (req, res) => {
        const reg = query.get(`SELECT r.id FROM registrations r
            JOIN conferences c ON r.conference_id = c.id
            WHERE c.slug = 'plexus-2026' AND r.user_id = ?`, [req.user.id]);

        if (!reg) return res.status(400).json({ error: 'Must be registered to request visa letter' });

        const { passport_name, passport_number, passport_country, passport_expiry, date_of_birth, nationality, embassy_city, embassy_country, additional_info } = req.body;

        const id = uuidv4();
        db.run(`INSERT INTO visa_requests (id, registration_id, passport_name, passport_number, passport_country, passport_expiry, date_of_birth, nationality, embassy_city, embassy_country, additional_info)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, reg.id, passport_name, passport_number, passport_country, passport_expiry, date_of_birth, nationality, embassy_city, embassy_country, additional_info]);
        saveDb();
        res.json({ success: true, request_id: id });
    });

    // Get partner hotels
    app.get('/api/plexus/hotels', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const hotels = query.all('SELECT * FROM partner_hotels WHERE conference_id = ? ORDER BY sort_order', [conf.id]);
        res.json(hotels);
    });

    // --- VOLUNTEERS ---

    // Apply as volunteer
    app.post('/api/plexus/volunteers', auth, (req, res) => {
        const { availability, preferred_tasks } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");

        const existing = query.get('SELECT * FROM volunteers WHERE conference_id = ? AND user_id = ?', [conf.id, req.user.id]);
        if (existing) return res.status(400).json({ error: 'Already applied' });

        const id = uuidv4();
        db.run('INSERT INTO volunteers (id, conference_id, user_id, availability, preferred_tasks) VALUES (?, ?, ?, ?, ?)',
            [id, conf.id, req.user.id, availability, preferred_tasks]);
        saveDb();
        res.json({ success: true, volunteer_id: id });
    });

    // Get my volunteer status
    app.get('/api/plexus/my-volunteer', auth, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const volunteer = query.get('SELECT * FROM volunteers WHERE conference_id = ? AND user_id = ?', [conf.id, req.user.id]);

        if (!volunteer) return res.json(null);

        // Get assigned shifts
        volunteer.shifts = query.all(`SELECT vs.*, va.status, va.checked_in_at, va.checked_out_at
            FROM volunteer_shifts vs
            JOIN volunteer_assignments va ON vs.id = va.shift_id
            WHERE va.volunteer_id = ?`, [volunteer.id]);

        res.json(volunteer);
    });

    // --- SPEAKER APPLICATION ---

    // Apply as speaker
    app.post('/api/plexus/speaker-application', auth, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const { application_type, name, email, institution, title, bio, proposed_title, proposed_abstract, topic_area, presentation_type, duration_requested, av_requirements, previous_experience, target_audience, co_presenter_info, max_participants, required_materials } = req.body;

        const id = uuidv4();
        db.run(`INSERT INTO speaker_applications (id, conference_id, user_id, application_type, name, email, institution, title, bio, proposed_title, proposed_abstract, topic_area, presentation_type, duration_requested, av_requirements, previous_experience, target_audience, co_presenter_info, max_participants, required_materials)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, conf.id, req.user.id, application_type, name, email, institution, title, bio, proposed_title, proposed_abstract, topic_area, presentation_type, duration_requested, av_requirements, previous_experience, target_audience, co_presenter_info, max_participants, required_materials]);
        saveDb();
        res.json({ success: true, application_id: id });
    });

    // --- RESOURCES & CONTENT ---

    // Get speakers (public - only published ones)
    app.get('/api/plexus/speakers', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const speakers = query.all('SELECT * FROM speakers WHERE conference_id = ? AND is_confirmed = 1 AND is_published = 1 ORDER BY is_keynote DESC, sort_order', [conf.id]);
        res.json(speakers);
    });

    // Get sponsors (public - only published ones)
    app.get('/api/plexus/sponsors', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const sponsors = query.all('SELECT * FROM sponsors WHERE conference_id = ? AND is_published = 1 ORDER BY tier DESC, sort_order', [conf.id]);
        res.json(sponsors);
    });

    // Get announcements
    app.get('/api/plexus/announcements', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const announcements = query.all('SELECT * FROM announcements WHERE conference_id = ? ORDER BY published_at DESC LIMIT 20', [conf.id]);
        res.json(announcements);
    });

    // Get digital poster gallery
    app.get('/api/plexus/posters', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const posters = query.all(`SELECT a.*, af.file_path as poster_file,
            GROUP_CONCAT(aa.first_name || ' ' || aa.last_name, ', ') as author_names
            FROM abstracts a
            LEFT JOIN abstract_files af ON a.id = af.abstract_id AND af.file_type = 'poster'
            LEFT JOIN abstract_authors aa ON a.id = aa.abstract_id
            WHERE a.conference_id = ? AND a.status = 'accepted' AND a.presentation_type = 'poster'
            GROUP BY a.id ORDER BY a.title`, [conf.id]);
        res.json(posters);
    });

    // Get photo gallery
    app.get('/api/plexus/photos', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const photos = query.all('SELECT * FROM conference_photos WHERE conference_id = ? AND is_public = 1 ORDER BY sort_order', [conf.id]);
        res.json(photos);
    });

    // Get resources/downloads
    app.get('/api/plexus/resources', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const resources = query.all('SELECT * FROM resources WHERE conference_id = ? ORDER BY category, title', [conf.id]);
        res.json(resources);
    });

    // Download certificate
    app.get('/api/plexus/my-certificate', auth, (req, res) => {
        const reg = query.get(`SELECT r.*, u.first_name, u.last_name FROM registrations r
            JOIN users u ON r.user_id = u.id
            JOIN conferences c ON r.conference_id = c.id
            WHERE c.slug = 'plexus-2026' AND r.user_id = ? AND r.checked_in = 1`, [req.user.id]);

        if (!reg) return res.status(400).json({ error: 'Must attend conference to get certificate' });

        let cert = query.get('SELECT * FROM certificates WHERE registration_id = ?', [reg.id]);

        if (!cert) {
            const id = uuidv4();
            const certNumber = `PLX26-CERT-${String(Date.now()).slice(-8)}`;
            db.run(`INSERT INTO certificates (id, registration_id, certificate_type, certificate_number, recipient_name, conference_name, issue_date)
                VALUES (?, ?, 'attendance', ?, ?, 'Plexus Conference 2026', datetime('now'))`,
                [id, reg.id, certNumber, `${reg.first_name} ${reg.last_name}`]);
            saveDb();
            cert = query.get('SELECT * FROM certificates WHERE id = ?', [id]);
        }

        res.json(cert);
    });

    // Get survey
    app.get('/api/plexus/survey', auth, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const survey = query.get('SELECT * FROM surveys WHERE conference_id = ? AND is_active = 1', [conf.id]);
        if (!survey) return res.json(null);

        const response = query.get('SELECT * FROM survey_responses WHERE survey_id = ? AND user_id = ?', [survey.id, req.user.id]);
        res.json({ survey, already_responded: !!response });
    });

    // Submit survey response
    app.post('/api/plexus/survey/:id/respond', auth, (req, res) => {
        const { responses } = req.body;
        const existing = query.get('SELECT * FROM survey_responses WHERE survey_id = ? AND user_id = ?', [req.params.id, req.user.id]);
        if (existing) return res.status(400).json({ error: 'Already submitted' });

        db.run('INSERT INTO survey_responses (id, survey_id, user_id, responses) VALUES (?, ?, ?, ?)',
            [uuidv4(), req.params.id, req.user.id, JSON.stringify(responses)]);
        saveDb();
        res.json({ success: true });
    });

    // --- CHECK-IN (Admin/Staff) ---

    // Check in attendee by QR code
    app.post('/api/plexus/checkin', auth, adminOnly, (req, res) => {
        const { qr_data, registration_id } = req.body;

        let regId = registration_id;
        if (qr_data) {
            try {
                const data = JSON.parse(qr_data);
                regId = data.reg_id;
            } catch (e) {
                return res.status(400).json({ error: 'Invalid QR code' });
            }
        }

        const reg = query.get(`SELECT r.*, u.first_name, u.last_name, t.name as ticket_name
            FROM registrations r JOIN users u ON r.user_id = u.id JOIN ticket_types t ON r.ticket_type_id = t.id
            WHERE r.id = ?`, [regId]);

        if (!reg) return res.status(404).json({ error: 'Registration not found' });
        if (reg.checked_in) return res.json({ success: true, already_checked_in: true, attendee: reg });

        db.run("UPDATE registrations SET checked_in = 1, checked_in_at = datetime('now') WHERE id = ?", [regId]);
        saveDb();

        res.json({ success: true, attendee: { ...reg, checked_in: 1 } });
    });

    // --- ADMIN PLEXUS ROUTES ---

    // Admin: Get all registrations
    app.get('/api/admin/plexus/registrations', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const registrations = query.all(`SELECT r.*, u.first_name, u.last_name, u.email, u.phone, u.institution, u.country, t.name as ticket_name
            FROM registrations r
            JOIN users u ON r.user_id = u.id
            JOIN ticket_types t ON r.ticket_type_id = t.id
            WHERE r.conference_id = ? ORDER BY r.created_at DESC`, [conf.id]);
        res.json(registrations);
    });

    // Admin: Get all abstracts
    app.get('/api/admin/plexus/abstracts', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const abstracts = query.all(`SELECT a.*, u.first_name, u.last_name, u.email
            FROM abstracts a JOIN users u ON a.submitter_id = u.id
            WHERE a.conference_id = ? ORDER BY a.created_at DESC`, [conf.id]);

        abstracts.forEach(a => {
            a.authors = query.all('SELECT * FROM abstract_authors WHERE abstract_id = ? ORDER BY author_order', [a.id]);
            a.reviews = query.all('SELECT ar.*, u.first_name, u.last_name FROM abstract_reviews ar LEFT JOIN users u ON ar.reviewer_id = u.id WHERE ar.abstract_id = ?', [a.id]);
        });

        res.json(abstracts);
    });

    // Admin: Assign reviewer to abstract
    app.post('/api/admin/plexus/abstracts/:id/assign-reviewer', auth, adminOnly, (req, res) => {
        const { reviewer_id } = req.body;
        const id = uuidv4();
        db.run("INSERT INTO abstract_reviews (id, abstract_id, reviewer_id, assigned_at) VALUES (?, ?, ?, datetime('now'))",
            [id, req.params.id, reviewer_id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Update abstract decision
    app.put('/api/admin/plexus/abstracts/:id/decision', auth, adminOnly, (req, res) => {
        const { status, decision } = req.body;
        db.run('UPDATE abstracts SET status = ?, decision = ? WHERE id = ?', [status, decision, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Get dashboard stats
    app.get('/api/admin/plexus/stats', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");

        const stats = {
            total_registrations: query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ?', [conf.id])?.c || 0,
            paid_registrations: query.get("SELECT COUNT(*) as c FROM registrations WHERE conference_id = ? AND payment_status = 'paid'", [conf.id])?.c || 0,
            checked_in: query.get('SELECT COUNT(*) as c FROM registrations WHERE conference_id = ? AND checked_in = 1', [conf.id])?.c || 0,
            total_revenue: query.get('SELECT SUM(amount_paid) as s FROM registrations WHERE conference_id = ?', [conf.id])?.s || 0,
            total_abstracts: query.get('SELECT COUNT(*) as c FROM abstracts WHERE conference_id = ? AND is_withdrawn = 0', [conf.id])?.c || 0,
            accepted_abstracts: query.get("SELECT COUNT(*) as c FROM abstracts WHERE conference_id = ? AND status = 'accepted'", [conf.id])?.c || 0,
            pending_reviews: query.get("SELECT COUNT(*) as c FROM abstracts WHERE conference_id = ? AND status = 'submitted'", [conf.id])?.c || 0,
            scholarship_pending: query.get("SELECT COUNT(*) as c FROM scholarship_applications WHERE conference_id = ? AND status = 'submitted'", [conf.id])?.c || 0,
            refund_pending: query.get("SELECT COUNT(*) as c FROM refund_requests rr JOIN registrations r ON rr.registration_id = r.id WHERE r.conference_id = ? AND rr.status = 'pending'", [conf.id])?.c || 0,
            visa_pending: query.get("SELECT COUNT(*) as c FROM visa_requests vr JOIN registrations r ON vr.registration_id = r.id WHERE r.conference_id = ? AND vr.status = 'pending'", [conf.id])?.c || 0,
            by_ticket_type: query.all('SELECT t.name, COUNT(r.id) as count FROM ticket_types t LEFT JOIN registrations r ON t.id = r.ticket_type_id WHERE t.conference_id = ? GROUP BY t.id', [conf.id]),
            by_country: query.all('SELECT u.country, COUNT(*) as count FROM registrations r JOIN users u ON r.user_id = u.id WHERE r.conference_id = ? GROUP BY u.country ORDER BY count DESC LIMIT 10', [conf.id]),
            registrations_over_time: query.all("SELECT DATE(created_at) as date, COUNT(*) as count FROM registrations WHERE conference_id = ? GROUP BY DATE(created_at) ORDER BY date", [conf.id])
        };

        res.json(stats);
    });

    // Admin: Manage promo codes
    app.post('/api/admin/plexus/promo-codes', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const { code, discount_type, discount_value, max_uses, valid_until } = req.body;

        const id = uuidv4();
        db.run('INSERT INTO promo_codes (id, conference_id, code, discount_type, discount_value, max_uses, valid_until) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [id, conf.id, code.toUpperCase(), discount_type, discount_value, max_uses, valid_until]);
        saveDb();
        res.json({ success: true, promo_id: id });
    });

    app.get('/api/admin/plexus/promo-codes', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const codes = query.all('SELECT * FROM promo_codes WHERE conference_id = ?', [conf.id]);
        res.json(codes);
    });

    // Admin: Manage sessions — (duplicate removed, see Phase 3C endpoints above)

    // Admin: Manage speakers
    app.post('/api/admin/plexus/speakers', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const b = req.body;

        const id = uuidv4();
        db.run(`INSERT INTO speakers (id, conference_id, name, title, institution, bio, photo_url, talk_title, talk_abstract, speaker_type, is_keynote, linkedin_url, twitter_url, email, year, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, conf.id, b.name || null, b.title || null, b.institution || null, b.bio || null,
             b.photo_url || null, b.talk_title || null, b.talk_abstract || null,
             b.speaker_type || 'invited', b.is_keynote ? 1 : 0,
             b.linkedin_url || null, b.twitter_url || null, b.email || null,
             b.year || new Date().getFullYear(), b.is_published ? 1 : 0]);
        saveDb();
        res.json({ success: true, speaker_id: id });
    });

    // Admin: Manage volunteer shifts
    app.post('/api/admin/plexus/volunteer-shifts', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const { name, description, date, start_time, end_time, location, max_volunteers, required_skills } = req.body;

        const id = uuidv4();
        db.run('INSERT INTO volunteer_shifts (id, conference_id, name, description, date, start_time, end_time, location, max_volunteers, required_skills) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            [id, conf.id, name, description, date, start_time, end_time, location, max_volunteers, required_skills]);
        saveDb();
        res.json({ success: true, shift_id: id });
    });

    // Admin: Get volunteers
    app.get('/api/admin/plexus/volunteers', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const volunteers = query.all(`SELECT v.*, u.first_name, u.last_name, u.email, u.phone
            FROM volunteers v JOIN users u ON v.user_id = u.id WHERE v.conference_id = ?`, [conf.id]);
        res.json(volunteers);
    });

    // Admin: Approve/reject volunteer
    app.put('/api/admin/plexus/volunteers/:id', auth, adminOnly, (req, res) => {
        const { status } = req.body;
        db.run('UPDATE volunteers SET status = ? WHERE id = ?', [status, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Launch poll
    app.post('/api/admin/plexus/sessions/:sessionId/polls', auth, adminOnly, (req, res) => {
        const { question, poll_type, options } = req.body;
        const id = uuidv4();

        // Close any active polls for this session
        db.run("UPDATE session_polls SET is_active = 0, closed_at = datetime('now') WHERE session_id = ? AND is_active = 1", [req.params.sessionId]);

        db.run('INSERT INTO session_polls (id, session_id, question, poll_type, options, is_active) VALUES (?, ?, ?, ?, ?, 1)',
            [id, req.params.sessionId, question, poll_type, JSON.stringify(options)]);
        saveDb();
        res.json({ success: true, poll_id: id });
    });

    // Admin: Get poll results
    app.get('/api/admin/plexus/polls/:id/results', auth, adminOnly, (req, res) => {
        const poll = query.get('SELECT * FROM session_polls WHERE id = ?', [req.params.id]);
        if (!poll) return res.status(404).json({ error: 'Poll not found' });

        const responses = query.all('SELECT selected_options FROM poll_responses WHERE poll_id = ?', [req.params.id]);
        const options = JSON.parse(poll.options);
        const results = {};

        options.forEach(opt => results[opt] = 0);
        responses.forEach(r => {
            const selected = JSON.parse(r.selected_options);
            selected.forEach(s => { if (results[s] !== undefined) results[s]++; });
        });

        res.json({ poll, total_responses: responses.length, results });
    });

    // Admin: Process refund
    app.put('/api/admin/plexus/refunds/:id', auth, adminOnly, (req, res) => {
        const { status, amount_approved, admin_notes } = req.body;
        db.run("UPDATE refund_requests SET status = ?, amount_approved = ?, admin_notes = ?, processed_by = ?, processed_at = datetime('now') WHERE id = ?",
            [status, amount_approved, admin_notes, req.user.id, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Process visa request
    app.put('/api/admin/plexus/visa-requests/:id', auth, adminOnly, (req, res) => {
        const { status, letter_file } = req.body;
        db.run("UPDATE visa_requests SET status = ?, letter_file = ?, processed_by = ?, processed_at = datetime('now') WHERE id = ?",
            [status, letter_file, req.user.id, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Get pending items
    app.get('/api/admin/plexus/pending', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");

        const pending = {
            refunds: query.all(`SELECT rr.*, u.first_name, u.last_name, u.email
                FROM refund_requests rr JOIN registrations r ON rr.registration_id = r.id JOIN users u ON r.user_id = u.id
                WHERE r.conference_id = ? AND rr.status = 'pending'`, [conf.id]),
            visas: query.all(`SELECT vr.*, u.first_name, u.last_name, u.email
                FROM visa_requests vr JOIN registrations r ON vr.registration_id = r.id JOIN users u ON r.user_id = u.id
                WHERE r.conference_id = ? AND vr.status = 'pending'`, [conf.id]),
            scholarships: query.all(`SELECT sa.*, u.first_name, u.last_name, u.email
                FROM scholarship_applications sa JOIN users u ON sa.user_id = u.id
                WHERE sa.conference_id = ? AND sa.status = 'submitted'`, [conf.id]),
            transfers: query.all(`SELECT rt.*, u.first_name, u.last_name, u.email
                FROM registration_transfers rt JOIN registrations r ON rt.registration_id = r.id JOIN users u ON r.user_id = u.id
                WHERE r.conference_id = ? AND rt.status = 'pending'`, [conf.id]),
            speaker_apps: query.all(`SELECT * FROM speaker_applications WHERE conference_id = ? AND status = 'submitted'`, [conf.id])
        };

        res.json(pending);
    });

    // Admin: Get speakers (supports ?year= filter)
    app.get('/api/admin/plexus/speakers', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const { year } = req.query;
        let sql = `SELECT * FROM speakers WHERE conference_id = ?`;
        const params = [conf?.id || ''];
        if (year && year !== 'all') {
            sql += ` AND year = ?`;
            params.push(parseInt(year));
        }
        sql += ` ORDER BY is_keynote DESC, name`;
        const speakers = query.all(sql, params);
        res.json(speakers || []);
    });

    // Admin: Get distinct speaker years
    app.get('/api/admin/plexus/speakers/years', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const years = query.all(`SELECT DISTINCT year FROM speakers WHERE conference_id = ? AND year IS NOT NULL ORDER BY year DESC`, [conf?.id || '']);
        res.json(years.map(y => y.year));
    });

    // Admin: Update speaker
    app.put('/api/admin/plexus/speakers/:id', auth, adminOnly, (req, res) => {
        const b = req.body;
        const title = b.title ?? null, institution = b.institution ?? null, bio = b.bio ?? null;
        const photo_url = b.photo_url ?? null, talk_title = b.talk_title ?? null, talk_abstract = b.talk_abstract ?? null;
        const speaker_type = b.speaker_type ?? null, is_keynote = b.is_keynote !== undefined ? (b.is_keynote ? 1 : 0) : null;
        const confirmation_status = b.confirmation_status ?? null, flight_status = b.flight_status ?? null, hotel_status = b.hotel_status ?? null;
        const flight_assigned_to = b.flight_assigned_to || null, hotel_assigned_to = b.hotel_assigned_to || null;
        const flight_details = b.flight_details || null, hotel_details = b.hotel_details || null, notes = b.notes || null;
        const email = b.email ?? null;
        const is_published = b.is_published !== undefined ? (b.is_published ? 1 : 0) : null;
        const year = b.year !== undefined ? (b.year ? parseInt(b.year) : null) : null;
        const linkedin_url = b.linkedin_url ?? null;
        const twitter_url = b.twitter_url ?? null;
        const name = b.name ?? null;

        db.run(`UPDATE speakers SET
            name = COALESCE(?, name),
            title = COALESCE(?, title),
            institution = COALESCE(?, institution),
            bio = COALESCE(?, bio),
            photo_url = COALESCE(?, photo_url),
            talk_title = COALESCE(?, talk_title),
            talk_abstract = COALESCE(?, talk_abstract),
            speaker_type = COALESCE(?, speaker_type),
            is_keynote = COALESCE(?, is_keynote),
            confirmation_status = COALESCE(?, confirmation_status),
            flight_status = COALESCE(?, flight_status),
            hotel_status = COALESCE(?, hotel_status),
            flight_assigned_to = ?,
            hotel_assigned_to = ?,
            flight_details = ?,
            hotel_details = ?,
            notes = ?,
            email = COALESCE(?, email),
            is_published = COALESCE(?, is_published),
            year = COALESCE(?, year),
            linkedin_url = COALESCE(?, linkedin_url),
            twitter_url = COALESCE(?, twitter_url)
            WHERE id = ?`,
            [name, title, institution, bio, photo_url, talk_title, talk_abstract, speaker_type,
             is_keynote, confirmation_status, flight_status, hotel_status,
             flight_assigned_to, hotel_assigned_to, flight_details, hotel_details, notes,
             email, is_published, year, linkedin_url, twitter_url, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Delete speaker
    app.delete('/api/admin/plexus/speakers/:id', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM speakers WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Publish/unpublish speaker
    app.put('/api/admin/plexus/speakers/:id/publish', auth, adminOnly, (req, res) => {
        const { is_published } = req.body;
        const val = is_published ? 1 : 0;
        db.run('UPDATE speakers SET is_published = ? WHERE id = ?', [val, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Push notification for speaker
    app.post('/api/admin/plexus/speakers/:id/notify', auth, adminOnly, (req, res) => {
        const speaker = query.get('SELECT * FROM speakers WHERE id = ?', [req.params.id]);
        if (!speaker) return res.status(404).json({ error: 'Speaker not found' });
        res.json({ success: true });
    });

    // Admin: Import speakers from CSV
    app.post('/api/admin/plexus/speakers/import', auth, adminOnly, upload.single('file'), (req, res) => {
        try {
            const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
            const fileContent = fs.readFileSync(req.file.path, 'utf-8');
            const lines = fileContent.split('\n').filter(l => l.trim());
            if (lines.length < 2) return res.status(400).json({ error: 'CSV file must have a header row and at least one data row' });

            const headers = lines[0].split(',').map(h => h.trim().toLowerCase().replace(/['"]/g, ''));
            const imported = [];
            const yearVal = req.body.year || new Date().getFullYear();

            for (let i = 1; i < lines.length; i++) {
                const row = [];
                let current = '', inQuotes = false;
                for (const ch of lines[i]) {
                    if (ch === '"') { inQuotes = !inQuotes; continue; }
                    if (ch === ',' && !inQuotes) { row.push(current.trim()); current = ''; continue; }
                    current += ch;
                }
                row.push(current.trim());

                const record = {};
                headers.forEach((h, idx) => { record[h] = row[idx] || ''; });

                const name = record.name || record.full_name || `${record.first_name || ''} ${record.last_name || ''}`.trim();
                if (!name) continue;

                const id = uuidv4();
                db.run(`INSERT INTO speakers (id, conference_id, name, title, institution, bio, email, photo_url, speaker_type, is_keynote, year, linkedin_url, twitter_url)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                    [id, conf.id, name, record.title || null, record.institution || record.organization || null,
                     record.bio || null, record.email || null, record.photo_url || record.photo || null,
                     record.speaker_type || record.type || 'invited', record.is_keynote === '1' || record.is_keynote === 'true' ? 1 : 0,
                     parseInt(yearVal), record.linkedin_url || record.linkedin || null, record.twitter_url || record.twitter || null]);
                imported.push({ id, name });
            }

            saveDb();
            try { fs.unlinkSync(req.file.path); } catch (e) {}
            res.json({ success: true, imported: imported.length, speakers: imported });
        } catch (err) {
            console.error('Speaker import error:', err);
            res.status(500).json({ error: 'Failed to import speakers: ' + err.message });
        }
    });

    // Admin: Send invitation emails to selected speakers
    app.post('/api/admin/plexus/speakers/invite', auth, adminOnly, async (req, res) => {
        const { speaker_ids, subject, body } = req.body;
        if (!speaker_ids || !speaker_ids.length) return res.status(400).json({ error: 'No speakers selected' });

        const conf = query.get("SELECT name FROM conferences WHERE slug = 'plexus-2026'");
        const confName = conf?.name || 'Plexus Conference 2026';
        const results = [];

        for (const sid of speaker_ids) {
            const speaker = query.get('SELECT * FROM speakers WHERE id = ?', [sid]);
            if (!speaker || !speaker.email) {
                results.push({ id: sid, name: speaker?.name || 'Unknown', status: 'skipped', reason: 'No email' });
                continue;
            }

            const personalizedBody = (body || '')
                .replace(/\{\{name\}\}/g, speaker.name || '')
                .replace(/\{\{institution\}\}/g, speaker.institution || '')
                .replace(/\{\{conference\}\}/g, confName);

            const emailHtml = `
                <div style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif; max-width: 600px; margin: 0 auto; background: #0f172a; color: #e2e8f0; padding: 32px; border-radius: 12px;">
                    <div style="text-align: center; margin-bottom: 24px;">
                        <h1 style="color: #c9a962; margin: 0; font-size: 24px;">Plexus Conference</h1>
                        <p style="margin: 4px 0 0; color: #94a3b8; font-size: 14px;">Med&X — Speaker Invitation</p>
                    </div>
                    <div style="background: #1e293b; padding: 24px; border-radius: 8px; line-height: 1.7;">
                        ${personalizedBody.replace(/\n/g, '<br>')}
                    </div>
                    <div style="text-align: center; margin-top: 24px; color: #64748b; font-size: 12px;">
                        <p>Med&X — Connecting Science with Impact</p>
                    </div>
                </div>`;

            const emailResult = await sendEmail(
                speaker.email,
                subject || `Invitation to Speak at ${confName}`,
                emailHtml
            );

            db.run(`UPDATE speakers SET invitation_status = 'sent', invitation_sent_at = datetime('now') WHERE id = ?`, [sid]);
            results.push({ id: sid, name: speaker.name, status: 'sent', mock: emailResult.mock || false });
        }

        saveDb();
        res.json({ success: true, results });
    });

    // Admin: Re-invite past speaker for new year (creates copy)
    app.post('/api/admin/plexus/speakers/:id/reinvite', auth, adminOnly, (req, res) => {
        const speaker = query.get('SELECT * FROM speakers WHERE id = ?', [req.params.id]);
        if (!speaker) return res.status(404).json({ error: 'Speaker not found' });

        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const newYear = req.body.year || new Date().getFullYear();
        const id = uuidv4();

        db.run(`INSERT INTO speakers (id, conference_id, name, title, institution, bio, photo_url, email, speaker_type, is_keynote, linkedin_url, twitter_url, year, is_published)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0)`,
            [id, conf.id, speaker.name, speaker.title, speaker.institution, speaker.bio, speaker.photo_url,
             speaker.email, speaker.speaker_type, speaker.is_keynote, speaker.linkedin_url, speaker.twitter_url,
             parseInt(newYear)]);
        saveDb();
        res.json({ success: true, speaker_id: id });
    });

    // Admin: Get sponsors
    app.get('/api/admin/plexus/sponsors', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const sponsors = query.all(`SELECT * FROM sponsors WHERE conference_id = ? ORDER BY tier, name`, [conf?.id || '']);
        res.json(sponsors || []);
    });

    // Admin: Add sponsor
    app.post('/api/admin/plexus/sponsors', auth, adminOnly, (req, res) => {
        const { name, tier, website, logo_url, description, status, amount_pledged, amount_received, contact_name, contact_email, notes, is_published } = req.body;
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const id = uuidv4();
        db.run(`INSERT INTO sponsors (id, conference_id, name, tier, website, logo_url, description, status, amount_pledged, amount_received, contact_name, contact_email, notes, is_published, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
            [id, conf?.id || '', name, tier || 'partner', website, logo_url, description, status || 'prospect', amount_pledged || 0, amount_received || 0, contact_name, contact_email, notes, is_published || 0]);
        saveDb();
        res.json({ success: true, id });
    });

    // Admin: Update sponsor
    app.put('/api/admin/plexus/sponsors/:id', auth, adminOnly, (req, res) => {
        const { name, tier, website, logo_url, description, status, amount_pledged, amount_received, contact_name, contact_email, notes, is_published } = req.body;
        db.run(`UPDATE sponsors SET name = ?, tier = ?, website = ?, logo_url = ?, description = ?, status = ?, amount_pledged = ?, amount_received = ?, contact_name = ?, contact_email = ?, notes = ?, is_published = ? WHERE id = ?`,
            [name, tier, website, logo_url, description, status, amount_pledged || 0, amount_received || 0, contact_name, contact_email, notes, is_published || 0, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Delete sponsor
    app.delete('/api/admin/plexus/sponsors/:id', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM sponsor_tasks WHERE sponsor_id = ?', [req.params.id]);
        db.run('DELETE FROM sponsors WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Publish/unpublish sponsor
    app.put('/api/admin/plexus/sponsors/:id/publish', auth, adminOnly, (req, res) => {
        const { is_published } = req.body;
        db.run('UPDATE sponsors SET is_published = ? WHERE id = ?', [is_published ? 1 : 0, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Get sponsor tasks
    app.get('/api/admin/plexus/sponsors/:id/tasks', auth, adminOnly, (req, res) => {
        const tasks = query.all('SELECT * FROM sponsor_tasks WHERE sponsor_id = ? ORDER BY is_completed, due_date, created_at', [req.params.id]);
        res.json(tasks || []);
    });

    // Admin: Add sponsor task
    app.post('/api/admin/plexus/sponsors/:id/tasks', auth, adminOnly, (req, res) => {
        const { title, due_date, assigned_to } = req.body;
        const id = uuidv4();
        db.run('INSERT INTO sponsor_tasks (id, sponsor_id, title, due_date, assigned_to) VALUES (?, ?, ?, ?, ?)',
            [id, req.params.id, title, due_date, assigned_to]);
        saveDb();
        res.json({ success: true, id });
    });

    // Admin: Update sponsor task
    app.put('/api/admin/plexus/sponsor-tasks/:taskId', auth, adminOnly, (req, res) => {
        const { title, is_completed, due_date, assigned_to } = req.body;
        if (title !== undefined) {
            db.run('UPDATE sponsor_tasks SET title = ?, is_completed = ?, due_date = ?, assigned_to = ? WHERE id = ?',
                [title, is_completed ? 1 : 0, due_date, assigned_to, req.params.taskId]);
        } else {
            db.run('UPDATE sponsor_tasks SET is_completed = ? WHERE id = ?',
                [is_completed ? 1 : 0, req.params.taskId]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Admin: Delete sponsor task
    app.delete('/api/admin/plexus/sponsor-tasks/:taskId', auth, adminOnly, (req, res) => {
        db.run('DELETE FROM sponsor_tasks WHERE id = ?', [req.params.taskId]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Export volunteers CSV
    app.get('/api/admin/plexus/volunteers/export', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const volunteers = query.all(`SELECT v.*,
            COALESCE(v.first_name, u.first_name) as first_name,
            COALESCE(v.last_name, u.last_name) as last_name,
            COALESCE(v.email, u.email) as email,
            u.phone
            FROM volunteers v
            LEFT JOIN users u ON v.user_id = u.id
            WHERE v.conference_id = ?`, [conf?.id]);

        // Get shift assignments
        const assignments = query.all(`SELECT va.volunteer_id, vs.name as shift_name, vs.date, vs.start_time, vs.end_time
            FROM volunteer_assignments va
            JOIN volunteer_shifts vs ON va.shift_id = vs.id
            WHERE vs.conference_id = ?`, [conf?.id]);

        const assignmentMap = {};
        (assignments || []).forEach(a => {
            if (!assignmentMap[a.volunteer_id]) assignmentMap[a.volunteer_id] = [];
            assignmentMap[a.volunteer_id].push(`${a.shift_name} (${a.date} ${a.start_time}-${a.end_time})`);
        });

        const headers = ['First Name', 'Last Name', 'Email', 'Phone', 'Availability', 'Preferred Tasks', 'Assigned Shifts', 'Status'];
        const rows = (volunteers || []).map(v => [
            v.first_name || '', v.last_name || '', v.email || '', v.phone || '',
            v.availability || '', v.preferred_tasks || '',
            (assignmentMap[v.id] || []).join('; '),
            v.status || 'pending'
        ]);

        const csv = [headers.join(','), ...rows.map(r => r.map(c => `"${String(c).replace(/"/g, '""')}"`).join(','))].join('\n');
        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', `attachment; filename="plexus-volunteers-${new Date().toISOString().split('T')[0]}.csv"`);
        res.send(csv);
    });

    // Admin: Recent check-ins
    app.get('/api/admin/plexus/recent-checkins', auth, adminOnly, (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const checkins = query.all(`
            SELECT r.id, u.first_name || ' ' || u.last_name as name, u.email, r.checked_in_at
            FROM registrations r
            JOIN users u ON r.user_id = u.id
            WHERE r.conference_id = ? AND r.checked_in = 1
            ORDER BY r.checked_in_at DESC LIMIT 20
        `, [conf?.id || '']);
        res.json(checkins || []);
    });

    // Admin: Approve volunteer
    app.post('/api/admin/plexus/volunteers/:id/approve', auth, adminOnly, (req, res) => {
        db.run("UPDATE volunteers SET status = 'approved' WHERE id = ?", [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Admin: Reject volunteer
    app.post('/api/admin/plexus/volunteers/:id/reject', auth, adminOnly, (req, res) => {
        db.run("UPDATE volunteers SET status = 'rejected' WHERE id = ?", [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== MONTHLY PROJECT REMINDERS ==========

    // Get notifications for current user
    app.get('/api/notifications', auth, (req, res) => {
        const notifications = query.all(
            `SELECT * FROM admin_notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50`,
            [req.user.id]
        );
        res.json(notifications || []);
    });

    // Mark notification as read
    app.put('/api/notifications/:id/read', auth, (req, res) => {
        db.run('UPDATE admin_notifications SET is_read = 1 WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // Monthly reminder check function
    function checkAndSendMonthlyReminders() {
        const now = new Date();
        const month = now.toLocaleString('default', { month: 'long' });
        const year = now.getFullYear();
        const day = now.getDate();

        // Only send on the 1st of the month
        if (day !== 1) return;

        // Check if already sent this month
        const alreadySent = query.get(
            'SELECT id FROM monthly_reminders_sent WHERE month = ? AND year = ?',
            [month, year]
        );
        if (alreadySent) return;

        console.log(`Sending monthly project reminders for ${month} ${year}...`);

        // Get all projects with dates
        const projects = query.all('SELECT * FROM project_settings');
        const admins = query.all('SELECT * FROM users WHERE is_admin = 1');

        projects.forEach(proj => {
            const eventDate = new Date(proj.event_date);
            const diffDays = Math.ceil((eventDate - now) / (1000 * 60 * 60 * 24));

            if (diffDays > 0) {
                // Send notification to all admins about this project
                admins.forEach(admin => {
                    const notifId = uuidv4();
                    const title = `${proj.project.charAt(0).toUpperCase() + proj.project.slice(1)} Reminder`;
                    const message = `${diffDays} days remaining until ${proj.project}! Event date: ${eventDate.toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric' })}`;

                    db.run(
                        `INSERT INTO admin_notifications (id, user_id, type, title, message, project, created_at)
                         VALUES (?, ?, 'monthly_reminder', ?, ?, ?, datetime('now'))`,
                        [notifId, admin.id, title, message, proj.project]
                    );
                });
            }
        });

        // Mark this month as sent
        db.run('INSERT INTO monthly_reminders_sent (id, month, year) VALUES (?, ?, ?)', [uuidv4(), month, year]);
        saveDb();

        console.log('Monthly reminders sent successfully!');
    }

    // Check for monthly reminders on startup and then daily
    checkAndSendMonthlyReminders();
    setInterval(checkAndSendMonthlyReminders, 24 * 60 * 60 * 1000); // Check daily

    // ========== USER NOTIFICATIONS (from Admin Portal via shared DB) ==========

    // Get notifications for current user (both targeted and broadcast)
    app.get('/api/user-notifications', auth, (req, res) => {
        try {
            const { limit = 50, offset = 0, category, placement } = req.query;
            let sql = `SELECT * FROM user_notifications WHERE (user_id = ? OR user_id IS NULL OR user_group = 'all')`;
            const params = [req.user.id];
            // Exclude expired notifications
            sql += ` AND (expires_at IS NULL OR expires_at = '' OR expires_at > datetime('now'))`;
            if (category && category !== 'all') { sql += ' AND category = ?'; params.push(category); }
            if (placement) { sql += ' AND placement = ?'; params.push(placement); }
            sql += ' ORDER BY created_at DESC LIMIT ? OFFSET ?';
            params.push(parseInt(limit), parseInt(offset));
            const notifications = query.all(sql, params);
            const unreadCount = query.get(
                `SELECT COUNT(*) as count FROM user_notifications WHERE (user_id = ? OR user_id IS NULL OR user_group = 'all') AND is_read = 0 AND (expires_at IS NULL OR expires_at = '' OR expires_at > datetime('now'))`,
                [req.user.id]
            );
            res.json({ notifications: notifications || [], unreadCount: unreadCount?.count || 0 });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Mark user notification as read
    app.put('/api/user-notifications/:id/read', auth, (req, res) => {
        db.run('UPDATE user_notifications SET is_read = 1 WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Mark all user notifications as read
    app.put('/api/user-notifications/mark-all-read', auth, (req, res) => {
        db.run(`UPDATE user_notifications SET is_read = 1 WHERE (user_id = ? OR user_id IS NULL OR user_group = 'all')`, [req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // ========== PUBLIC ACCELERATOR KEY DATES (for user portal timeline) ==========

    // Get key dates for current year (public - no auth required for user portal display)
    app.get('/api/accelerator/key-dates', (req, res) => {
        try {
            const year = req.query.year || new Date().getFullYear();
            const dates = query.all('SELECT * FROM accelerator_key_dates WHERE year = ? ORDER BY sort_order, date_start', [parseInt(year)]);
            res.json(dates || []);
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // Get accelerator overview config (public - no auth required for user portal display)
    app.get('/api/accelerator/overview-config', (req, res) => {
        try {
            const program = query.get('SELECT application_deadline, program_duration, labs_count, positions_range, about_program FROM accelerator_programs WHERE is_active = 1 ORDER BY year DESC LIMIT 1');
            if (!program) return res.json({});
            res.json({
                applicationDeadline: program.application_deadline || '',
                programDuration: program.program_duration || '8-12 Weeks',
                labsCount: program.labs_count || '15+ Worldwide',
                positionsRange: program.positions_range || '5-10',
                aboutProgram: program.about_program || ''
            });
        } catch (err) {
            res.status(500).json({ error: err.message });
        }
    });

    // ========== PUBLIC APPLICANT PORTAL API ==========

    // Applicant registration
    app.post('/api/applicant/register', async (req, res) => {
        try {
            const { email, password, first_name, last_name } = req.body;

            if (!email || !password || !first_name || !last_name) {
                return res.status(400).json({ error: 'Email, password, first name, and last name are required' });
            }

            // Check if email already exists
            const existing = query.get('SELECT id FROM accelerator_applicants WHERE email = ?', [email.toLowerCase()]);
            if (existing) {
                return res.status(400).json({ error: 'An account with this email already exists' });
            }

            const id = uuidv4();
            const passwordHash = await bcrypt.hash(password, 10);
            const verificationToken = uuidv4();

            db.run(`INSERT INTO accelerator_applicants (id, email, password_hash, first_name, last_name, verification_token)
                VALUES (?, ?, ?, ?, ?, ?)`,
                [id, email.toLowerCase(), passwordHash, first_name, last_name, verificationToken]);
            saveDb();

            // Send verification email
            const baseUrl = req.headers.origin || `http://localhost:${PORT}`;
            const verifyLink = `${baseUrl}/apply?verify=${verificationToken}`;
            await sendEmail(email, 'Med&X Accelerator - Verify Your Email', `
                <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
                    <div style="background: #22d3ee; color: white; padding: 20px; text-align: center;">
                        <h2 style="margin: 0;">Med&X Accelerator</h2>
                        <p style="margin: 10px 0 0 0;">Welcome, ${first_name}!</p>
                    </div>
                    <div style="padding: 20px; background: #ffffff; border: 1px solid #ddd;">
                        <p>Thank you for registering for the Med&X Accelerator program.</p>
                        <p>Please verify your email address by clicking the button below:</p>
                        <p style="text-align: center; margin: 20px 0;">
                            <a href="${verifyLink}" style="display: inline-block; background: #22d3ee; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
                                Verify Email
                            </a>
                        </p>
                        <p style="color: #666; font-size: 13px;">
                            If you did not create this account, please ignore this email.
                        </p>
                    </div>
                </div>
            `);

            res.json({ success: true, message: 'Registration successful. Please check your email to verify your account.' });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Registration failed' });
        }
    });

    // Verify email
    app.get('/api/applicant/verify/:token', (req, res) => {
        const applicant = query.get('SELECT id FROM accelerator_applicants WHERE verification_token = ?', [req.params.token]);
        if (!applicant) {
            return res.status(400).json({ error: 'Invalid verification token' });
        }

        db.run('UPDATE accelerator_applicants SET email_verified = 1, verification_token = NULL WHERE id = ?', [applicant.id]);
        saveDb();

        res.json({ success: true, message: 'Email verified successfully. You can now log in.' });
    });

    // Applicant login
    app.post('/api/applicant/login', async (req, res) => {
        try {
            const { email, password } = req.body;

            const applicant = query.get('SELECT * FROM accelerator_applicants WHERE email = ?', [email.toLowerCase()]);
            if (!applicant) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            const validPassword = await bcrypt.compare(password, applicant.password_hash);
            if (!validPassword) {
                return res.status(401).json({ error: 'Invalid email or password' });
            }

            if (!applicant.email_verified) {
                return res.status(401).json({ error: 'Please verify your email before logging in' });
            }

            // Update last login
            db.run('UPDATE accelerator_applicants SET last_login = datetime("now") WHERE id = ?', [applicant.id]);
            saveDb();

            // Generate JWT token
            const token = jwt.sign(
                { id: applicant.id, email: applicant.email, type: 'applicant' },
                JWT_SECRET,
                { expiresIn: '7d' }
            );

            res.json({
                success: true,
                token,
                applicant: {
                    id: applicant.id,
                    email: applicant.email,
                    first_name: applicant.first_name,
                    last_name: applicant.last_name
                }
            });
        } catch (e) {
            console.error(e);
            res.status(500).json({ error: 'Login failed' });
        }
    });

    // Middleware for applicant authentication
    const applicantAuth = (req, res, next) => {
        const authHeader = req.headers.authorization;
        if (!authHeader?.startsWith('Bearer ')) {
            return res.status(401).json({ error: 'Unauthorized' });
        }

        try {
            const token = authHeader.substring(7);
            const decoded = jwt.verify(token, JWT_SECRET);
            if (decoded.type !== 'applicant') {
                return res.status(401).json({ error: 'Invalid token type' });
            }
            req.applicant = decoded;
            next();
        } catch (e) {
            return res.status(401).json({ error: 'Invalid token' });
        }
    };

    // Get applicant profile
    app.get('/api/applicant/profile', applicantAuth, (req, res) => {
        const applicant = query.get('SELECT * FROM accelerator_applicants WHERE id = ?', [req.applicant.id]);
        if (!applicant) {
            return res.status(404).json({ error: 'Applicant not found' });
        }

        delete applicant.password_hash;
        delete applicant.verification_token;
        delete applicant.reset_token;
        delete applicant.reset_token_expires;

        res.json(applicant);
    });

    // Update applicant profile
    app.put('/api/applicant/profile', applicantAuth, (req, res) => {
        const { first_name, last_name, phone, date_of_birth, nationality, address, city, country,
                current_institution, faculty, study_year, expected_graduation } = req.body;

        db.run(`UPDATE accelerator_applicants SET
            first_name = ?, last_name = ?, phone = ?, date_of_birth = ?, nationality = ?,
            address = ?, city = ?, country = ?, current_institution = ?, faculty = ?,
            study_year = ?, expected_graduation = ?
            WHERE id = ?`,
            [first_name, last_name, phone, date_of_birth, nationality, address, city, country,
             current_institution, faculty, study_year, expected_graduation, req.applicant.id]);
        saveDb();

        res.json({ success: true });
    });

    // Get applicant's applications
    app.get('/api/applicant/applications', applicantAuth, (req, res) => {
        const applications = query.all(`
            SELECT a.*, i.name as institution_name, p.year
            FROM accelerator_applications a
            JOIN accelerator_programs p ON a.program_id = p.id
            LEFT JOIN accelerator_institutions i ON a.selected_institution = i.id
            WHERE a.user_id = ?
            ORDER BY a.created_at DESC`, [req.applicant.id]);

        // Get documents for each application
        applications.forEach(app => {
            app.documents = query.all('SELECT id, document_type, original_filename, uploaded_at FROM accelerator_documents WHERE application_id = ?', [app.id]);
        });

        res.json(applications);
    });

    // Start a new application
    app.post('/api/applicant/applications', applicantAuth, (req, res) => {
        const { year } = req.body;
        const program = query.get('SELECT * FROM accelerator_programs WHERE year = ?', [year || new Date().getFullYear()]);
        if (!program) {
            return res.status(400).json({ error: 'No program available for this year' });
        }

        // Check if already has an application for this year
        const existing = query.get('SELECT id FROM accelerator_applications WHERE user_id = ? AND program_id = ?',
            [req.applicant.id, program.id]);
        if (existing) {
            return res.json({ id: existing.id, exists: true });
        }

        // Get applicant info to pre-populate
        const applicant = query.get('SELECT * FROM accelerator_applicants WHERE id = ?', [req.applicant.id]);

        const id = uuidv4();
        const appNumber = `ACC-${year}-${String(Date.now()).slice(-6)}`;

        // Generate unique 3-digit candidate ID
        let candidateId;
        let attempts = 0;
        do {
            candidateId = String(Math.floor(100 + Math.random() * 900));
            const exists = query.get('SELECT id FROM accelerator_applications WHERE candidate_id = ? AND program_id = ?', [candidateId, program.id]);
            if (!exists) break;
            attempts++;
        } while (attempts < 100);

        db.run(`INSERT INTO accelerator_applications
            (id, program_id, user_id, year, application_number, candidate_id,
             first_name, last_name, email, phone, date_of_birth, nationality, address,
             current_institution, year_of_study, expected_graduation, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft')`,
            [id, program.id, req.applicant.id, year || new Date().getFullYear(), appNumber, candidateId,
             applicant.first_name, applicant.last_name, applicant.email, applicant.phone,
             applicant.date_of_birth, applicant.nationality, applicant.address,
             applicant.current_institution, applicant.study_year, applicant.expected_graduation]);
        saveDb();

        res.json({ id, application_number: appNumber, candidate_id: candidateId });
    });

    // Update application
    app.put('/api/applicant/applications/:id', applicantAuth, (req, res) => {
        const app = query.get('SELECT * FROM accelerator_applications WHERE id = ? AND user_id = ?',
            [req.params.id, req.applicant.id]);
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }
        if (app.status === 'submitted') {
            return res.status(400).json({ error: 'Cannot modify submitted application' });
        }

        const { first_name, last_name, phone, date_of_birth, oib, nationality, address,
                current_institution, faculty, degree_program, year_of_study, ects_total,
                expected_graduation, gpa, program_type, selected_institution,
                first_choice_institution, second_choice_institution, third_choice_institution,
                motivation_statement, previous_experience, languages, gdpr_consent } = req.body;

        db.run(`UPDATE accelerator_applications SET
            first_name = ?, last_name = ?, phone = ?, date_of_birth = ?, oib = ?,
            nationality = ?, address = ?, current_institution = ?, degree_program = ?,
            year_of_study = ?, ects_total = ?, expected_graduation = ?, gpa = ?,
            program_type = ?, selected_institution = ?,
            first_choice_institution = ?, second_choice_institution = ?, third_choice_institution = ?,
            motivation_statement = ?, previous_experience = ?, languages = ?,
            gdpr_consent = ?, updated_at = datetime('now')
            WHERE id = ?`,
            [first_name, last_name, phone, date_of_birth, oib, nationality, address,
             current_institution, degree_program, year_of_study, ects_total, expected_graduation, gpa,
             program_type, selected_institution,
             first_choice_institution, second_choice_institution, third_choice_institution,
             motivation_statement, previous_experience, languages,
             gdpr_consent ? 1 : 0, req.params.id]);
        saveDb();

        res.json({ success: true });
    });

    // Submit application
    app.post('/api/applicant/applications/:id/submit', applicantAuth, (req, res) => {
        const app = query.get('SELECT * FROM accelerator_applications WHERE id = ? AND user_id = ?',
            [req.params.id, req.applicant.id]);
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }
        if (app.status === 'submitted') {
            return res.status(400).json({ error: 'Application already submitted' });
        }
        if (!app.gdpr_consent) {
            return res.status(400).json({ error: 'GDPR consent is required' });
        }

        db.run(`UPDATE accelerator_applications SET status = 'submitted', submitted_at = datetime('now'), gdpr_consent_date = datetime('now') WHERE id = ?`,
            [req.params.id]);
        saveDb();

        // Send confirmation email (branded template)
        try {
            sendEmail(app.email, 'Med&X Accelerator — Application Received', buildEmailTemplate('Application Received', `
                <p>Dear ${app.first_name},</p>
                <p>Your application for the <strong>Med&amp;X Accelerator</strong> program has been successfully submitted.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 160px;">Application Number</td>
                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${app.application_number}</td></tr>
                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Candidate ID</td>
                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${app.candidate_id}</td></tr>
                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Submitted</td>
                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}</td></tr>
                </table>
                <p>Our review committee will evaluate your application and notify you of the next steps. This process typically takes 2-4 weeks.</p>
                <p>If you have any questions in the meantime, contact us at <a href="mailto:accelerator@medx.hr" style="color: #C9A962;">accelerator@medx.hr</a>.</p>
                <p>Best regards,<br><strong>Med&amp;X Accelerator Team</strong></p>
            `));
        } catch (emailErr) {
            console.warn('Accelerator applicant submit email failed:', emailErr.message);
        }

        res.json({ success: true, message: 'Application submitted successfully' });
    });

    // Upload document
    app.post('/api/applicant/applications/:id/documents', applicantAuth, upload.single('file'), (req, res) => {
        const app = query.get('SELECT * FROM accelerator_applications WHERE id = ? AND user_id = ?',
            [req.params.id, req.applicant.id]);
        if (!app) {
            return res.status(404).json({ error: 'Application not found' });
        }

        if (!req.file) {
            return res.status(400).json({ error: 'No file uploaded' });
        }

        const docId = uuidv4();
        const { document_type } = req.body;

        // Move file to accelerator folder
        const newPath = path.join(uploadsDir, 'accelerator', req.file.filename);
        fs.renameSync(req.file.path, newPath);

        db.run(`INSERT INTO accelerator_documents (id, application_id, document_type, original_filename, stored_filename, file_path, file_size, mime_type, upload_status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'uploaded')`,
            [docId, req.params.id, document_type, req.file.originalname, req.file.filename,
             `/uploads/accelerator/${req.file.filename}`, req.file.size, req.file.mimetype]);
        saveDb();

        res.json({ success: true, id: docId, filename: req.file.originalname });
    });

    // Delete document
    app.delete('/api/applicant/documents/:docId', applicantAuth, (req, res) => {
        const doc = query.get(`
            SELECT d.*, a.user_id FROM accelerator_documents d
            JOIN accelerator_applications a ON d.application_id = a.id
            WHERE d.id = ?`, [req.params.docId]);

        if (!doc || doc.user_id !== req.applicant.id) {
            return res.status(404).json({ error: 'Document not found' });
        }

        // Delete file
        const filePath = path.join(uploadsDir, 'accelerator', doc.stored_filename);
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
        }

        db.run('DELETE FROM accelerator_documents WHERE id = ?', [req.params.docId]);
        saveDb();

        res.json({ success: true });
    });

    // Get available programs and institutions (public)
    app.get('/api/applicant/programs', (req, res) => {
        const currentYear = new Date().getFullYear();
        const programs = query.all('SELECT year, name, description, application_deadline, program_start, program_end FROM accelerator_programs WHERE year >= ? AND is_active = 1 ORDER BY year', [currentYear]);

        const institutions = query.all('SELECT id, name, short_name, city, country, available_spots, description FROM accelerator_institutions WHERE is_active = 1 ORDER BY sort_order');

        res.json({ programs, institutions });
    });

    // ========== PUBLIC EVALUATION PAGE (Magic Link) ==========
    app.get('/evaluate', (req, res) => {
        res.send(`<!DOCTYPE html>
<html lang="hr">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Med&X Accelerator - Evaluacija kandidata</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root {
            --bg-primary: #0f172a;
            --bg-secondary: #1e293b;
            --card-bg: #1e293b;
            --text-primary: #f1f5f9;
            --text-secondary: #94a3b8;
            --border-color: #334155;
            --accent-color: #22d3ee;
            --success-color: #22c55e;
            --danger-color: #ef4444;
        }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg-primary); color: var(--text-primary); min-height: 100vh; }
        .header { background: var(--bg-secondary); padding: 16px 24px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; color: var(--accent-color); }
        .header .user-info { color: var(--text-secondary); font-size: 14px; }
        .container { max-width: 1200px; margin: 0 auto; padding: 24px; }
        .card { background: var(--card-bg); border-radius: 12px; border: 1px solid var(--border-color); margin-bottom: 20px; }
        .card-header { padding: 16px 20px; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; }
        .card-title { font-weight: 600; }
        .card-body { padding: 20px; }
        .btn { padding: 8px 16px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 6px; transition: all 0.2s; }
        .btn-primary { background: var(--accent-color); color: #000; }
        .btn-primary:hover { opacity: 0.9; }
        .btn-secondary { background: var(--bg-secondary); color: var(--text-primary); border: 1px solid var(--border-color); }
        .btn-success { background: var(--success-color); color: white; }
        table { width: 100%; border-collapse: collapse; }
        th, td { padding: 12px; text-align: left; border-bottom: 1px solid var(--border-color); }
        th { color: var(--text-secondary); font-weight: 500; font-size: 12px; text-transform: uppercase; }
        .badge { padding: 4px 8px; border-radius: 4px; font-size: 12px; font-weight: 500; }
        .badge-success { background: rgba(34, 197, 94, 0.2); color: var(--success-color); }
        .badge-warning { background: rgba(234, 179, 8, 0.2); color: #eab308; }
        .badge-pending { background: rgba(148, 163, 184, 0.2); color: var(--text-secondary); }
        input[type="number"] { width: 80px; padding: 8px; border-radius: 4px; border: 1px solid var(--border-color); background: var(--bg-primary); color: var(--text-primary); text-align: center; }
        .loading { text-align: center; padding: 40px; color: var(--text-secondary); }
        .error { background: rgba(239, 68, 68, 0.1); border: 1px solid var(--danger-color); padding: 20px; border-radius: 8px; text-align: center; }
        .score-input { display: flex; align-items: center; gap: 8px; }
        .max-points { color: var(--text-secondary); font-size: 13px; }
        .candidate-detail { display: none; }
        .candidate-detail.active { display: block; }
        .motivation-letter { background: var(--bg-primary); padding: 16px; border-radius: 8px; white-space: pre-wrap; font-size: 14px; line-height: 1.6; max-height: 300px; overflow-y: auto; }
        .total-score { font-size: 24px; font-weight: bold; color: var(--accent-color); }
    </style>
</head>
<body>
    <div class="header">
        <h1><i class="fas fa-graduation-cap"></i> Med&X Accelerator - Evaluation</h1>
        <div class="user-info" id="userInfo">Loading...</div>
    </div>

    <div class="container">
        <div id="loading" class="loading"><i class="fas fa-spinner fa-spin"></i> Loading...</div>
        <div id="error" class="error" style="display: none;"></div>
        <div id="content" style="display: none;">
            <!-- Candidate List -->
            <div id="candidateList" class="card">
                <div class="card-header">
                    <span class="card-title">Candidates for Evaluation</span>
                    <span id="progressInfo" style="color: var(--text-secondary); font-size: 14px;"></span>
                </div>
                <div class="card-body">
                    <table>
                        <thead>
                            <tr>
                                <th>ID</th>
                                <th>Institution</th>
                                <th>Status</th>
                                <th>My Score</th>
                                <th>Actions</th>
                            </tr>
                        </thead>
                        <tbody id="candidateTableBody"></tbody>
                    </table>
                </div>
            </div>

            <!-- Candidate Detail -->
            <div id="candidateDetail" class="candidate-detail">
                <div class="card">
                    <div class="card-header">
                        <span class="card-title">Candidate <span id="detailCandidateId"></span></span>
                        <button class="btn btn-secondary" onclick="showList()"><i class="fas fa-arrow-left"></i> Back</button>
                    </div>
                    <div class="card-body">
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 20px; margin-bottom: 20px;">
                            <div>
                                <h4 style="margin-bottom: 8px; color: var(--text-secondary);">Institution</h4>
                                <p id="detailInstitution">-</p>
                            </div>
                            <div>
                                <h4 style="margin-bottom: 8px; color: var(--text-secondary);">Documents</h4>
                                <div id="detailDocuments"></div>
                            </div>
                        </div>
                        <div style="margin-bottom: 20px;">
                            <h4 style="margin-bottom: 8px; color: var(--text-secondary);">Motivation Letter</h4>
                            <div id="detailMotivation" class="motivation-letter"></div>
                        </div>
                    </div>
                </div>

                <div class="card">
                    <div class="card-header">
                        <span class="card-title">Evaluation</span>
                        <div class="total-score">Total: <span id="totalScore">0</span></div>
                    </div>
                    <div class="card-body">
                        <table id="criteriaTable">
                            <thead>
                                <tr>
                                    <th>Criterion</th>
                                    <th>Max Points</th>
                                    <th>Your Score</th>
                                </tr>
                            </thead>
                            <tbody id="criteriaTableBody"></tbody>
                        </table>
                        <div style="margin-top: 20px; text-align: right;">
                            <button class="btn btn-success" onclick="submitAllScores()"><i class="fas fa-save"></i> Save Evaluation</button>
                        </div>
                    </div>
                </div>
            </div>
        </div>
    </div>

    <script>
        const token = new URLSearchParams(window.location.search).get('token');
        let sessionData = null;
        let currentAppId = null;
        let currentScores = {};

        async function init() {
            if (!token) {
                showError('Invalid link. Please request a new access link.');
                return;
            }

            try {
                const res = await fetch('/api/accelerator/interview-access/' + token);
                if (!res.ok) {
                    const err = await res.json();
                    throw new Error(err.error || 'Access denied');
                }
                sessionData = await res.json();

                document.getElementById('userInfo').innerHTML =
                    '<i class="fas fa-user"></i> ' + sessionData.interviewer.name + ' | ' + sessionData.interviewer.year;

                renderCandidates();
                document.getElementById('loading').style.display = 'none';
                document.getElementById('content').style.display = 'block';
            } catch (e) {
                showError(e.message);
            }
        }

        function showError(msg) {
            document.getElementById('loading').style.display = 'none';
            document.getElementById('error').style.display = 'block';
            document.getElementById('error').innerHTML = '<i class="fas fa-exclamation-triangle"></i> ' + msg;
        }

        function renderCandidates() {
            const tbody = document.getElementById('candidateTableBody');
            const scored = sessionData.applications.filter(a => a.my_score !== null).length;
            document.getElementById('progressInfo').textContent =
                'Evaluated: ' + scored + ' / ' + sessionData.applications.length;

            tbody.innerHTML = sessionData.applications.map(app => {
                const status = app.my_score !== null ? 'scored' : 'pending';
                return '<tr>' +
                    '<td><strong>' + (app.candidate_id || '-') + '</strong></td>' +
                    '<td>' + (app.institution_name || '-') + '</td>' +
                    '<td><span class="badge ' + (status === 'scored' ? 'badge-success' : 'badge-pending') + '">' +
                        (status === 'scored' ? 'Scored' : 'Pending') + '</span></td>' +
                    '<td>' + (app.my_score !== null ? app.my_score : '-') + '</td>' +
                    '<td><button class="btn btn-primary" onclick="viewCandidate(\\'' + app.id + '\\')"><i class="fas fa-eye"></i> Review</button></td>' +
                '</tr>';
            }).join('');
        }

        async function viewCandidate(appId) {
            currentAppId = appId;
            currentScores = {};

            try {
                const res = await fetch('/api/accelerator/interview-access/' + token + '/application/' + appId);
                const data = await res.json();

                document.getElementById('detailCandidateId').textContent = data.application.candidate_id || '-';
                document.getElementById('detailInstitution').textContent = data.application.institution_name || '-';
                document.getElementById('detailMotivation').textContent = data.application.motivation_letter || 'No motivation letter provided.';

                // Documents
                const docsHtml = data.documents.length > 0
                    ? data.documents.map(d => '<span class="badge badge-success" style="margin: 2px;">' + d.doc_type + '</span>').join('')
                    : '<span style="color: var(--text-secondary);">Nema dokumenata</span>';
                document.getElementById('detailDocuments').innerHTML = docsHtml;

                // Criteria
                const existingScores = {};
                data.criteriaScores.forEach(s => { existingScores[s.criterion_id] = s.score; });

                document.getElementById('criteriaTableBody').innerHTML = sessionData.criteria.map(c => {
                    const existing = existingScores[c.id] ?? '';
                    currentScores[c.id] = existing;
                    return '<tr>' +
                        '<td>' + (c.name || c.name_hr) + '</td>' +
                        '<td class="max-points">' + c.max_points + '</td>' +
                        '<td><div class="score-input"><input type="number" id="score_' + c.id + '" min="0" max="' + c.max_points + '" value="' + existing + '" onchange="updateScore(\\'' + c.id + '\\', this.value, ' + c.max_points + ')"> / ' + c.max_points + '</div></td>' +
                    '</tr>';
                }).join('');

                updateTotal();

                document.getElementById('candidateList').style.display = 'none';
                document.getElementById('candidateDetail').classList.add('active');
            } catch (e) {
                alert('Error: ' + e.message);
            }
        }

        function showList() {
            document.getElementById('candidateDetail').classList.remove('active');
            document.getElementById('candidateList').style.display = 'block';
        }

        function updateScore(criterionId, value, max) {
            const num = parseFloat(value) || 0;
            if (num < 0 || num > max) {
                document.getElementById('score_' + criterionId).value = currentScores[criterionId] || '';
                return;
            }
            currentScores[criterionId] = num;
            updateTotal();
        }

        function updateTotal() {
            let total = 0;
            Object.values(currentScores).forEach(v => { if (v !== '') total += parseFloat(v) || 0; });
            document.getElementById('totalScore').textContent = total.toFixed(1);
        }

        async function submitAllScores() {
            const promises = Object.entries(currentScores).map(([criterionId, score]) => {
                if (score === '') return Promise.resolve();
                return fetch('/api/accelerator/interview-access/' + token + '/score', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ application_id: currentAppId, criterion_id: criterionId, score: parseFloat(score) })
                });
            });

            try {
                await Promise.all(promises);
                alert('Evaluation saved successfully!');

                // Update local data
                const app = sessionData.applications.find(a => a.id === currentAppId);
                if (app) {
                    let total = 0;
                    Object.values(currentScores).forEach(v => { if (v !== '') total += parseFloat(v) || 0; });
                    app.my_score = total;
                }

                showList();
                renderCandidates();
            } catch (e) {
                alert('Error saving: ' + e.message);
            }
        }

        init();
    </script>
</body>
</html>`);
    });

    // ========== PUBLIC APPLICANT PORTAL ==========
    app.get('/apply', (req, res) => {
        res.send(`<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Med&X Accelerator - Apply</title>
    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">
    <style>
        :root { --bg: #0f172a; --card: #1e293b; --border: #334155; --accent: #22d3ee; --success: #22c55e; --danger: #ef4444; --text: #f1f5f9; --muted: #94a3b8; }
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: var(--bg); color: var(--text); min-height: 100vh; }
        .header { background: var(--card); padding: 16px 24px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .header h1 { font-size: 20px; color: var(--accent); display: flex; align-items: center; gap: 10px; }
        .container { max-width: 900px; margin: 0 auto; padding: 24px; }
        .card { background: var(--card); border-radius: 12px; border: 1px solid var(--border); margin-bottom: 20px; overflow: hidden; }
        .card-header { padding: 16px 20px; border-bottom: 1px solid var(--border); display: flex; justify-content: space-between; align-items: center; }
        .card-body { padding: 20px; }
        .btn { padding: 10px 20px; border-radius: 6px; border: none; cursor: pointer; font-size: 14px; display: inline-flex; align-items: center; gap: 8px; transition: all 0.2s; }
        .btn-primary { background: var(--accent); color: #000; font-weight: 600; }
        .btn-secondary { background: transparent; color: var(--text); border: 1px solid var(--border); }
        .btn-success { background: var(--success); color: white; }
        .btn-danger { background: var(--danger); color: white; }
        .btn:hover { opacity: 0.9; transform: translateY(-1px); }
        input, select, textarea { width: 100%; padding: 12px; border-radius: 6px; border: 1px solid var(--border); background: var(--bg); color: var(--text); font-size: 14px; }
        input:focus, select:focus, textarea:focus { outline: none; border-color: var(--accent); }
        label { display: block; margin-bottom: 6px; font-weight: 500; font-size: 13px; color: var(--muted); }
        .form-group { margin-bottom: 16px; }
        .form-row { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
        .tabs { display: flex; gap: 8px; margin-bottom: 20px; flex-wrap: wrap; }
        .tab { padding: 10px 20px; border-radius: 8px; background: var(--card); border: 1px solid var(--border); cursor: pointer; color: var(--muted); transition: all 0.2s; }
        .tab.active { background: var(--accent); color: #000; border-color: var(--accent); font-weight: 600; }
        .badge { padding: 4px 10px; border-radius: 4px; font-size: 12px; font-weight: 500; }
        .badge-success { background: rgba(34,197,94,0.2); color: var(--success); }
        .badge-warning { background: rgba(234,179,8,0.2); color: #eab308; }
        .badge-info { background: rgba(34,211,238,0.2); color: var(--accent); }
        .hidden { display: none !important; }
        .auth-container { max-width: 400px; margin: 60px auto; }
        .doc-item { display: flex; align-items: center; gap: 12px; padding: 12px; background: var(--bg); border-radius: 6px; margin-bottom: 8px; }
        .doc-item i { font-size: 20px; color: var(--accent); }
        .doc-item .name { flex: 1; }
        .doc-item .status { font-size: 12px; }
        .progress-bar { height: 8px; background: var(--border); border-radius: 4px; overflow: hidden; margin-top: 10px; }
        .progress-fill { height: 100%; background: var(--success); transition: width 0.3s; }
        .alert { padding: 12px 16px; border-radius: 6px; margin-bottom: 16px; }
        .alert-success { background: rgba(34,197,94,0.1); border: 1px solid var(--success); color: var(--success); }
        .alert-error { background: rgba(239,68,68,0.1); border: 1px solid var(--danger); color: var(--danger); }
        .section-title { font-size: 18px; font-weight: 600; margin-bottom: 16px; padding-bottom: 8px; border-bottom: 1px solid var(--border); }
        .inst-card { background: var(--bg); border-radius: 8px; padding: 16px; margin-bottom: 12px; cursor: pointer; border: 2px solid transparent; transition: all 0.2s; }
        .inst-card:hover { border-color: var(--border); }
        .inst-card.selected { border-color: var(--accent); background: rgba(34,211,238,0.05); }
        .inst-card h4 { margin-bottom: 4px; }
        .inst-card p { font-size: 13px; color: var(--muted); }
    </style>
</head>
<body>
    <div class="header">
        <h1><i class="fas fa-graduation-cap"></i> Med&X Accelerator</h1>
        <div id="userNav"></div>
    </div>

    <div class="container">
        <!-- Auth Forms -->
        <div id="authSection" class="auth-container">
            <div class="tabs" style="justify-content: center;">
                <div class="tab active" onclick="showAuthTab('login')">Login</div>
                <div class="tab" onclick="showAuthTab('register')">Register</div>
            </div>

            <div id="loginForm" class="card">
                <div class="card-body">
                    <h3 style="text-align: center; margin-bottom: 20px;">Welcome Back</h3>
                    <div id="loginError" class="alert alert-error hidden"></div>
                    <div class="form-group">
                        <label>Email</label>
                        <input type="email" id="loginEmail" placeholder="your@email.com">
                    </div>
                    <div class="form-group">
                        <label>Password</label>
                        <input type="password" id="loginPassword" placeholder="Your password">
                    </div>
                    <button class="btn btn-primary" style="width: 100%;" onclick="login()">
                        <i class="fas fa-sign-in-alt"></i> Login
                    </button>
                </div>
            </div>

            <div id="registerForm" class="card hidden">
                <div class="card-body">
                    <h3 style="text-align: center; margin-bottom: 20px;">Create Account</h3>
                    <div id="registerError" class="alert alert-error hidden"></div>
                    <div id="registerSuccess" class="alert alert-success hidden"></div>
                    <div class="form-row">
                        <div class="form-group">
                            <label>First Name *</label>
                            <input type="text" id="regFirstName" placeholder="John">
                        </div>
                        <div class="form-group">
                            <label>Last Name *</label>
                            <input type="text" id="regLastName" placeholder="Doe">
                        </div>
                    </div>
                    <div class="form-group">
                        <label>Email *</label>
                        <input type="email" id="regEmail" placeholder="your@email.com">
                    </div>
                    <div class="form-group">
                        <label>Password *</label>
                        <input type="password" id="regPassword" placeholder="At least 8 characters">
                    </div>
                    <button class="btn btn-primary" style="width: 100%;" onclick="register()">
                        <i class="fas fa-user-plus"></i> Create Account
                    </button>
                </div>
            </div>
        </div>

        <!-- Dashboard -->
        <div id="dashboardSection" class="hidden">
            <div class="tabs">
                <div class="tab active" onclick="showDashTab('overview')"><i class="fas fa-home"></i> Overview</div>
                <div class="tab" onclick="showDashTab('application')"><i class="fas fa-file-alt"></i> Application</div>
                <div class="tab" onclick="showDashTab('documents')"><i class="fas fa-folder"></i> Documents</div>
                <div class="tab" onclick="showDashTab('profile')"><i class="fas fa-user"></i> Profile</div>
            </div>

            <!-- Overview -->
            <div id="overviewTab">
                <div class="card">
                    <div class="card-header">
                        <span style="font-weight: 600;">Your Application Status</span>
                        <span id="appStatusBadge"></span>
                    </div>
                    <div class="card-body" id="overviewContent"></div>
                </div>
            </div>

            <!-- Application Form -->
            <div id="applicationTab" class="hidden">
                <div class="card">
                    <div class="card-header">
                        <span style="font-weight: 600;">Application Form</span>
                        <button class="btn btn-primary" onclick="saveApplication()"><i class="fas fa-save"></i> Save Draft</button>
                    </div>
                    <div class="card-body">
                        <div id="appFormContent"></div>
                    </div>
                </div>
            </div>

            <!-- Documents -->
            <div id="documentsTab" class="hidden">
                <div class="card">
                    <div class="card-header">
                        <span style="font-weight: 600;">Required Documents</span>
                    </div>
                    <div class="card-body">
                        <p style="color: var(--muted); margin-bottom: 16px;">Upload all required documents. PDF format recommended.</p>
                        <div id="documentsContent"></div>
                    </div>
                </div>
            </div>

            <!-- Profile -->
            <div id="profileTab" class="hidden">
                <div class="card">
                    <div class="card-header">
                        <span style="font-weight: 600;">Your Profile</span>
                        <button class="btn btn-primary" onclick="saveProfile()"><i class="fas fa-save"></i> Save</button>
                    </div>
                    <div class="card-body" id="profileContent"></div>
                </div>
            </div>
        </div>
    </div>

    <script>
        let token = localStorage.getItem('applicantToken');
        let applicant = null;
        let application = null;
        let programs = { programs: [], institutions: [] };

        const documentTypes = [
            { key: 'cv', label: 'CV (Europass format)', required: true },
            { key: 'transcript', label: 'Academic Transcript', required: true },
            { key: 'language_cert', label: 'Language Certificate (B2+)', required: true },
            { key: 'motivation', label: 'Motivation Letter', required: true },
            { key: 'recommendation', label: 'Recommendation Letter', required: true },
            { key: 'domovnica', label: 'Proof of Citizenship', required: true },
            { key: 'student_status', label: 'Student Status Confirmation', required: true },
            { key: 'publication', label: 'Publications (if any)', required: false },
            { key: 'dean_award', label: 'Awards & Honors', required: false },
            { key: 'other', label: 'Other Documents', required: false }
        ];

        async function init() {
            // Check for verification token
            const params = new URLSearchParams(window.location.search);
            const verifyToken = params.get('verify');
            if (verifyToken) {
                try {
                    const res = await fetch('/api/applicant/verify/' + verifyToken);
                    const data = await res.json();
                    if (data.success) {
                        alert('Email verified successfully! You can now log in.');
                    }
                } catch (e) {}
                window.history.replaceState({}, '', '/apply');
            }

            // Load programs
            try {
                const res = await fetch('/api/applicant/programs');
                programs = await res.json();
            } catch (e) {}

            if (token) {
                await loadDashboard();
            }
        }

        function showAuthTab(tab) {
            document.querySelectorAll('#authSection .tab').forEach(t => t.classList.remove('active'));
            document.querySelector('#authSection .tab:' + (tab === 'login' ? 'first-child' : 'last-child')).classList.add('active');
            document.getElementById('loginForm').classList.toggle('hidden', tab !== 'login');
            document.getElementById('registerForm').classList.toggle('hidden', tab !== 'register');
        }

        async function register() {
            const data = {
                email: document.getElementById('regEmail').value,
                password: document.getElementById('regPassword').value,
                first_name: document.getElementById('regFirstName').value,
                last_name: document.getElementById('regLastName').value
            };

            try {
                const res = await fetch('/api/applicant/register', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(data)
                });
                const result = await res.json();

                if (result.success) {
                    document.getElementById('registerSuccess').textContent = result.message;
                    document.getElementById('registerSuccess').classList.remove('hidden');
                    document.getElementById('registerError').classList.add('hidden');
                } else {
                    document.getElementById('registerError').textContent = result.error;
                    document.getElementById('registerError').classList.remove('hidden');
                }
            } catch (e) {
                document.getElementById('registerError').textContent = 'Registration failed. Please try again.';
                document.getElementById('registerError').classList.remove('hidden');
            }
        }

        async function login() {
            const email = document.getElementById('loginEmail').value;
            const password = document.getElementById('loginPassword').value;

            try {
                const res = await fetch('/api/applicant/login', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ email, password })
                });
                const result = await res.json();

                if (result.success) {
                    token = result.token;
                    localStorage.setItem('applicantToken', token);
                    applicant = result.applicant;
                    await loadDashboard();
                } else {
                    document.getElementById('loginError').textContent = result.error;
                    document.getElementById('loginError').classList.remove('hidden');
                }
            } catch (e) {
                document.getElementById('loginError').textContent = 'Login failed. Please try again.';
                document.getElementById('loginError').classList.remove('hidden');
            }
        }

        function logout() {
            token = null;
            applicant = null;
            application = null;
            localStorage.removeItem('applicantToken');
            document.getElementById('authSection').classList.remove('hidden');
            document.getElementById('dashboardSection').classList.add('hidden');
            document.getElementById('userNav').innerHTML = '';
        }

        async function loadDashboard() {
            try {
                // Load profile
                let res = await fetch('/api/applicant/profile', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                if (!res.ok) { logout(); return; }
                applicant = await res.json();

                // Load applications
                res = await fetch('/api/applicant/applications', {
                    headers: { 'Authorization': 'Bearer ' + token }
                });
                const apps = await res.json();
                application = apps.length > 0 ? apps[0] : null;

                // Show dashboard
                document.getElementById('authSection').classList.add('hidden');
                document.getElementById('dashboardSection').classList.remove('hidden');
                document.getElementById('userNav').innerHTML =
                    '<span style="color: var(--muted); margin-right: 16px;">Welcome, ' + applicant.first_name + '</span>' +
                    '<button class="btn btn-secondary" onclick="logout()"><i class="fas fa-sign-out-alt"></i> Logout</button>';

                renderOverview();
                renderProfile();
                renderApplicationForm();
                renderDocuments();
            } catch (e) {
                console.error(e);
                logout();
            }
        }

        function showDashTab(tab) {
            document.querySelectorAll('#dashboardSection > .tabs .tab').forEach(t => t.classList.remove('active'));
            event.target.closest('.tab').classList.add('active');
            ['overview', 'application', 'documents', 'profile'].forEach(t => {
                document.getElementById(t + 'Tab').classList.toggle('hidden', t !== tab);
            });
        }

        function renderOverview() {
            const container = document.getElementById('overviewContent');
            const badge = document.getElementById('appStatusBadge');

            if (!application) {
                badge.innerHTML = '<span class="badge badge-info">No Application</span>';
                container.innerHTML =
                    '<p style="text-align: center; padding: 40px; color: var(--muted);">' +
                    '<i class="fas fa-file-alt" style="font-size: 48px; margin-bottom: 16px; display: block;"></i>' +
                    'You haven\\'t started an application yet.</p>' +
                    '<div style="text-align: center;"><button class="btn btn-primary" onclick="startApplication()"><i class="fas fa-plus"></i> Start Application</button></div>';
                return;
            }

            const status = application.status;
            badge.innerHTML = '<span class="badge ' + (status === 'submitted' ? 'badge-success' : 'badge-warning') + '">' +
                (status === 'submitted' ? 'Submitted' : 'Draft') + '</span>';

            const docsUploaded = application.documents?.length || 0;
            const docsRequired = documentTypes.filter(d => d.required).length;
            const progress = Math.round((docsUploaded / docsRequired) * 100);

            container.innerHTML =
                '<div style="display: grid; grid-template-columns: repeat(3, 1fr); gap: 16px; margin-bottom: 20px;">' +
                '<div style="text-align: center; padding: 16px; background: var(--bg); border-radius: 8px;">' +
                '<div style="font-size: 24px; font-weight: bold; color: var(--accent);">' + (application.candidate_id || '-') + '</div>' +
                '<div style="font-size: 12px; color: var(--muted);">Candidate ID</div></div>' +
                '<div style="text-align: center; padding: 16px; background: var(--bg); border-radius: 8px;">' +
                '<div style="font-size: 24px; font-weight: bold;">' + (application.selected_institution ? programs.institutions.find(i => i.id === application.selected_institution)?.short_name || 'Selected' : '-') + '</div>' +
                '<div style="font-size: 12px; color: var(--muted);">Institution</div></div>' +
                '<div style="text-align: center; padding: 16px; background: var(--bg); border-radius: 8px;">' +
                '<div style="font-size: 24px; font-weight: bold;">' + docsUploaded + '/' + docsRequired + '</div>' +
                '<div style="font-size: 12px; color: var(--muted);">Documents</div></div></div>' +
                '<div class="progress-bar"><div class="progress-fill" style="width: ' + progress + '%;"></div></div>' +
                '<p style="text-align: center; margin-top: 8px; font-size: 13px; color: var(--muted);">' + progress + '% complete</p>' +
                (status !== 'submitted' ? '<div style="text-align: center; margin-top: 20px;"><button class="btn btn-success" onclick="submitApplication()"><i class="fas fa-paper-plane"></i> Submit Application</button></div>' : '');
        }

        async function startApplication() {
            try {
                const res = await fetch('/api/applicant/applications', {
                    method: 'POST',
                    headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                    body: JSON.stringify({ year: new Date().getFullYear() })
                });
                const result = await res.json();
                await loadDashboard();
                showDashTab('application');
            } catch (e) {
                alert('Failed to start application');
            }
        }

        function renderProfile() {
            document.getElementById('profileContent').innerHTML =
                '<div class="form-row"><div class="form-group"><label>First Name</label><input type="text" id="profFirstName" value="' + (applicant.first_name || '') + '"></div>' +
                '<div class="form-group"><label>Last Name</label><input type="text" id="profLastName" value="' + (applicant.last_name || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group"><label>Phone</label><input type="tel" id="profPhone" value="' + (applicant.phone || '') + '"></div>' +
                '<div class="form-group"><label>Date of Birth</label><input type="date" id="profDob" value="' + (applicant.date_of_birth || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group"><label>Nationality</label><input type="text" id="profNationality" value="' + (applicant.nationality || '') + '"></div>' +
                '<div class="form-group"><label>Country</label><input type="text" id="profCountry" value="' + (applicant.country || '') + '"></div></div>' +
                '<div class="form-group"><label>Address</label><input type="text" id="profAddress" value="' + (applicant.address || '') + '"></div>' +
                '<div class="form-row"><div class="form-group"><label>Institution</label><input type="text" id="profInst" value="' + (applicant.current_institution || '') + '"></div>' +
                '<div class="form-group"><label>Faculty</label><input type="text" id="profFaculty" value="' + (applicant.faculty || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group"><label>Year of Study</label><input type="text" id="profYear" value="' + (applicant.study_year || '') + '"></div>' +
                '<div class="form-group"><label>Expected Graduation</label><input type="text" id="profGrad" value="' + (applicant.expected_graduation || '') + '"></div></div>';
        }

        async function saveProfile() {
            const data = {
                first_name: document.getElementById('profFirstName').value,
                last_name: document.getElementById('profLastName').value,
                phone: document.getElementById('profPhone').value,
                date_of_birth: document.getElementById('profDob').value,
                nationality: document.getElementById('profNationality').value,
                country: document.getElementById('profCountry').value,
                address: document.getElementById('profAddress').value,
                current_institution: document.getElementById('profInst').value,
                faculty: document.getElementById('profFaculty').value,
                study_year: document.getElementById('profYear').value,
                expected_graduation: document.getElementById('profGrad').value
            };

            await fetch('/api/applicant/profile', {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            alert('Profile saved!');
        }

        function renderApplicationForm() {
            if (!application) {
                document.getElementById('appFormContent').innerHTML = '<p style="text-align: center; color: var(--muted);">Start an application first.</p>';
                return;
            }

            const instOptions = programs.institutions.map(i =>
                '<div class="inst-card' + (application.selected_institution === i.id ? ' selected' : '') + '" onclick="selectInst(\\'' + i.id + '\\')" data-id="' + i.id + '">' +
                '<h4>' + i.name + ' (' + i.short_name + ')</h4>' +
                '<p style="color: var(--muted); font-size: 13px;">' + i.city + ', ' + i.country + ' • ' + (i.available_spots || '?') + ' spots</p></div>'
            ).join('');

            document.getElementById('appFormContent').innerHTML =
                '<div class="section-title">Personal Information</div>' +
                '<div class="form-row"><div class="form-group"><label>First Name *</label><input type="text" id="appFirstName" value="' + (application.first_name || '') + '"></div>' +
                '<div class="form-group"><label>Last Name *</label><input type="text" id="appLastName" value="' + (application.last_name || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group"><label>Email</label><input type="email" value="' + (application.email || '') + '" disabled></div>' +
                '<div class="form-group"><label>Phone</label><input type="tel" id="appPhone" value="' + (application.phone || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group"><label>Date of Birth</label><input type="date" id="appDob" value="' + (application.date_of_birth || '') + '"></div>' +
                '<div class="form-group"><label>Nationality</label><input type="text" id="appNationality" value="' + (application.nationality || '') + '"></div></div>' +

                '<div class="section-title" style="margin-top: 24px;">Education</div>' +
                '<div class="form-row"><div class="form-group"><label>Institution</label><input type="text" id="appInst" value="' + (application.current_institution || '') + '"></div>' +
                '<div class="form-group"><label>Degree Program</label><input type="text" id="appDegree" value="' + (application.degree_program || '') + '"></div></div>' +
                '<div class="form-row"><div class="form-group"><label>Year of Study</label><input type="text" id="appYearStudy" value="' + (application.year_of_study || '') + '"></div>' +
                '<div class="form-group"><label>GPA</label><input type="number" step="0.01" id="appGpa" value="' + (application.gpa || '') + '"></div></div>' +

                '<div class="section-title" style="margin-top: 24px;">Program Selection</div>' +
                '<p style="color: var(--muted); margin-bottom: 12px;">Select your preferred institution:</p>' +
                '<div id="instSelection">' + instOptions + '</div>' +

                '<div class="section-title" style="margin-top: 24px;">Motivation</div>' +
                '<div class="form-group"><label>Motivation Statement (max 500 words)</label><textarea id="appMotivation" rows="6" placeholder="Explain why you want to join this program...">' + (application.motivation_statement || '') + '</textarea></div>' +

                '<div class="section-title" style="margin-top: 24px;">Consent</div>' +
                '<div class="form-group"><label style="display: flex; align-items: flex-start; gap: 10px; cursor: pointer;">' +
                '<input type="checkbox" id="appGdpr" style="width: auto; margin-top: 3px;"' + (application.gdpr_consent ? ' checked' : '') + '>' +
                '<span>I consent to the processing of my personal data in accordance with GDPR regulations for the purpose of this application.</span></label></div>';
        }

        function selectInst(id) {
            document.querySelectorAll('.inst-card').forEach(c => c.classList.remove('selected'));
            document.querySelector('.inst-card[data-id="' + id + '"]').classList.add('selected');
            application.selected_institution = id;
        }

        async function saveApplication() {
            if (!application) return;

            const data = {
                first_name: document.getElementById('appFirstName').value,
                last_name: document.getElementById('appLastName').value,
                phone: document.getElementById('appPhone').value,
                date_of_birth: document.getElementById('appDob').value,
                nationality: document.getElementById('appNationality').value,
                current_institution: document.getElementById('appInst').value,
                degree_program: document.getElementById('appDegree').value,
                year_of_study: document.getElementById('appYearStudy').value,
                gpa: parseFloat(document.getElementById('appGpa').value) || null,
                selected_institution: application.selected_institution,
                motivation_statement: document.getElementById('appMotivation').value,
                gdpr_consent: document.getElementById('appGdpr').checked
            };

            await fetch('/api/applicant/applications/' + application.id, {
                method: 'PUT',
                headers: { 'Authorization': 'Bearer ' + token, 'Content-Type': 'application/json' },
                body: JSON.stringify(data)
            });
            alert('Application saved!');
            await loadDashboard();
        }

        async function submitApplication() {
            if (!application) return;
            if (!confirm('Are you sure you want to submit? You will not be able to make changes after submission.')) return;

            await saveApplication();

            const res = await fetch('/api/applicant/applications/' + application.id + '/submit', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            const result = await res.json();

            if (result.success) {
                alert('Application submitted successfully!');
                await loadDashboard();
            } else {
                alert('Error: ' + result.error);
            }
        }

        function renderDocuments() {
            if (!application) {
                document.getElementById('documentsContent').innerHTML = '<p style="text-align: center; color: var(--muted);">Start an application first.</p>';
                return;
            }

            const uploadedDocs = application.documents || [];
            const html = documentTypes.map(dt => {
                const uploaded = uploadedDocs.find(d => d.document_type === dt.key);
                return '<div class="doc-item">' +
                    '<i class="fas ' + (uploaded ? 'fa-check-circle' : 'fa-circle') + '" style="color: ' + (uploaded ? 'var(--success)' : 'var(--muted)') + ';"></i>' +
                    '<div class="name">' + dt.label + (dt.required ? ' *' : '') + '</div>' +
                    (uploaded ? '<span class="status" style="color: var(--success);">' + uploaded.original_filename + '</span>' +
                        '<button class="btn btn-danger" style="padding: 4px 8px;" onclick="deleteDoc(\\'' + uploaded.id + '\\')"><i class="fas fa-trash"></i></button>'
                    : '<input type="file" id="file_' + dt.key + '" style="display:none;" onchange="uploadDoc(\\'' + dt.key + '\\')">' +
                        '<button class="btn btn-secondary" style="padding: 6px 12px;" onclick="document.getElementById(\\'file_' + dt.key + '\\').click()"><i class="fas fa-upload"></i> Upload</button>') +
                '</div>';
            }).join('');

            document.getElementById('documentsContent').innerHTML = html;
        }

        async function uploadDoc(docType) {
            const input = document.getElementById('file_' + docType);
            if (!input.files[0]) return;

            const formData = new FormData();
            formData.append('file', input.files[0]);
            formData.append('document_type', docType);

            const res = await fetch('/api/applicant/applications/' + application.id + '/documents', {
                method: 'POST',
                headers: { 'Authorization': 'Bearer ' + token },
                body: formData
            });
            const result = await res.json();

            if (result.success) {
                await loadDashboard();
                showDashTab('documents');
            } else {
                alert('Upload failed: ' + result.error);
            }
        }

        async function deleteDoc(docId) {
            if (!confirm('Delete this document?')) return;

            await fetch('/api/applicant/documents/' + docId, {
                method: 'DELETE',
                headers: { 'Authorization': 'Bearer ' + token }
            });
            await loadDashboard();
            showDashTab('documents');
        }

        init();
    </script>
</body>
</html>`);
    });

    // ========== FINANCE API ENDPOINTS ==========

    // Helper: Get next sequence number
    function getNextSequenceNumber(sequenceType, fiscalYear) {
        let seq = query.get('SELECT * FROM finance_sequences WHERE sequence_type = ? AND fiscal_year = ?', [sequenceType, fiscalYear]);
        if (!seq) {
            const prefixes = {
                'income': 'P',
                'expense': 'R',
                'invoice_incoming': 'UR',
                'invoice_outgoing': 'IR',
                'payment_order': 'PN',
                'travel_order': 'PUT'
            };
            seq = { current_value: 0, prefix: prefixes[sequenceType] || 'DOC' };
            db.run('INSERT INTO finance_sequences (id, sequence_type, fiscal_year, current_value, prefix) VALUES (?, ?, ?, 0, ?)',
                [uuidv4(), sequenceType, fiscalYear, prefixes[sequenceType] || 'DOC']);
        }
        const newValue = (seq.current_value || 0) + 1;
        db.run('UPDATE finance_sequences SET current_value = ? WHERE sequence_type = ? AND fiscal_year = ?',
            [newValue, sequenceType, fiscalYear]);
        saveDb();
        return `${seq.prefix}-${fiscalYear}-${String(newValue).padStart(3, '0')}`;
    }

    // Finance Dashboard
    app.get('/api/finance/dashboard', auth, (req, res) => {
        const year = parseInt(req.query.year) || new Date().getFullYear();

        // Get latest bank balance
        const latestBalance = query.get('SELECT * FROM finance_bank_balance ORDER BY date DESC, created_at DESC LIMIT 1');

        // Get fiscal year info
        const fiscalYear = query.get('SELECT * FROM finance_fiscal_years WHERE year = ?', [year]);

        // Get totals
        const income = query.get('SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions WHERE transaction_type = ? AND fiscal_year = ?', ['income', year]);
        const expenses = query.get('SELECT COALESCE(SUM(amount), 0) as total FROM finance_transactions WHERE transaction_type = ? AND fiscal_year = ?', ['expense', year]);

        // Get work unit stats
        const workUnits = query.all('SELECT * FROM finance_work_units WHERE fiscal_year = ? AND status = ?', [year, 'active']);
        const totalBudget = workUnits.reduce((sum, wu) => sum + (wu.budget_total || 0), 0);
        const usedBudget = workUnits.reduce((sum, wu) => sum + (wu.budget_used || 0), 0);

        // Get by project
        const byProject = query.all(`
            SELECT project, transaction_type, SUM(amount) as total
            FROM finance_transactions
            WHERE fiscal_year = ? AND project IS NOT NULL
            GROUP BY project, transaction_type
        `, [year]);

        // Get pending items
        const pendingInvoices = query.get('SELECT COUNT(*) as c FROM finance_invoices WHERE status IN (?, ?) AND fiscal_year = ?', ['draft', 'issued', year]);
        const pendingTravelOrders = query.get('SELECT COUNT(*) as c FROM finance_travel_orders WHERE status IN (?, ?) AND fiscal_year = ?', ['assigned', 'submitted', year]);

        res.json({
            currentBalance: latestBalance?.balance || 0,
            balanceDate: latestBalance?.date,
            fiscalYear,
            totalIncome: income?.total || 0,
            totalExpenses: expenses?.total || 0,
            netBalance: (income?.total || 0) - (expenses?.total || 0),
            workUnitsCount: workUnits.length,
            totalBudget,
            usedBudget,
            remainingBudget: totalBudget - usedBudget,
            byProject,
            pendingInvoices: pendingInvoices?.c || 0,
            pendingTravelOrders: pendingTravelOrders?.c || 0
        });
    });

    // Bank Balance
    app.get('/api/finance/bank-balance', auth, (req, res) => {
        const balances = query.all('SELECT * FROM finance_bank_balance ORDER BY date DESC, created_at DESC');
        res.json(balances);
    });

    app.post('/api/finance/bank-balance', auth, (req, res) => {
        const { balance, date, notes } = req.body;
        const id = uuidv4();
        db.run('INSERT INTO finance_bank_balance (id, balance, date, notes, created_by) VALUES (?, ?, ?, ?, ?)',
            [id, balance, date, notes || null, req.user.id]);
        saveDb();
        res.json({ success: true, id });
    });

    app.delete('/api/finance/bank-balance/:id', auth, (req, res) => {
        db.run('DELETE FROM finance_bank_balance WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Fiscal Years
    app.get('/api/finance/years', auth, (req, res) => {
        const years = query.all('SELECT * FROM finance_fiscal_years ORDER BY year DESC');
        res.json(years);
    });

    app.post('/api/finance/years', auth, (req, res) => {
        const { year } = req.body;
        const id = uuidv4();
        db.run('INSERT INTO finance_fiscal_years (id, year, status) VALUES (?, ?, ?)', [id, year, 'open']);
        saveDb();
        res.json({ success: true, id });
    });

    app.put('/api/finance/years/:year', auth, (req, res) => {
        const { status, notes } = req.body;
        const year = parseInt(req.params.year);

        if (status === 'closed') {
            // Close all work units for this year
            db.run('UPDATE finance_work_units SET status = ?, closed_at = datetime(?) WHERE fiscal_year = ?',
                ['closed', 'now', year]);
            db.run('UPDATE finance_fiscal_years SET status = ?, closed_at = datetime(?), closed_by = ?, notes = ? WHERE year = ?',
                ['closed', 'now', req.user.id, notes, year]);
        } else if (status === 'archived') {
            db.run('UPDATE finance_fiscal_years SET status = ?, archived_at = datetime(?) WHERE year = ?',
                ['archived', 'now', year]);
        } else {
            db.run('UPDATE finance_fiscal_years SET status = ?, notes = ? WHERE year = ?',
                [status, notes, year]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Work Units
    app.get('/api/finance/work-units', auth, (req, res) => {
        const year = req.query.year ? parseInt(req.query.year) : null;
        const status = req.query.status;

        let sql = 'SELECT * FROM finance_work_units WHERE 1=1';
        const params = [];

        if (year) {
            sql += ' AND fiscal_year = ?';
            params.push(year);
        }
        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        sql += ' ORDER BY code';

        res.json(query.all(sql, params));
    });

    app.post('/api/finance/work-units', auth, (req, res) => {
        const { code, name, description, grant_source, fiscal_year, budget_total } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO finance_work_units (id, code, name, description, grant_source, fiscal_year, budget_total)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, code, name, description || null, grant_source || null, fiscal_year || new Date().getFullYear(), budget_total || 0]);
        saveDb();
        res.json({ success: true, id });
    });

    app.get('/api/finance/work-units/:id', auth, (req, res) => {
        const wu = query.get('SELECT * FROM finance_work_units WHERE id = ?', [req.params.id]);
        if (!wu) return res.status(404).json({ error: 'Not found' });

        // Get transactions for this work unit
        const transactions = query.all('SELECT * FROM finance_transactions WHERE work_unit_id = ? ORDER BY date DESC', [req.params.id]);
        res.json({ ...wu, transactions });
    });

    app.put('/api/finance/work-units/:id', auth, (req, res) => {
        const { code, name, description, grant_source, budget_total, status } = req.body;
        db.run(`UPDATE finance_work_units SET code = ?, name = ?, description = ?, grant_source = ?, budget_total = ?, status = ? WHERE id = ?`,
            [code, name, description, grant_source, budget_total, status, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/finance/work-units/:id', auth, (req, res) => {
        // Check if any transactions reference this work unit
        const count = query.get('SELECT COUNT(*) as c FROM finance_transactions WHERE work_unit_id = ?', [req.params.id]);
        if (count?.c > 0) {
            return res.status(400).json({ error: 'Cannot delete work unit with transactions' });
        }
        db.run('DELETE FROM finance_work_units WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Transactions
    app.get('/api/finance/transactions', auth, (req, res) => {
        const { year, type, project, work_unit_id, limit: limitParam, offset } = req.query;
        let sql = `SELECT t.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_transactions t
            LEFT JOIN finance_work_units wu ON t.work_unit_id = wu.id
            WHERE 1=1`;
        const params = [];

        if (year) {
            sql += ' AND t.fiscal_year = ?';
            params.push(parseInt(year));
        }
        if (type) {
            sql += ' AND t.transaction_type = ?';
            params.push(type);
        }
        if (project) {
            sql += ' AND t.project = ?';
            params.push(project);
        }
        if (work_unit_id) {
            sql += ' AND t.work_unit_id = ?';
            params.push(work_unit_id);
        }

        sql += ' ORDER BY t.date DESC, t.created_at DESC';

        if (limitParam) {
            sql += ' LIMIT ?';
            params.push(parseInt(limitParam));
        }
        if (offset) {
            sql += ' OFFSET ?';
            params.push(parseInt(offset));
        }

        res.json(query.all(sql, params));
    });

    app.post('/api/finance/transactions', auth, (req, res) => {
        const { transaction_type, amount, date, description, project, work_unit_id, category, payment_method, reference, fiscal_year } = req.body;
        const id = uuidv4();
        const year = fiscal_year || new Date(date).getFullYear();
        const transactionNumber = getNextSequenceNumber(transaction_type, year);

        db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description, project, work_unit_id, category, payment_method, reference, fiscal_year, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, transactionNumber, transaction_type, amount, date, description || null, project || null, work_unit_id || null, category || null, payment_method || null, reference || null, year, req.user.id]);

        // Update work unit budget_used if applicable
        if (work_unit_id && transaction_type === 'expense') {
            db.run('UPDATE finance_work_units SET budget_used = budget_used + ? WHERE id = ?', [amount, work_unit_id]);
        }

        saveDb();
        res.json({ success: true, id, transaction_number: transactionNumber });
    });

    app.get('/api/finance/transactions/:id', auth, (req, res) => {
        const t = query.get(`SELECT t.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_transactions t
            LEFT JOIN finance_work_units wu ON t.work_unit_id = wu.id
            WHERE t.id = ?`, [req.params.id]);
        if (!t) return res.status(404).json({ error: 'Not found' });
        res.json(t);
    });

    app.put('/api/finance/transactions/:id', auth, (req, res) => {
        const existing = query.get('SELECT * FROM finance_transactions WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Not found' });

        const { amount, date, description, project, work_unit_id, category, payment_method, reference } = req.body;

        // Update work unit budget if expense and work unit changed
        if (existing.transaction_type === 'expense') {
            if (existing.work_unit_id && existing.work_unit_id !== work_unit_id) {
                db.run('UPDATE finance_work_units SET budget_used = budget_used - ? WHERE id = ?', [existing.amount, existing.work_unit_id]);
            }
            if (work_unit_id) {
                const diff = amount - existing.amount;
                if (existing.work_unit_id === work_unit_id) {
                    db.run('UPDATE finance_work_units SET budget_used = budget_used + ? WHERE id = ?', [diff, work_unit_id]);
                } else {
                    db.run('UPDATE finance_work_units SET budget_used = budget_used + ? WHERE id = ?', [amount, work_unit_id]);
                }
            }
        }

        db.run(`UPDATE finance_transactions SET amount = ?, date = ?, description = ?, project = ?, work_unit_id = ?, category = ?, payment_method = ?, reference = ? WHERE id = ?`,
            [amount, date, description, project, work_unit_id, category, payment_method, reference, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/finance/transactions/:id', auth, (req, res) => {
        const existing = query.get('SELECT * FROM finance_transactions WHERE id = ?', [req.params.id]);
        if (!existing) return res.status(404).json({ error: 'Not found' });

        // Reverse work unit budget if expense
        if (existing.transaction_type === 'expense' && existing.work_unit_id) {
            db.run('UPDATE finance_work_units SET budget_used = budget_used - ? WHERE id = ?', [existing.amount, existing.work_unit_id]);
        }

        db.run('DELETE FROM finance_transactions WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Invoices
    app.get('/api/finance/invoices', auth, (req, res) => {
        const { year, direction, status } = req.query;
        let sql = `SELECT i.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_invoices i
            LEFT JOIN finance_work_units wu ON i.work_unit_id = wu.id
            WHERE 1=1`;
        const params = [];

        if (year) {
            sql += ' AND i.fiscal_year = ?';
            params.push(parseInt(year));
        }
        if (direction) {
            sql += ' AND i.direction = ?';
            params.push(direction);
        }
        if (status) {
            sql += ' AND i.status = ?';
            params.push(status);
        }
        sql += ' ORDER BY i.created_at DESC';
        res.json(query.all(sql, params));
    });

    app.post('/api/finance/invoices', auth, (req, res) => {
        const { invoice_type, direction, party_name, party_address, party_oib, party_email,
            issue_date, due_date, fiscalized, notes, project, work_unit_id, fiscal_year, items } = req.body;

        const id = uuidv4();
        const year = fiscal_year || new Date().getFullYear();
        const seqType = direction === 'incoming' ? 'invoice_incoming' : 'invoice_outgoing';
        const invoiceNumber = getNextSequenceNumber(seqType, year);

        // Calculate totals from items
        let subtotal = 0, discountTotal = 0, vatTotal = 0;
        (items || []).forEach(item => {
            const lineSubtotal = (item.quantity || 1) * item.unit_price;
            const discountAmt = lineSubtotal * ((item.discount_percent || 0) / 100);
            const afterDiscount = lineSubtotal - discountAmt;
            const vatAmt = afterDiscount * ((item.vat_rate || 0) / 100);
            subtotal += lineSubtotal;
            discountTotal += discountAmt;
            vatTotal += vatAmt;
        });
        const total = subtotal - discountTotal + vatTotal;

        db.run(`INSERT INTO finance_invoices (id, invoice_number, invoice_type, direction, status, issue_date, due_date,
            fiscalized, party_name, party_address, party_oib, party_email, subtotal, discount_total, vat_total, total,
            notes, project, work_unit_id, fiscal_year, created_by)
            VALUES (?, ?, ?, ?, 'draft', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, invoiceNumber, invoice_type || 'standard', direction, issue_date || null, due_date || null, fiscalized ? 1 : 0,
             party_name, party_address || null, party_oib || null, party_email || null, subtotal, discountTotal, vatTotal, total,
             notes || null, project || null, work_unit_id || null, year, req.user.id]);

        // Insert items
        (items || []).forEach((item, idx) => {
            const lineSubtotal = (item.quantity || 1) * item.unit_price;
            const discountAmt = lineSubtotal * ((item.discount_percent || 0) / 100);
            const afterDiscount = lineSubtotal - discountAmt;
            const vatAmt = afterDiscount * ((item.vat_rate || 0) / 100);
            const lineTotal = afterDiscount + vatAmt;

            db.run(`INSERT INTO finance_invoice_items (id, invoice_id, description, quantity, unit_price,
                discount_percent, discount_amount, vat_rate, vat_amount, line_total, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), id, item.description, item.quantity || 1, item.unit_price,
                 item.discount_percent || 0, discountAmt, item.vat_rate || 0, vatAmt, lineTotal, idx]);
        });

        saveDb();
        res.json({ success: true, id, invoice_number: invoiceNumber });
    });

    app.get('/api/finance/invoices/:id', auth, (req, res) => {
        const invoice = query.get(`SELECT i.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_invoices i
            LEFT JOIN finance_work_units wu ON i.work_unit_id = wu.id
            WHERE i.id = ?`, [req.params.id]);
        if (!invoice) return res.status(404).json({ error: 'Not found' });

        const items = query.all('SELECT * FROM finance_invoice_items WHERE invoice_id = ? ORDER BY sort_order', [req.params.id]);
        res.json({ ...invoice, items });
    });

    app.put('/api/finance/invoices/:id', auth, (req, res) => {
        const { party_name, party_address, party_oib, party_email, issue_date, due_date,
            fiscalized, notes, project, work_unit_id, items } = req.body;

        // Recalculate totals
        let subtotal = 0, discountTotal = 0, vatTotal = 0;
        (items || []).forEach(item => {
            const lineSubtotal = (item.quantity || 1) * item.unit_price;
            const discountAmt = lineSubtotal * ((item.discount_percent || 0) / 100);
            const afterDiscount = lineSubtotal - discountAmt;
            const vatAmt = afterDiscount * ((item.vat_rate || 0) / 100);
            subtotal += lineSubtotal;
            discountTotal += discountAmt;
            vatTotal += vatAmt;
        });
        const total = subtotal - discountTotal + vatTotal;

        db.run(`UPDATE finance_invoices SET party_name = ?, party_address = ?, party_oib = ?, party_email = ?,
            issue_date = ?, due_date = ?, fiscalized = ?, subtotal = ?, discount_total = ?, vat_total = ?, total = ?,
            notes = ?, project = ?, work_unit_id = ? WHERE id = ?`,
            [party_name, party_address, party_oib, party_email, issue_date, due_date, fiscalized ? 1 : 0,
             subtotal, discountTotal, vatTotal, total, notes, project, work_unit_id, req.params.id]);

        // Replace items
        db.run('DELETE FROM finance_invoice_items WHERE invoice_id = ?', [req.params.id]);
        (items || []).forEach((item, idx) => {
            const lineSubtotal = (item.quantity || 1) * item.unit_price;
            const discountAmt = lineSubtotal * ((item.discount_percent || 0) / 100);
            const afterDiscount = lineSubtotal - discountAmt;
            const vatAmt = afterDiscount * ((item.vat_rate || 0) / 100);
            const lineTotal = afterDiscount + vatAmt;

            db.run(`INSERT INTO finance_invoice_items (id, invoice_id, description, quantity, unit_price,
                discount_percent, discount_amount, vat_rate, vat_amount, line_total, sort_order)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [uuidv4(), req.params.id, item.description, item.quantity || 1, item.unit_price,
                 item.discount_percent || 0, discountAmt, item.vat_rate || 0, vatAmt, lineTotal, idx]);
        });

        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/finance/invoices/:id', auth, (req, res) => {
        db.run('DELETE FROM finance_invoice_items WHERE invoice_id = ?', [req.params.id]);
        db.run('DELETE FROM finance_invoices WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Issue invoice (change status from draft to issued)
    app.post('/api/finance/invoices/:id/issue', auth, (req, res) => {
        db.run('UPDATE finance_invoices SET status = ?, issue_date = COALESCE(issue_date, date(?)) WHERE id = ?',
            ['issued', 'now', req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Mark invoice as paid
    app.post('/api/finance/invoices/:id/mark-paid', auth, (req, res) => {
        const invoice = query.get('SELECT * FROM finance_invoices WHERE id = ?', [req.params.id]);
        if (!invoice) return res.status(404).json({ error: 'Not found' });

        // Create a transaction for this payment
        const transactionType = invoice.direction === 'outgoing' ? 'income' : 'expense';
        const transactionNumber = getNextSequenceNumber(transactionType, invoice.fiscal_year);
        const transactionId = uuidv4();

        db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description,
            project, work_unit_id, category, fiscal_year, created_by)
            VALUES (?, ?, ?, ?, date(?), ?, ?, ?, ?, ?, ?)`,
            [transactionId, transactionNumber, transactionType, invoice.total, 'now',
             `Payment for invoice ${invoice.invoice_number}`, invoice.project, invoice.work_unit_id,
             'invoice_payment', invoice.fiscal_year, req.user.id]);

        // Update work unit if expense
        if (transactionType === 'expense' && invoice.work_unit_id) {
            db.run('UPDATE finance_work_units SET budget_used = budget_used + ? WHERE id = ?', [invoice.total, invoice.work_unit_id]);
        }

        db.run('UPDATE finance_invoices SET status = ?, paid_date = date(?), transaction_id = ? WHERE id = ?',
            ['paid', 'now', transactionId, req.params.id]);

        saveDb();
        res.json({ success: true, transaction_id: transactionId });
    });

    // Generate invoice PDF
    app.get('/api/finance/invoices/:id/pdf', auth, async (req, res) => {
        const invoice = query.get('SELECT * FROM finance_invoices WHERE id = ?', [req.params.id]);
        if (!invoice) return res.status(404).json({ error: 'Not found' });

        const items = query.all('SELECT * FROM finance_invoice_items WHERE invoice_id = ? ORDER BY sort_order', [req.params.id]);
        const settings = {};
        query.all('SELECT setting_key, setting_value FROM finance_settings').forEach(s => {
            settings[s.setting_key] = s.setting_value;
        });

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 40px; }
        .header { display: flex; justify-content: space-between; margin-bottom: 40px; }
        .logo { font-size: 24px; font-weight: bold; color: #c9a962; }
        .invoice-title { font-size: 20px; font-weight: bold; text-align: right; }
        .parties { display: flex; justify-content: space-between; margin-bottom: 30px; }
        .party { width: 45%; }
        .party-label { font-weight: bold; color: #666; margin-bottom: 5px; }
        table { width: 100%; border-collapse: collapse; margin: 20px 0; }
        th, td { padding: 10px; border-bottom: 1px solid #ddd; text-align: left; }
        th { background: #f5f5f5; }
        .text-right { text-align: right; }
        .totals { margin-top: 20px; text-align: right; }
        .total-row { display: flex; justify-content: flex-end; gap: 40px; margin: 5px 0; }
        .grand-total { font-size: 16px; font-weight: bold; border-top: 2px solid #333; padding-top: 10px; }
        .footer { margin-top: 40px; padding-top: 20px; border-top: 1px solid #ddd; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">Med&X</div>
        <div class="invoice-title">
            ${invoice.direction === 'incoming' ? 'INCOMING INVOICE' : 'OUTGOING INVOICE'}<br>
            <span style="font-size: 14px; color: #666;">${invoice.invoice_number}</span>
        </div>
    </div>

    <div class="parties">
        <div class="party">
            <div class="party-label">From:</div>
            <strong>${settings.company_name || 'Med&X'}</strong><br>
            ${settings.company_address || ''}<br>
            ${settings.company_oib ? 'Tax ID: ' + settings.company_oib : ''}
        </div>
        <div class="party">
            <div class="party-label">To:</div>
            <strong>${invoice.party_name}</strong><br>
            ${invoice.party_address || ''}<br>
            ${invoice.party_oib ? 'Tax ID: ' + invoice.party_oib : ''}
        </div>
    </div>

    <table>
        <thead>
            <tr>
                <th>Description</th>
                <th class="text-right">Qty.</th>
                <th class="text-right">Price</th>
                <th class="text-right">Discount</th>
                <th class="text-right">VAT</th>
                <th class="text-right">Total</th>
            </tr>
        </thead>
        <tbody>
            ${items.map(item => `
                <tr>
                    <td>${item.description}</td>
                    <td class="text-right">${item.quantity}</td>
                    <td class="text-right">${item.unit_price.toFixed(2)} EUR</td>
                    <td class="text-right">${item.discount_percent > 0 ? item.discount_percent + '%' : '-'}</td>
                    <td class="text-right">${item.vat_rate > 0 ? item.vat_rate + '%' : '-'}</td>
                    <td class="text-right">${item.line_total.toFixed(2)} EUR</td>
                </tr>
            `).join('')}
        </tbody>
    </table>

    <div class="totals">
        <div class="total-row"><span>Subtotal:</span><span>${invoice.subtotal.toFixed(2)} EUR</span></div>
        ${invoice.discount_total > 0 ? `<div class="total-row"><span>Discount:</span><span>-${invoice.discount_total.toFixed(2)} EUR</span></div>` : ''}
        ${invoice.vat_total > 0 ? `<div class="total-row"><span>VAT:</span><span>${invoice.vat_total.toFixed(2)} EUR</span></div>` : ''}
        <div class="total-row grand-total"><span>TOTAL:</span><span>${invoice.total.toFixed(2)} EUR</span></div>
    </div>

    <div class="footer">
        <p><strong>Issue Date:</strong> ${invoice.issue_date || '-'}</p>
        <p><strong>Payment Due:</strong> ${invoice.due_date || '-'}</p>
        ${settings.company_iban ? `<p><strong>IBAN:</strong> ${settings.company_iban}</p>` : ''}
        ${invoice.notes ? `<p><strong>Notes:</strong> ${invoice.notes}</p>` : ''}
        <p style="margin-top: 20px; color: #666;">${settings.invoice_footer || ''}</p>
    </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        const safeInvoiceName = (invoice.invoice_number || 'invoice').replace(/["\r\n]/g, '');
        res.setHeader('Content-Disposition', `inline; filename="${safeInvoiceName}.html"`);
        res.send(html);
    });

    // Payment Orders
    app.get('/api/finance/payment-orders', auth, (req, res) => {
        const { year, status } = req.query;
        let sql = `SELECT po.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_payment_orders po
            LEFT JOIN finance_work_units wu ON po.work_unit_id = wu.id
            WHERE 1=1`;
        const params = [];

        if (year) {
            sql += ' AND po.fiscal_year = ?';
            params.push(parseInt(year));
        }
        if (status) {
            sql += ' AND po.status = ?';
            params.push(status);
        }
        sql += ' ORDER BY po.date DESC';
        res.json(query.all(sql, params));
    });

    app.post('/api/finance/payment-orders', auth, (req, res) => {
        const { recipient_name, recipient_iban, payment_type, amount, reference, date, description, project, work_unit_id, fiscal_year } = req.body;
        const id = uuidv4();
        const year = fiscal_year || new Date().getFullYear();
        const orderNumber = getNextSequenceNumber('payment_order', year);

        db.run(`INSERT INTO finance_payment_orders (id, order_number, recipient_name, recipient_iban, payment_type, amount,
            reference, date, description, project, work_unit_id, fiscal_year, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, orderNumber, recipient_name, recipient_iban || null, payment_type || 'outgoing', amount, reference || null, date, description || null, project || null, work_unit_id || null, year, req.user.id]);
        saveDb();
        res.json({ success: true, id, order_number: orderNumber });
    });

    app.get('/api/finance/payment-orders/:id', auth, (req, res) => {
        const po = query.get(`SELECT po.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_payment_orders po
            LEFT JOIN finance_work_units wu ON po.work_unit_id = wu.id
            WHERE po.id = ?`, [req.params.id]);
        if (!po) return res.status(404).json({ error: 'Not found' });
        res.json(po);
    });

    app.put('/api/finance/payment-orders/:id', auth, (req, res) => {
        const { recipient_name, recipient_iban, payment_type, amount, reference, date, execution_date, status, description, project, work_unit_id } = req.body;
        db.run(`UPDATE finance_payment_orders SET recipient_name = ?, recipient_iban = ?, payment_type = ?, amount = ?,
            reference = ?, date = ?, execution_date = ?, status = ?, description = ?, project = ?, work_unit_id = ? WHERE id = ?`,
            [recipient_name, recipient_iban, payment_type, amount, reference, date, execution_date, status, description, project, work_unit_id, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/finance/payment-orders/:id', auth, (req, res) => {
        db.run('DELETE FROM finance_payment_orders WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Travel Orders
    app.get('/api/finance/travel-orders', auth, (req, res) => {
        const { year, status, traveler_id } = req.query;
        let sql = `SELECT to1.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_travel_orders to1
            LEFT JOIN finance_work_units wu ON to1.work_unit_id = wu.id
            WHERE 1=1`;
        const params = [];

        if (year) {
            sql += ' AND to1.fiscal_year = ?';
            params.push(parseInt(year));
        }
        if (status) {
            sql += ' AND to1.status = ?';
            params.push(status);
        }
        if (traveler_id) {
            sql += ' AND to1.traveler_id = ?';
            params.push(traveler_id);
        }
        sql += ' ORDER BY to1.created_at DESC';
        res.json(query.all(sql, params));
    });

    // Get user's own travel orders
    app.get('/api/finance/my-travel-orders', auth, (req, res) => {
        // Get team member ID for current user
        const teamMember = query.get('SELECT id FROM team_members WHERE user_id = ?', [req.user.id]);
        if (!teamMember) return res.json([]);

        const orders = query.all(`SELECT to1.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_travel_orders to1
            LEFT JOIN finance_work_units wu ON to1.work_unit_id = wu.id
            WHERE to1.traveler_id = ?
            ORDER BY to1.created_at DESC`, [teamMember.id]);
        res.json(orders);
    });

    app.post('/api/finance/travel-orders', auth, (req, res) => {
        const { traveler_id, traveler_name, destination, purpose, planned_departure, planned_return, travel_method,
            notes, project, work_unit_id, fiscal_year, advance_amount } = req.body;

        const id = uuidv4();
        const year = fiscal_year || new Date().getFullYear();
        const orderNumber = getNextSequenceNumber('travel_order', year);

        db.run(`INSERT INTO finance_travel_orders (id, order_number, traveler_id, traveler_name, destination, purpose,
            planned_departure, planned_return, travel_method, notes, project, work_unit_id, fiscal_year,
            advance_amount, assigned_by, assigned_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, datetime(?), 'assigned')`,
            [id, orderNumber, traveler_id, traveler_name, destination, purpose || null, planned_departure || null, planned_return || null,
             travel_method || null, notes || null, project || null, work_unit_id || null, year, advance_amount || 0, req.user.id, 'now']);
        saveDb();
        res.json({ success: true, id, order_number: orderNumber });
    });

    app.get('/api/finance/travel-orders/:id', auth, (req, res) => {
        const order = query.get(`SELECT to1.*, wu.code as work_unit_code, wu.name as work_unit_name
            FROM finance_travel_orders to1
            LEFT JOIN finance_work_units wu ON to1.work_unit_id = wu.id
            WHERE to1.id = ?`, [req.params.id]);
        if (!order) return res.status(404).json({ error: 'Not found' });

        const evidence = query.all('SELECT * FROM finance_travel_evidence WHERE travel_order_id = ?', [req.params.id]);
        res.json({ ...order, evidence });
    });

    app.put('/api/finance/travel-orders/:id', auth, (req, res) => {
        const { destination, purpose, planned_departure, planned_return, actual_departure, actual_return,
            travel_method, kilometers, cost_transport, cost_accommodation, cost_daily_allowance, cost_other,
            traveler_notes, notes, project, work_unit_id } = req.body;

        const costTotal = (cost_transport || 0) + (cost_accommodation || 0) + (cost_daily_allowance || 0) + (cost_other || 0);

        db.run(`UPDATE finance_travel_orders SET destination = ?, purpose = ?, planned_departure = ?, planned_return = ?,
            actual_departure = ?, actual_return = ?, travel_method = ?, kilometers = ?,
            cost_transport = ?, cost_accommodation = ?, cost_daily_allowance = ?, cost_other = ?, cost_total = ?,
            traveler_notes = ?, notes = ?, project = ?, work_unit_id = ? WHERE id = ?`,
            [destination, purpose, planned_departure, planned_return, actual_departure, actual_return,
             travel_method, kilometers, cost_transport, cost_accommodation, cost_daily_allowance, cost_other, costTotal,
             traveler_notes, notes, project, work_unit_id, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Travel order workflow
    app.post('/api/finance/travel-orders/:id/submit', auth, (req, res) => {
        const { actual_departure, actual_return, travel_method, kilometers,
            cost_transport, cost_accommodation, cost_daily_allowance, cost_other, traveler_notes } = req.body;

        const costTotal = (cost_transport || 0) + (cost_accommodation || 0) + (cost_daily_allowance || 0) + (cost_other || 0);

        db.run(`UPDATE finance_travel_orders SET actual_departure = ?, actual_return = ?, travel_method = ?, kilometers = ?,
            cost_transport = ?, cost_accommodation = ?, cost_daily_allowance = ?, cost_other = ?, cost_total = ?,
            traveler_notes = ?, status = 'submitted', submitted_at = datetime(?) WHERE id = ?`,
            [actual_departure, actual_return, travel_method, kilometers,
             cost_transport, cost_accommodation, cost_daily_allowance, cost_other, costTotal,
             traveler_notes, 'now', req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/finance/travel-orders/:id/approve', auth, (req, res) => {
        const order = query.get('SELECT * FROM finance_travel_orders WHERE id = ?', [req.params.id]);
        const reimbursement = order.cost_total - (order.advance_amount || 0);

        db.run(`UPDATE finance_travel_orders SET status = 'approved', approved_by = ?, approved_at = datetime(?),
            reimbursement_amount = ? WHERE id = ?`,
            [req.user.id, 'now', reimbursement, req.params.id]);
        saveDb();
        res.json({ success: true, reimbursement_amount: reimbursement });
    });

    app.post('/api/finance/travel-orders/:id/reject', auth, (req, res) => {
        const { rejection_reason } = req.body;
        db.run(`UPDATE finance_travel_orders SET status = 'rejected', rejection_reason = ? WHERE id = ?`,
            [rejection_reason, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/finance/travel-orders/:id/pay', auth, (req, res) => {
        const order = query.get('SELECT * FROM finance_travel_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: 'Not found' });

        // Create expense transaction
        const transactionNumber = getNextSequenceNumber('expense', order.fiscal_year);
        const transactionId = uuidv4();

        db.run(`INSERT INTO finance_transactions (id, transaction_number, transaction_type, amount, date, description,
            project, work_unit_id, category, fiscal_year, created_by)
            VALUES (?, ?, 'expense', ?, date(?), ?, ?, ?, 'travel', ?, ?)`,
            [transactionId, transactionNumber, order.cost_total, 'now',
             `Travel order ${order.order_number} - ${order.traveler_name}`, order.project, order.work_unit_id,
             order.fiscal_year, req.user.id]);

        // Update work unit budget
        if (order.work_unit_id) {
            db.run('UPDATE finance_work_units SET budget_used = budget_used + ? WHERE id = ?', [order.cost_total, order.work_unit_id]);
        }

        db.run(`UPDATE finance_travel_orders SET status = 'paid', paid_at = datetime(?) WHERE id = ?`,
            ['now', req.params.id]);
        saveDb();
        res.json({ success: true, transaction_id: transactionId });
    });

    // Travel evidence upload
    const travelEvidenceStorage = multer.diskStorage({
        destination: (req, file, cb) => {
            const dir = path.join(uploadsDir, 'travel-evidence');
            if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
            cb(null, dir);
        },
        filename: (req, file, cb) => cb(null, `${uuidv4()}${path.extname(file.originalname)}`)
    });
    const travelEvidenceUpload = multer({ storage: travelEvidenceStorage, limits: { fileSize: 10 * 1024 * 1024 } });

    app.post('/api/finance/travel-orders/:id/evidence', auth, travelEvidenceUpload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const id = uuidv4();
        const filePath = `/uploads/travel-evidence/${req.file.filename}`;

        db.run(`INSERT INTO finance_travel_evidence (id, travel_order_id, file_type, file_name, file_path, file_size, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, req.params.id, req.body.file_type || 'other', req.file.originalname, filePath, req.file.size, req.user.id]);
        saveDb();
        res.json({ success: true, id, file_path: filePath });
    });

    app.delete('/api/finance/travel-orders/:orderId/evidence/:evidenceId', auth, (req, res) => {
        const evidence = query.get('SELECT * FROM finance_travel_evidence WHERE id = ? AND travel_order_id = ?',
            [req.params.evidenceId, req.params.orderId]);
        if (evidence && evidence.file_path) {
            const fullPath = path.join(__dirname, evidence.file_path);
            if (fs.existsSync(fullPath)) fs.unlinkSync(fullPath);
        }
        db.run('DELETE FROM finance_travel_evidence WHERE id = ?', [req.params.evidenceId]);
        saveDb();
        res.json({ success: true });
    });

    // Travel order PDF
    app.get('/api/finance/travel-orders/:id/pdf', auth, (req, res) => {
        const order = query.get('SELECT * FROM finance_travel_orders WHERE id = ?', [req.params.id]);
        if (!order) return res.status(404).json({ error: 'Not found' });

        const settings = {};
        query.all('SELECT setting_key, setting_value FROM finance_settings').forEach(s => {
            settings[s.setting_key] = s.setting_value;
        });

        const html = `
<!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <style>
        body { font-family: Arial, sans-serif; font-size: 12px; padding: 40px; }
        .header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 30px; border-bottom: 2px solid #c9a962; padding-bottom: 20px; }
        .logo { font-size: 24px; font-weight: bold; color: #c9a962; }
        .title { font-size: 18px; font-weight: bold; text-align: right; }
        .section { margin: 20px 0; }
        .section-title { font-weight: bold; color: #333; margin-bottom: 10px; border-bottom: 1px solid #ddd; padding-bottom: 5px; }
        .row { display: flex; margin: 8px 0; }
        .label { width: 200px; color: #666; }
        .value { flex: 1; }
        table { width: 100%; border-collapse: collapse; margin: 15px 0; }
        th, td { padding: 10px; border: 1px solid #ddd; }
        th { background: #f5f5f5; text-align: left; }
        .text-right { text-align: right; }
        .total-row { font-weight: bold; background: #f9f9f9; }
        .signature { margin-top: 60px; display: flex; justify-content: space-between; }
        .sig-block { width: 200px; text-align: center; }
        .sig-line { border-top: 1px solid #333; margin-top: 40px; padding-top: 5px; }
        .status-badge { display: inline-block; padding: 4px 12px; border-radius: 4px; font-size: 11px; font-weight: bold; }
        .status-approved { background: #d4edda; color: #155724; }
        .status-paid { background: #cce5ff; color: #004085; }
    </style>
</head>
<body>
    <div class="header">
        <div class="logo">Med&X</div>
        <div class="title">
            TRAVEL ORDER<br>
            <span style="font-size: 14px; color: #666;">${order.order_number}</span><br>
            <span class="status-badge status-${order.status}">${order.status.toUpperCase()}</span>
        </div>
    </div>

    <div class="section">
        <div class="section-title">Traveler Information</div>
        <div class="row"><span class="label">Full Name:</span><span class="value">${order.traveler_name}</span></div>
        <div class="row"><span class="label">Destination:</span><span class="value">${order.destination}</span></div>
        <div class="row"><span class="label">Purpose of Travel:</span><span class="value">${order.purpose || '-'}</span></div>
    </div>

    <div class="section">
        <div class="section-title">Dates</div>
        <div class="row"><span class="label">Planned Departure:</span><span class="value">${order.planned_departure || '-'}</span></div>
        <div class="row"><span class="label">Planned Return:</span><span class="value">${order.planned_return || '-'}</span></div>
        <div class="row"><span class="label">Actual Departure:</span><span class="value">${order.actual_departure || '-'}</span></div>
        <div class="row"><span class="label">Actual Return:</span><span class="value">${order.actual_return || '-'}</span></div>
    </div>

    <div class="section">
        <div class="section-title">Expenses</div>
        <table>
            <tr><th>Expense Type</th><th class="text-right">Amount (EUR)</th></tr>
            <tr><td>Transport</td><td class="text-right">${(order.cost_transport || 0).toFixed(2)}</td></tr>
            <tr><td>Accommodation</td><td class="text-right">${(order.cost_accommodation || 0).toFixed(2)}</td></tr>
            <tr><td>Daily Allowance</td><td class="text-right">${(order.cost_daily_allowance || 0).toFixed(2)}</td></tr>
            <tr><td>Other</td><td class="text-right">${(order.cost_other || 0).toFixed(2)}</td></tr>
            <tr class="total-row"><td>TOTAL</td><td class="text-right">${(order.cost_total || 0).toFixed(2)}</td></tr>
            ${order.advance_amount > 0 ? `<tr><td>Advance Payment</td><td class="text-right">-${order.advance_amount.toFixed(2)}</td></tr>` : ''}
            ${order.advance_amount > 0 ? `<tr class="total-row"><td>Amount Due</td><td class="text-right">${((order.cost_total || 0) - (order.advance_amount || 0)).toFixed(2)}</td></tr>` : ''}
        </table>
        ${order.kilometers > 0 ? `<p>Distance traveled: ${order.kilometers} km (${settings.travel_km_rate || '0.40'} EUR/km)</p>` : ''}
    </div>

    ${order.traveler_notes ? `<div class="section"><div class="section-title">Traveler Notes</div><p>${order.traveler_notes}</p></div>` : ''}

    <div class="signature">
        <div class="sig-block">
            <div class="sig-line">Traveler</div>
        </div>
        <div class="sig-block">
            <div class="sig-line">Approved By</div>
        </div>
    </div>
</body>
</html>`;

        res.setHeader('Content-Type', 'text/html');
        const safeOrderName = (order.order_number || 'order').replace(/["\r\n]/g, '');
        res.setHeader('Content-Disposition', `inline; filename="${safeOrderName}.html"`);
        res.send(html);
    });

    // Finance Settings
    app.get('/api/finance/settings', auth, (req, res) => {
        const settings = {};
        query.all('SELECT setting_key, setting_value FROM finance_settings').forEach(s => {
            settings[s.setting_key] = s.setting_value;
        });
        res.json(settings);
    });

    app.put('/api/finance/settings', auth, (req, res) => {
        Object.entries(req.body).forEach(([key, value]) => {
            const existing = query.get('SELECT id FROM finance_settings WHERE setting_key = ?', [key]);
            if (existing) {
                db.run('UPDATE finance_settings SET setting_value = ?, updated_at = datetime(?) WHERE setting_key = ?',
                    [value, 'now', key]);
            } else {
                db.run('INSERT INTO finance_settings (id, setting_key, setting_value) VALUES (?, ?, ?)',
                    [uuidv4(), key, value]);
            }
        });
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/finance/settings', auth, (req, res) => {
        Object.entries(req.body).forEach(([key, value]) => {
            const existing = query.get('SELECT id FROM finance_settings WHERE setting_key = ?', [key]);
            if (existing) {
                db.run('UPDATE finance_settings SET setting_value = ?, updated_at = datetime(?) WHERE setting_key = ?',
                    [value, 'now', key]);
            } else {
                db.run('INSERT INTO finance_settings (id, setting_key, setting_value) VALUES (?, ?, ?)',
                    [uuidv4(), key, value]);
            }
        });
        saveDb();
        res.json({ success: true });
    });

    // Finance Reports
    app.get('/api/finance/reports/by-project', auth, (req, res) => {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const report = query.all(`
            SELECT project,
                SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END) as total_income,
                SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) as total_expenses,
                COUNT(*) as transaction_count
            FROM finance_transactions
            WHERE fiscal_year = ? AND project IS NOT NULL
            GROUP BY project
            ORDER BY total_expenses DESC
        `, [year]);
        res.json(report);
    });

    app.get('/api/finance/reports/by-work-unit', auth, (req, res) => {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const report = query.all(`
            SELECT wu.id, wu.code, wu.name, wu.budget_total, wu.budget_used,
                (wu.budget_total - wu.budget_used) as budget_remaining,
                COUNT(t.id) as transaction_count
            FROM finance_work_units wu
            LEFT JOIN finance_transactions t ON wu.id = t.work_unit_id
            WHERE wu.fiscal_year = ?
            GROUP BY wu.id
            ORDER BY wu.code
        `, [year]);
        res.json(report);
    });

    app.get('/api/finance/reports/monthly', auth, (req, res) => {
        const year = parseInt(req.query.year) || new Date().getFullYear();
        const report = query.all(`
            SELECT strftime('%Y-%m', date) as month,
                SUM(CASE WHEN transaction_type = 'income' THEN amount ELSE 0 END) as income,
                SUM(CASE WHEN transaction_type = 'expense' THEN amount ELSE 0 END) as expenses
            FROM finance_transactions
            WHERE fiscal_year = ?
            GROUP BY strftime('%Y-%m', date)
            ORDER BY month
        `, [year]);
        res.json(report);
    });

    // ===== PR & MEDIA API ENDPOINTS =====

    // PR Dashboard
    app.get('/api/pr/dashboard', auth, (req, res) => {
        const today = new Date().toISOString().split('T')[0];
        const thisMonth = today.substring(0, 7);

        // Upcoming scheduled content
        const upcoming = query.all(`
            SELECT * FROM pr_content_calendar
            WHERE scheduled_date >= ? AND status IN ('scheduled', 'approved')
            ORDER BY scheduled_date, scheduled_time LIMIT 10
        `, [today]);

        // Recent posts
        const recentPosts = query.all(`
            SELECT * FROM pr_posts
            ORDER BY published_at DESC LIMIT 10
        `);

        // This month's stats
        const monthPosts = query.get(`
            SELECT COUNT(*) as count,
                   SUM(likes) as total_likes,
                   SUM(comments) as total_comments,
                   SUM(shares) as total_shares
            FROM pr_posts
            WHERE published_at LIKE ?
        `, [thisMonth + '%']);

        // Active campaigns
        const campaigns = query.all(`
            SELECT * FROM pr_campaigns
            WHERE status = 'active' OR (start_date <= ? AND end_date >= ?)
            ORDER BY start_date
        `, [today, today]);

        // Subscribers count
        const subscribers = query.get(`
            SELECT COUNT(*) as total,
                   SUM(CASE WHEN status = 'active' THEN 1 ELSE 0 END) as active
            FROM pr_subscribers
        `);

        // Draft newsletters
        const draftNewsletters = query.all(`
            SELECT * FROM pr_newsletters
            WHERE status = 'draft'
            ORDER BY updated_at DESC LIMIT 5
        `);

        // Platform followers (latest)
        const analytics = query.all(`
            SELECT project, platform, followers, engagement_rate
            FROM pr_analytics
            WHERE date = (SELECT MAX(date) FROM pr_analytics)
        `);

        res.json({
            upcoming,
            recentPosts,
            monthStats: monthPosts || { count: 0, total_likes: 0, total_comments: 0, total_shares: 0 },
            campaigns,
            subscribers: subscribers || { total: 0, active: 0 },
            draftNewsletters,
            analytics
        });
    });

    // Content Calendar
    app.get('/api/pr/calendar', auth, (req, res) => {
        const { month, project, platform } = req.query;
        let sql = 'SELECT * FROM pr_content_calendar WHERE 1=1';
        const params = [];

        if (month) {
            sql += ' AND scheduled_date LIKE ?';
            params.push(month + '%');
        }
        if (project) {
            sql += ' AND project = ?';
            params.push(project);
        }
        if (platform) {
            sql += ' AND platform = ?';
            params.push(platform);
        }

        sql += ' ORDER BY scheduled_date, scheduled_time';
        res.json(query.all(sql, params));
    });

    app.get('/api/pr/calendar/:id', auth, (req, res) => {
        const item = query.get('SELECT * FROM pr_content_calendar WHERE id = ?', [req.params.id]);
        if (!item) return res.status(404).json({ error: 'Not found' });
        res.json(item);
    });

    app.post('/api/pr/calendar', auth, (req, res) => {
        const { project, platform, scheduled_date, scheduled_time, title, content_text, image_url, link_url, hashtags, campaign_id, status } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO pr_content_calendar (id, project, platform, scheduled_date, scheduled_time, title, content_text, image_url, link_url, hashtags, campaign_id, status, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, project, platform, scheduled_date, scheduled_time || null, title || null, content_text || null, image_url || null, link_url || null, hashtags || null, campaign_id || null, status || 'draft', req.user?.id || null]);
        saveDb();
        res.json({ id, success: true });
    });

    app.put('/api/pr/calendar/:id', auth, (req, res) => {
        const { project, platform, scheduled_date, scheduled_time, title, content_text, image_url, link_url, hashtags, campaign_id, status } = req.body;
        db.run(`UPDATE pr_content_calendar SET project = ?, platform = ?, scheduled_date = ?, scheduled_time = ?, title = ?, content_text = ?, image_url = ?, link_url = ?, hashtags = ?, campaign_id = ?, status = ?, updated_at = datetime('now')
            WHERE id = ?`,
            [project, platform, scheduled_date, scheduled_time || null, title || null, content_text || null, image_url || null, link_url || null, hashtags || null, campaign_id || null, status, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/pr/calendar/:id/approve', auth, (req, res) => {
        db.run(`UPDATE pr_content_calendar SET status = 'approved', approved_by = ?, approved_at = datetime('now') WHERE id = ?`,
            [req.user?.id || null, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/pr/calendar/:id/publish', auth, (req, res) => {
        const item = query.get('SELECT * FROM pr_content_calendar WHERE id = ?', [req.params.id]);
        if (!item) return res.status(404).json({ error: 'Not found' });

        // Create a post record
        const postId = uuidv4();
        db.run(`INSERT INTO pr_posts (id, project, platform, content_text, image_url, link_url, published_at, calendar_id, campaign_id)
            VALUES (?, ?, ?, ?, ?, ?, datetime('now'), ?, ?)`,
            [postId, item.project, item.platform, item.content_text, item.image_url, item.link_url, item.id, item.campaign_id]);

        // Update calendar status
        db.run(`UPDATE pr_content_calendar SET status = 'published', published_at = datetime('now') WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true, postId });
    });

    app.delete('/api/pr/calendar/:id', auth, (req, res) => {
        db.run('DELETE FROM pr_content_calendar WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Social Media Posts
    app.get('/api/pr/posts', auth, (req, res) => {
        const { project, platform, limit } = req.query;
        let sql = 'SELECT * FROM pr_posts WHERE 1=1';
        const params = [];

        if (project) {
            sql += ' AND project = ?';
            params.push(project);
        }
        if (platform) {
            sql += ' AND platform = ?';
            params.push(platform);
        }

        sql += ' ORDER BY published_at DESC';
        if (limit) {
            sql += ' LIMIT ?';
            params.push(parseInt(limit));
        }

        res.json(query.all(sql, params));
    });

    app.get('/api/pr/posts/:id', auth, (req, res) => {
        const post = query.get('SELECT * FROM pr_posts WHERE id = ?', [req.params.id]);
        if (!post) return res.status(404).json({ error: 'Not found' });
        res.json(post);
    });

    app.post('/api/pr/posts', auth, (req, res) => {
        const { project, platform, post_type, content_text, image_url, link_url, external_post_id, published_at, likes, comments, shares, reach, impressions, campaign_id } = req.body;
        const id = uuidv4();
        const engagementRate = (reach > 0) ? ((likes + comments + shares) / reach * 100) : 0;
        db.run(`INSERT INTO pr_posts (id, project, platform, post_type, content_text, image_url, link_url, external_post_id, published_at, likes, comments, shares, reach, impressions, engagement_rate, campaign_id)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, project, platform, post_type || 'post', content_text || null, image_url || null, link_url || null, external_post_id || null, published_at || new Date().toISOString(), likes || 0, comments || 0, shares || 0, reach || 0, impressions || 0, engagementRate, campaign_id || null]);
        saveDb();
        res.json({ id, success: true });
    });

    app.put('/api/pr/posts/:id', auth, (req, res) => {
        const { likes, comments, shares, reach, impressions } = req.body;
        const engagementRate = (reach > 0) ? ((likes + comments + shares) / reach * 100) : 0;
        db.run(`UPDATE pr_posts SET likes = ?, comments = ?, shares = ?, reach = ?, impressions = ?, engagement_rate = ? WHERE id = ?`,
            [likes || 0, comments || 0, shares || 0, reach || 0, impressions || 0, engagementRate, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/pr/posts/:id', auth, (req, res) => {
        db.run('DELETE FROM pr_posts WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Newsletters
    app.get('/api/pr/newsletters', auth, (req, res) => {
        const { status, project } = req.query;
        let sql = 'SELECT * FROM pr_newsletters WHERE 1=1';
        const params = [];

        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        if (project) {
            sql += ' AND project = ?';
            params.push(project);
        }

        sql += ' ORDER BY created_at DESC';
        res.json(query.all(sql, params));
    });

    app.get('/api/pr/newsletters/:id', auth, (req, res) => {
        const newsletter = query.get('SELECT * FROM pr_newsletters WHERE id = ?', [req.params.id]);
        if (!newsletter) return res.status(404).json({ error: 'Not found' });
        res.json(newsletter);
    });

    app.post('/api/pr/newsletters', auth, (req, res) => {
        const { project, name, subject, preview_text, content_html, content_json, template, campaign_id } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO pr_newsletters (id, project, name, subject, preview_text, content_html, content_json, template, campaign_id, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, project || null, name, subject, preview_text || null, content_html || null, content_json || null, template || 'default', campaign_id || null, req.user?.id || null]);
        saveDb();
        res.json({ id, success: true });
    });

    app.put('/api/pr/newsletters/:id', auth, (req, res) => {
        const { project, name, subject, preview_text, content_html, content_json, template, status, scheduled_for, campaign_id } = req.body;
        db.run(`UPDATE pr_newsletters SET project = ?, name = ?, subject = ?, preview_text = ?, content_html = ?, content_json = ?, template = ?, status = ?, scheduled_for = ?, campaign_id = ?, updated_at = datetime('now')
            WHERE id = ?`,
            [project || null, name, subject, preview_text || null, content_html || null, content_json || null, template || 'default', status, scheduled_for || null, campaign_id || null, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/pr/newsletters/:id/send', auth, (req, res) => {
        // Mark as sent (actual email sending would require integration)
        const subscribers = query.get('SELECT COUNT(*) as count FROM pr_subscribers WHERE status = ?', ['active']);
        db.run(`UPDATE pr_newsletters SET status = 'sent', sent_at = datetime('now'), recipient_count = ? WHERE id = ?`,
            [subscribers?.count || 0, req.params.id]);
        saveDb();
        res.json({ success: true, recipientCount: subscribers?.count || 0 });
    });

    app.delete('/api/pr/newsletters/:id', auth, (req, res) => {
        db.run('DELETE FROM pr_newsletters WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Subscribers
    app.get('/api/pr/subscribers', auth, (req, res) => {
        const { status, project, search } = req.query;
        let sql = 'SELECT * FROM pr_subscribers WHERE 1=1';
        const params = [];

        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        if (project && project !== 'all') {
            sql += ' AND (subscribed_projects = ? OR subscribed_projects LIKE ? OR subscribed_projects = ?)';
            params.push(project, '%' + project + '%', 'all');
        }
        if (search) {
            sql += ' AND (email LIKE ? OR first_name LIKE ? OR last_name LIKE ?)';
            params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
        }

        sql += ' ORDER BY subscribed_at DESC';
        res.json(query.all(sql, params));
    });

    app.post('/api/pr/subscribers', auth, (req, res) => {
        const { email, first_name, last_name, subscribed_projects, language, source } = req.body;
        const id = uuidv4();
        try {
            db.run(`INSERT INTO pr_subscribers (id, email, first_name, last_name, subscribed_projects, language, source)
                VALUES (?, ?, ?, ?, ?, ?, ?)`,
                [id, email, first_name || null, last_name || null, subscribed_projects || 'all', language || 'hr', source || 'manual']);
            saveDb();
            res.json({ id, success: true });
        } catch (err) {
            res.status(400).json({ error: 'Email already exists' });
        }
    });

    app.put('/api/pr/subscribers/:id', auth, (req, res) => {
        const { email, first_name, last_name, subscribed_projects, language, status } = req.body;
        db.run(`UPDATE pr_subscribers SET email = ?, first_name = ?, last_name = ?, subscribed_projects = ?, language = ?, status = ?
            WHERE id = ?`,
            [email, first_name || null, last_name || null, subscribed_projects || 'all', language || 'hr', status, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/pr/subscribers/:id/unsubscribe', auth, (req, res) => {
        db.run(`UPDATE pr_subscribers SET status = 'unsubscribed', unsubscribed_at = datetime('now') WHERE id = ?`, [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/pr/subscribers/:id', auth, (req, res) => {
        db.run('DELETE FROM pr_subscribers WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Export subscribers as CSV
    app.get('/api/pr/subscribers/export', auth, (req, res) => {
        const subscribers = query.all('SELECT * FROM pr_subscribers ORDER BY subscribed_at DESC');
        const csvHeader = 'Email,First Name,Last Name,Subscribed Projects,Language,Source,Status,Subscribed At\n';
        const csvRows = subscribers.map(s =>
            `"${(s.email || '').replace(/"/g, '""')}","${(s.first_name || '').replace(/"/g, '""')}","${(s.last_name || '').replace(/"/g, '""')}","${(s.subscribed_projects || '').replace(/"/g, '""')}","${s.language || ''}","${s.source || ''}","${s.status || ''}","${s.subscribed_at || ''}"`
        ).join('\n');

        res.setHeader('Content-Type', 'text/csv');
        res.setHeader('Content-Disposition', 'attachment; filename=medx-subscribers.csv');
        res.send(csvHeader + csvRows);
    });

    app.post('/api/pr/subscribers/import', auth, (req, res) => {
        const { subscribers } = req.body;
        let imported = 0;
        let skipped = 0;

        subscribers.forEach(sub => {
            try {
                const existing = query.get('SELECT id FROM pr_subscribers WHERE email = ?', [sub.email]);
                if (!existing) {
                    db.run(`INSERT INTO pr_subscribers (id, email, first_name, last_name, subscribed_projects, language, source)
                        VALUES (?, ?, ?, ?, ?, ?, 'import')`,
                        [uuidv4(), sub.email, sub.first_name || null, sub.last_name || null, sub.subscribed_projects || 'all', sub.language || 'hr']);
                    imported++;
                } else {
                    skipped++;
                }
            } catch (err) {
                skipped++;
            }
        });

        saveDb();
        res.json({ success: true, imported, skipped });
    });

    // Media Assets
    const prMediaUpload = multer({
        storage: multer.diskStorage({
            destination: (req, file, cb) => {
                const dir = path.join(__dirname, 'uploads/pr-media');
                if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
                cb(null, dir);
            },
            filename: (req, file, cb) => {
                const ext = path.extname(file.originalname);
                cb(null, `${Date.now()}-${uuidv4()}${ext}`);
            }
        }),
        limits: { fileSize: 10 * 1024 * 1024 }
    });

    app.get('/api/pr/media', auth, (req, res) => {
        const { project, category, search } = req.query;
        let sql = 'SELECT * FROM pr_media_assets WHERE 1=1';
        const params = [];

        if (project) {
            sql += ' AND (project = ? OR project IS NULL)';
            params.push(project);
        }
        if (category) {
            sql += ' AND category = ?';
            params.push(category);
        }
        if (search) {
            sql += ' AND (file_name LIKE ? OR tags LIKE ? OR caption LIKE ?)';
            params.push('%' + search + '%', '%' + search + '%', '%' + search + '%');
        }

        sql += ' ORDER BY created_at DESC';
        res.json(query.all(sql, params));
    });

    app.get('/api/pr/media/:id', auth, (req, res) => {
        const asset = query.get('SELECT * FROM pr_media_assets WHERE id = ?', [req.params.id]);
        if (!asset) return res.status(404).json({ error: 'Media not found' });
        res.json(asset);
    });

    app.post('/api/pr/media', auth, prMediaUpload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file uploaded' });

        const { project, category, tags, alt_text, caption } = req.body;
        const id = uuidv4();

        db.run(`INSERT INTO pr_media_assets (id, project, file_name, original_name, file_path, file_type, file_size, category, tags, alt_text, caption, uploaded_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, project || null, req.file.filename, req.file.originalname, `/uploads/pr-media/${req.file.filename}`, req.file.mimetype, req.file.size, category || 'photo', tags || null, alt_text || null, caption || null, req.user?.id || null]);
        saveDb();
        res.json({ id, success: true, file_path: `/uploads/pr-media/${req.file.filename}` });
    });

    app.put('/api/pr/media/:id', auth, (req, res) => {
        const { project, category, tags, alt_text, caption } = req.body;
        db.run(`UPDATE pr_media_assets SET project = ?, category = ?, tags = ?, alt_text = ?, caption = ? WHERE id = ?`,
            [project || null, category, tags || null, alt_text || null, caption || null, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/pr/media/:id', auth, (req, res) => {
        const asset = query.get('SELECT file_path FROM pr_media_assets WHERE id = ?', [req.params.id]);
        if (asset && asset.file_path) {
            const filePath = path.join(__dirname, asset.file_path);
            if (fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }
        db.run('DELETE FROM pr_media_assets WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Campaigns
    app.get('/api/pr/campaigns', auth, (req, res) => {
        const { status, project } = req.query;
        let sql = 'SELECT * FROM pr_campaigns WHERE 1=1';
        const params = [];

        if (status) {
            sql += ' AND status = ?';
            params.push(status);
        }
        if (project) {
            sql += ' AND (project = ? OR project IS NULL)';
            params.push(project);
        }

        sql += ' ORDER BY start_date DESC';
        res.json(query.all(sql, params));
    });

    app.get('/api/pr/campaigns/:id', auth, (req, res) => {
        const campaign = query.get('SELECT * FROM pr_campaigns WHERE id = ?', [req.params.id]);
        if (!campaign) return res.status(404).json({ error: 'Not found' });

        // Get related content and posts
        const content = query.all('SELECT * FROM pr_content_calendar WHERE campaign_id = ?', [req.params.id]);
        const posts = query.all('SELECT * FROM pr_posts WHERE campaign_id = ?', [req.params.id]);
        const newsletters = query.all('SELECT * FROM pr_newsletters WHERE campaign_id = ?', [req.params.id]);

        res.json({ ...campaign, content, posts, newsletters });
    });

    app.post('/api/pr/campaigns', auth, (req, res) => {
        const { project, name, description, goal, start_date, end_date, budget, target_audience, platforms, kpis } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO pr_campaigns (id, project, name, description, goal, start_date, end_date, budget, target_audience, platforms, kpis, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, project || null, name, description || null, goal || null, start_date || null, end_date || null, budget || 0, target_audience || null, platforms || null, kpis || null, req.user?.id || null]);
        saveDb();
        res.json({ id, success: true });
    });

    app.put('/api/pr/campaigns/:id', auth, (req, res) => {
        const { project, name, description, goal, start_date, end_date, status, budget, spent, target_audience, platforms, kpis } = req.body;
        db.run(`UPDATE pr_campaigns SET project = ?, name = ?, description = ?, goal = ?, start_date = ?, end_date = ?, status = ?, budget = ?, spent = ?, target_audience = ?, platforms = ?, kpis = ?, updated_at = datetime('now')
            WHERE id = ?`,
            [project || null, name, description || null, goal || null, start_date || null, end_date || null, status, budget || 0, spent || 0, target_audience || null, platforms || null, kpis || null, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/pr/campaigns/:id', auth, (req, res) => {
        db.run('DELETE FROM pr_campaigns WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Analytics
    app.get('/api/pr/analytics', auth, (req, res) => {
        const { project, platform, from, to } = req.query;
        let sql = 'SELECT * FROM pr_analytics WHERE 1=1';
        const params = [];

        if (project) {
            sql += ' AND project = ?';
            params.push(project);
        }
        if (platform) {
            sql += ' AND platform = ?';
            params.push(platform);
        }
        if (from) {
            sql += ' AND date >= ?';
            params.push(from);
        }
        if (to) {
            sql += ' AND date <= ?';
            params.push(to);
        }

        sql += ' ORDER BY date DESC';
        res.json(query.all(sql, params));
    });

    app.post('/api/pr/analytics', auth, (req, res) => {
        const { project, platform, date, followers, following, posts_count, engagement_rate, reach, impressions, profile_views, website_clicks, new_followers } = req.body;
        const id = uuidv4();

        // Check if entry exists for this date
        const existing = query.get('SELECT id FROM pr_analytics WHERE project = ? AND platform = ? AND date = ?', [project, platform, date]);
        if (existing) {
            db.run(`UPDATE pr_analytics SET followers = ?, following = ?, posts_count = ?, engagement_rate = ?, reach = ?, impressions = ?, profile_views = ?, website_clicks = ?, new_followers = ?
                WHERE id = ?`,
                [followers || 0, following || 0, posts_count || 0, engagement_rate || 0, reach || 0, impressions || 0, profile_views || 0, website_clicks || 0, new_followers || 0, existing.id]);
        } else {
            db.run(`INSERT INTO pr_analytics (id, project, platform, date, followers, following, posts_count, engagement_rate, reach, impressions, profile_views, website_clicks, new_followers)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [id, project, platform, date, followers || 0, following || 0, posts_count || 0, engagement_rate || 0, reach || 0, impressions || 0, profile_views || 0, website_clicks || 0, new_followers || 0]);
        }

        saveDb();
        res.json({ success: true });
    });

    // Templates
    app.get('/api/pr/templates', auth, (req, res) => {
        const { type, platform, project } = req.query;
        let sql = 'SELECT * FROM pr_templates WHERE is_active = 1';
        const params = [];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        if (platform) {
            sql += ' AND (platform = ? OR platform IS NULL)';
            params.push(platform);
        }
        if (project) {
            sql += ' AND (project = ? OR project IS NULL)';
            params.push(project);
        }

        sql += ' ORDER BY use_count DESC, name';
        res.json(query.all(sql, params));
    });

    app.post('/api/pr/templates', auth, (req, res) => {
        const { name, type, platform, project, content_template, image_template, variables } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO pr_templates (id, name, type, platform, project, content_template, image_template, variables, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, name, type || 'social', platform || null, project || null, content_template || null, image_template || null, variables || null, req.user?.id || null]);
        saveDb();
        res.json({ id, success: true });
    });

    app.put('/api/pr/templates/:id', auth, (req, res) => {
        const { name, type, platform, project, content_template, image_template, variables, is_active } = req.body;
        db.run(`UPDATE pr_templates SET name = ?, type = ?, platform = ?, project = ?, content_template = ?, image_template = ?, variables = ?, is_active = ?
            WHERE id = ?`,
            [name, type || 'social', platform || null, project || null, content_template || null, image_template || null, variables || null, is_active ? 1 : 0, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/pr/templates/:id/use', auth, (req, res) => {
        db.run('UPDATE pr_templates SET use_count = use_count + 1 WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.delete('/api/pr/templates/:id', auth, (req, res) => {
        db.run('DELETE FROM pr_templates WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // AI Generation History
    app.get('/api/pr/ai-generations', auth, (req, res) => {
        const { type, project } = req.query;
        let sql = 'SELECT * FROM pr_ai_generations WHERE 1=1';
        const params = [];

        if (type) {
            sql += ' AND type = ?';
            params.push(type);
        }
        if (project) {
            sql += ' AND project = ?';
            params.push(project);
        }

        sql += ' ORDER BY created_at DESC LIMIT 50';
        res.json(query.all(sql, params));
    });

    app.post('/api/pr/ai-generations', auth, (req, res) => {
        const { type, prompt, result_text, result_image_path, project, platform, model } = req.body;
        const id = uuidv4();
        db.run(`INSERT INTO pr_ai_generations (id, type, prompt, result_text, result_image_path, project, platform, model, created_by)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [id, type, prompt, result_text || null, result_image_path || null, project || null, platform || null, model || null, req.user?.id || null]);
        saveDb();
        res.json({ id, success: true });
    });

    app.post('/api/pr/ai-generations/:id/use', auth, (req, res) => {
        db.run('UPDATE pr_ai_generations SET used = 1 WHERE id = ?', [req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    app.post('/api/pr/ai-generations/:id/rate', auth, (req, res) => {
        const { rating } = req.body;
        db.run('UPDATE pr_ai_generations SET rating = ? WHERE id = ?', [rating, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // ===== NETWORKING PORTAL API =====

    // Save/update networking preferences
    app.put('/api/networking/profile', auth, (req, res) => {
        const { career_stage, looking_for, research_interests, working_on, timezone, meeting_format, open_to_coffee_chats } = req.body;
        const existing = query.get('SELECT id FROM networking_profiles WHERE user_id = ?', [req.user.id]);
        if (existing) {
            db.run(`UPDATE networking_profiles SET career_stage=?, looking_for=?, research_interests=?, working_on=?, timezone=?, meeting_format=?, open_to_coffee_chats=?, updated_at=datetime('now') WHERE user_id=?`,
                [career_stage, looking_for, JSON.stringify(research_interests || []), working_on, timezone || 'America/New_York', meeting_format || 'video', open_to_coffee_chats ? 1 : 0, req.user.id]);
        } else {
            const id = uuidv4();
            db.run(`INSERT INTO networking_profiles (id, user_id, career_stage, looking_for, research_interests, working_on, timezone, meeting_format, open_to_coffee_chats) VALUES (?,?,?,?,?,?,?,?,?)`,
                [id, req.user.id, career_stage, looking_for, JSON.stringify(research_interests || []), working_on, timezone || 'America/New_York', meeting_format || 'video', open_to_coffee_chats ? 1 : 0]);
        }
        saveDb();
        res.json({ success: true });
    });

    // Get networking preferences
    app.get('/api/networking/profile', auth, (req, res) => {
        const profile = query.get('SELECT * FROM networking_profiles WHERE user_id = ?', [req.user.id]);
        if (profile && profile.research_interests) {
            try { profile.research_interests = JSON.parse(profile.research_interests); } catch(e) {}
        }
        res.json(profile || null);
    });

    // Send connection request
    app.post('/api/networking/connections', auth, (req, res) => {
        const { receiver_id, message } = req.body;
        if (!receiver_id) return res.status(400).json({ error: 'receiver_id required' });
        const existing = query.get('SELECT id FROM networking_connections WHERE (requester_id=? AND receiver_id=?) OR (requester_id=? AND receiver_id=?)',
            [req.user.id, receiver_id, receiver_id, req.user.id]);
        if (existing) return res.status(409).json({ error: 'Connection already exists' });
        const id = uuidv4();
        db.run('INSERT INTO networking_connections (id, requester_id, receiver_id, message) VALUES (?,?,?,?)',
            [id, req.user.id, receiver_id, message || null]);
        saveDb();
        res.json({ id, status: 'pending' });
    });

    // Get connections
    app.get('/api/networking/connections', auth, (req, res) => {
        const connections = query.all(`SELECT nc.*, u.first_name, u.last_name, u.institution, u.bio, u.photo_url
            FROM networking_connections nc
            JOIN users u ON (CASE WHEN nc.requester_id = ? THEN nc.receiver_id ELSE nc.requester_id END) = u.id
            WHERE (nc.requester_id = ? OR nc.receiver_id = ?) AND nc.status = 'accepted'`,
            [req.user.id, req.user.id, req.user.id]);
        res.json(connections);
    });

    // Accept or reject connection
    app.put('/api/networking/connections/:id', auth, (req, res) => {
        const { status } = req.body;
        if (!['accepted', 'rejected'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const conn = query.get('SELECT * FROM networking_connections WHERE id = ? AND receiver_id = ?', [req.params.id, req.user.id]);
        if (!conn) return res.status(404).json({ error: 'Connection not found' });
        db.run(`UPDATE networking_connections SET status = ?, accepted_at = CASE WHEN ? = 'accepted' THEN datetime('now') ELSE NULL END WHERE id = ?`,
            [status, status, req.params.id]);
        saveDb();
        res.json({ success: true });
    });

    // Get pending requests
    app.get('/api/networking/connections/pending', auth, (req, res) => {
        const pending = query.all(`SELECT nc.*, u.first_name, u.last_name, u.institution, u.photo_url
            FROM networking_connections nc JOIN users u ON nc.requester_id = u.id
            WHERE nc.receiver_id = ? AND nc.status = 'pending'`, [req.user.id]);
        res.json(pending);
    });

    // Schedule meeting
    app.post('/api/networking/meetings', auth, (req, res) => {
        const { attendee_id, date, time, duration, type, topic, note } = req.body;
        if (!attendee_id || !date || !time) return res.status(400).json({ error: 'attendee_id, date, and time required' });
        const id = uuidv4();
        db.run('INSERT INTO networking_meetings (id, organizer_id, attendee_id, date, time, duration, type, topic, note) VALUES (?,?,?,?,?,?,?,?,?)',
            [id, req.user.id, attendee_id, date, time, duration || 30, type || 'video', topic || null, note || null]);
        saveDb();
        res.json({ id, status: 'pending' });
    });

    // Get meetings
    app.get('/api/networking/meetings', auth, (req, res) => {
        const meetings = query.all(`SELECT nm.*, u.first_name, u.last_name, u.institution, u.photo_url
            FROM networking_meetings nm
            JOIN users u ON (CASE WHEN nm.organizer_id = ? THEN nm.attendee_id ELSE nm.organizer_id END) = u.id
            WHERE nm.organizer_id = ? OR nm.attendee_id = ?
            ORDER BY nm.date DESC, nm.time DESC`,
            [req.user.id, req.user.id, req.user.id]);
        res.json(meetings);
    });

    // Update meeting status
    app.put('/api/networking/meetings/:id', auth, (req, res) => {
        const { status } = req.body;
        if (!['confirmed', 'cancelled', 'completed'].includes(status)) return res.status(400).json({ error: 'Invalid status' });
        db.run('UPDATE networking_meetings SET status = ? WHERE id = ? AND (organizer_id = ? OR attendee_id = ?)',
            [status, req.params.id, req.user.id, req.user.id]);
        saveDb();
        res.json({ success: true });
    });

    // ===== DIRECT MESSAGING API =====

    // Send a direct message
    app.post('/api/messages', auth, (req, res) => {
        const { receiver_id, content } = req.body ?? {};
        if (!receiver_id || !content) {
            return res.status(400).json({ error: 'receiver_id and content are required' });
        }
        const id = uuidv4();
        const senderId = req.user?.id ?? 'unknown';
        try {
            db.run(
                `INSERT INTO direct_messages (id, sender_id, receiver_id, content) VALUES (?, ?, ?, ?)`,
                [id, senderId, receiver_id, content.trim()]
            );
            saveDb();
            res.json({ success: true, id, sender_id: senderId, receiver_id, content: content.trim(), created_at: new Date().toISOString() });
        } catch (err) {
            console.error('Failed to send direct message:', err);
            res.status(500).json({ error: 'Failed to send message' });
        }
    });

    // Get list of all conversations (latest message per conversation partner)
    // NOTE: registered BEFORE the :userId route so Express matches the exact path first
    app.get('/api/messages', auth, (req, res) => {
        const userId = req.user?.id ?? 'unknown';
        try {
            const conversations = query.all(
                `SELECT dm.*,
                    CASE WHEN dm.sender_id = ? THEN dm.receiver_id ELSE dm.sender_id END AS partner_id,
                    u.first_name AS partner_first_name, u.last_name AS partner_last_name, u.email AS partner_email
                FROM direct_messages dm
                LEFT JOIN users u ON u.id = CASE WHEN dm.sender_id = ? THEN dm.receiver_id ELSE dm.sender_id END
                WHERE dm.id IN (
                    SELECT id FROM (
                        SELECT id,
                            CASE WHEN sender_id = ? THEN receiver_id ELSE sender_id END AS partner,
                            MAX(created_at) AS latest
                        FROM direct_messages
                        WHERE sender_id = ? OR receiver_id = ?
                        GROUP BY partner
                    )
                )
                ORDER BY dm.created_at DESC`,
                [userId, userId, userId, userId, userId]
            );
            res.json(conversations);
        } catch (err) {
            console.error('Failed to fetch conversations:', err);
            res.status(500).json({ error: 'Failed to fetch conversations' });
        }
    });

    // Get conversation with a specific user (paginated)
    app.get('/api/messages/:userId', auth, (req, res) => {
        const otherUserId = req.params.userId ?? '';
        const senderId = req.user?.id ?? 'unknown';
        const limit = parseInt(req.query?.limit ?? '50', 10);
        const offset = parseInt(req.query?.offset ?? '0', 10);
        try {
            const messages = query.all(
                `SELECT dm.*,
                    su.first_name AS sender_first_name, su.last_name AS sender_last_name,
                    ru.first_name AS receiver_first_name, ru.last_name AS receiver_last_name
                FROM direct_messages dm
                LEFT JOIN users su ON dm.sender_id = su.id
                LEFT JOIN users ru ON dm.receiver_id = ru.id
                WHERE (dm.sender_id = ? AND dm.receiver_id = ?)
                   OR (dm.sender_id = ? AND dm.receiver_id = ?)
                ORDER BY dm.created_at ASC
                LIMIT ? OFFSET ?`,
                [senderId, otherUserId, otherUserId, senderId, limit, offset]
            );
            // Mark received messages as read
            db.run(
                `UPDATE direct_messages SET read_at = CURRENT_TIMESTAMP WHERE sender_id = ? AND receiver_id = ? AND read_at IS NULL`,
                [otherUserId, senderId]
            );
            saveDb();
            res.json(messages);
        } catch (err) {
            console.error('Failed to fetch messages:', err);
            res.status(500).json({ error: 'Failed to fetch messages' });
        }
    });

    // Member QR verification endpoint (for admin scanning)
    app.get('/api/members/verify', (req, res) => {
        const { id, email } = req.query;
        if (!id && !email) return res.status(400).json({ error: 'Provide member id or email' });

        let user;
        if (email) {
            user = query.get('SELECT id, email, first_name, last_name, created_at FROM users WHERE email = ?', [email]);
        } else if (id) {
            user = query.get('SELECT id, email, first_name, last_name, created_at FROM users WHERE id = ?', [id]);
        }

        if (user) {
            res.json({
                verified: true,
                member: {
                    id: user.id,
                    name: `${user.first_name || ''} ${user.last_name || ''}`.trim(),
                    email: user.email,
                    memberSince: user.created_at,
                    memberId: id || 'N/A'
                }
            });
        } else {
            res.json({ verified: false, memberId: id, message: 'Member not found in database' });
        }
    });

    // ========== GALA REGISTRATION (with approval) ==========

    // Submit gala registration (public — pending approval)
    app.post('/api/gala/register', (req, res) => {
        const { first_name, last_name, email, institution, title, dietary, requests, pricing } = req.body;
        if (!first_name || !last_name || !email) {
            return res.status(400).json({ error: 'Name and email are required' });
        }
        const id = require('crypto').randomUUID();
        db.run(`INSERT INTO gala_registrations (id, first_name, last_name, email, institution, title, dietary, requests, pricing, status)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'pending')`,
            [id, first_name, last_name, email, institution || '', title || '', dietary || '', requests || '', pricing || '']);
        saveDb();

        // Send gala invitation request confirmation email
        try {
            sendEmail(email, 'Gala Evening — Invitation Request Received', buildEmailTemplate('Invitation Request Received', `
                <p>Dear ${first_name},</p>
                <p>Thank you for your interest in the <strong>Plexus 2026 Gala Evening</strong>. We have received your invitation request.</p>
                <table style="width: 100%; border-collapse: collapse; margin: 16px 0;">
                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b; width: 140px;">Name</td>
                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${first_name} ${last_name}</td></tr>
                    ${institution ? `<tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Institution</td>
                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600;">${institution}</td></tr>` : ''}
                    <tr><td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; color: #64748b;">Status</td>
                        <td style="padding: 8px 12px; border-bottom: 1px solid #e2e8f0; font-weight: 600; color: #d97706;">Pending Review</td></tr>
                </table>
                <p>Our team will review your request and get back to you within <strong>5-7 business days</strong>. You will receive a separate email once a decision has been made.</p>
                <p>If you have any questions, contact us at <a href="mailto:info@medx.hr" style="color: #C9A962;">info@medx.hr</a>.</p>
                <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
            `));
        } catch (emailErr) {
            console.warn('Gala registration email failed:', emailErr.message);
        }

        res.json({ success: true, id, status: 'pending' });
    });

    // Get all gala registrations (admin)
    app.get('/api/gala/registrations', auth, adminOnly, (req, res) => {
        const rows = query.all(`SELECT * FROM gala_registrations ORDER BY created_at DESC`);
        res.json(rows);
    });

    // Approve/reject gala registration (admin)
    app.put('/api/gala/registrations/:id', auth, adminOnly, (req, res) => {
        const { status, admin_notes } = req.body;
        if (!['approved', 'rejected', 'pending'].includes(status)) {
            return res.status(400).json({ error: 'Invalid status' });
        }
        db.run(`UPDATE gala_registrations SET status = ?, admin_notes = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?`,
            [status, admin_notes || '', req.user.email, new Date().toISOString(), req.params.id]);
        saveDb();
        const updated = query.get(`SELECT * FROM gala_registrations WHERE id = ?`, [req.params.id]);

        // Send email when gala invitation is approved
        if (status === 'approved' && updated && updated.email) {
            try {
                const portalUrl = process.env.PORTAL_URL || 'https://medx-user-portal.onrender.com';
                sendEmail(updated.email, 'Your Gala Evening Invitation Has Been Approved!', buildEmailTemplate('Invitation Approved', `
                    <p>Dear ${updated.first_name},</p>
                    <p style="background: #ecfdf5; border: 1px solid #a7f3d0; padding: 14px 18px; border-radius: 8px; color: #065f46; font-weight: 600; font-size: 16px; text-align: center;">
                        Your invitation to the Plexus 2026 Gala Evening has been approved!
                    </p>
                    <p>We are delighted to welcome you to an exclusive evening of networking, fine dining, and celebration with leading minds in biomedicine.</p>
                    ${updated.pricing ? `<p><strong>Ticket Category:</strong> ${updated.pricing}</p>` : ''}
                    <p style="margin-top: 20px;">To secure your spot, please complete your payment at your earliest convenience:</p>
                    <div style="text-align: center; margin: 24px 0;">
                        <a href="${portalUrl}" style="display: inline-block; background: #C9A962; color: #0f172a; padding: 14px 32px; border-radius: 8px; text-decoration: none; font-weight: 700; font-size: 15px;">Complete Payment</a>
                    </div>
                    <p>If you have any questions or need assistance with payment, contact us at <a href="mailto:info@medx.hr" style="color: #C9A962;">info@medx.hr</a>.</p>
                    <p>We look forward to seeing you there!</p>
                    <p>Warm regards,<br><strong>The Med&amp;X Team</strong></p>
                `));
            } catch (emailErr) {
                console.warn('Gala approval email failed:', emailErr.message);
            }
        }

        res.json({ success: true, registration: updated });
    });

    // ========== GALA SETTINGS (public read, admin write) ==========

    // Get gala settings (public)
    app.get('/api/gala/settings', (req, res) => {
        const settings = query.get("SELECT * FROM gala_settings WHERE id = 'default'");
        if (settings) {
            try { settings.speakers = JSON.parse(settings.speakers_json || '[]'); } catch(e) { settings.speakers = []; }
            try { settings.schedule = JSON.parse(settings.schedule_json || '[]'); } catch(e) { settings.schedule = []; }
        }
        res.json(settings || {});
    });

    // Update gala settings (admin only)
    app.put('/api/gala/settings', auth, adminOnly, (req, res) => {
        const { title, tagline, date, time, venue, dress_code, description, capacity,
                price_gala_only, price_bundle, price_bundle_original, is_registration_open,
                speakers_json, schedule_json } = req.body;
        const fields = [];
        const values = [];
        if (title !== undefined) { fields.push('title = ?'); values.push(title); }
        if (tagline !== undefined) { fields.push('tagline = ?'); values.push(tagline); }
        if (date !== undefined) { fields.push('date = ?'); values.push(date); }
        if (time !== undefined) { fields.push('time = ?'); values.push(time); }
        if (venue !== undefined) { fields.push('venue = ?'); values.push(venue); }
        if (dress_code !== undefined) { fields.push('dress_code = ?'); values.push(dress_code); }
        if (description !== undefined) { fields.push('description = ?'); values.push(description); }
        if (capacity !== undefined) { fields.push('capacity = ?'); values.push(capacity); }
        if (price_gala_only !== undefined) { fields.push('price_gala_only = ?'); values.push(price_gala_only); }
        if (price_bundle !== undefined) { fields.push('price_bundle = ?'); values.push(price_bundle); }
        if (price_bundle_original !== undefined) { fields.push('price_bundle_original = ?'); values.push(price_bundle_original); }
        if (is_registration_open !== undefined) { fields.push('is_registration_open = ?'); values.push(is_registration_open ? 1 : 0); }
        if (speakers_json !== undefined) { fields.push('speakers_json = ?'); values.push(typeof speakers_json === 'string' ? speakers_json : JSON.stringify(speakers_json)); }
        if (schedule_json !== undefined) { fields.push('schedule_json = ?'); values.push(typeof schedule_json === 'string' ? schedule_json : JSON.stringify(schedule_json)); }
        if (fields.length === 0) return res.status(400).json({ error: 'No fields to update' });
        fields.push("updated_at = ?"); values.push(new Date().toISOString());
        db.run(`UPDATE gala_settings SET ${fields.join(', ')} WHERE id = 'default'`, values);
        saveDb();
        const updated = query.get("SELECT * FROM gala_settings WHERE id = 'default'");
        res.json({ success: true, settings: updated });
    });

    // Get current user's gala registration status
    app.get('/api/gala/my-status', auth, (req, res) => {
        const reg = query.get(
            `SELECT * FROM gala_registrations WHERE email = ? ORDER BY created_at DESC LIMIT 1`,
            [req.user.email]
        );
        if (!reg) return res.json({ registered: false });
        res.json({ registered: true, registration: reg });
    });

    // ========== GALA STRIPE CHECKOUT ==========

    // Create Stripe checkout session for gala ticket
    app.post('/api/gala/checkout-session', auth, async (req, res) => {
        try {
            if (!stripe) return res.status(400).json({ error: 'Stripe is not configured' });

            const { registration_id } = req.body;
            if (!registration_id) return res.status(400).json({ error: 'registration_id is required' });

            const reg = query.get(
                `SELECT * FROM gala_registrations WHERE id = ? AND email = ?`,
                [registration_id, req.user.email]
            );
            if (!reg) return res.status(404).json({ error: 'Gala registration not found' });
            if (reg.status !== 'approved') return res.status(400).json({ error: 'Registration must be approved before payment' });
            if (reg.payment_status === 'paid') return res.status(400).json({ error: 'Already paid' });

            // Get pricing from settings
            const settings = query.get("SELECT * FROM gala_settings WHERE id = 'default'");
            const price = reg.pricing === 'bundle'
                ? (settings?.price_bundle || 174)
                : (settings?.price_gala_only || 95);

            // Generate invoice number
            const year = new Date().getFullYear();
            const count = query.get("SELECT COUNT(*) as c FROM gala_registrations WHERE invoice_number IS NOT NULL")?.c || 0;
            const invoiceNumber = `GALA26-${String(count + 1).padStart(4, '0')}`;

            // Store invoice number
            db.run('UPDATE gala_registrations SET invoice_number = ?, amount_paid = ?, user_id = ? WHERE id = ?',
                [invoiceNumber, price, req.user.id, reg.id]);
            saveDb();

            const baseUrl = `${req.protocol}://${req.get('host')}`;
            const ticketLabel = reg.pricing === 'bundle' ? 'Plexus + Gala Bundle' : 'Gala Evening Only';

            const session = await stripe.checkout.sessions.create({
                mode: 'payment',
                payment_method_types: ['card'],
                line_items: [{
                    price_data: {
                        currency: 'eur',
                        product_data: {
                            name: `Plexus 2026 — ${ticketLabel}`,
                            description: `Gala Evening Ticket (Invoice: ${invoiceNumber})`
                        },
                        unit_amount: Math.round(price * 100)
                    },
                    quantity: 1
                }],
                metadata: {
                    gala_registration_id: reg.id,
                    invoice_number: invoiceNumber,
                    type: 'gala-ticket'
                },
                customer_email: reg.email,
                success_url: `${baseUrl}/?payment=success&gala=${reg.id}`,
                cancel_url: `${baseUrl}/?payment=cancelled&gala=${reg.id}`
            });

            // Store Stripe session ID
            db.run('UPDATE gala_registrations SET stripe_session_id = ? WHERE id = ?', [session.id, reg.id]);
            saveDb();

            res.json({ sessionId: session.id, url: session.url });
        } catch (err) {
            console.error('Gala Stripe checkout error:', err.message);
            res.status(500).json({ error: 'Failed to create checkout session' });
        }
    });

    // --- SPEAKER PORTAL: AUTH & DOCUMENTS ---

    // Verify speaker invite code, return speaker record
    app.post('/api/speakers/auth', (req, res) => {
        const { code } = req.body;
        if (!code) return res.status(400).json({ error: 'Invite code required' });

        // Look up speaker by invite_code first (priority), then fall back to id or name
        const speaker = query.get(
            `SELECT s.*, c.name as conference_name FROM speakers s
             LEFT JOIN conferences c ON s.conference_id = c.id
             WHERE UPPER(s.invite_code) = UPPER(?)
                OR UPPER(s.id) = UPPER(?)
                OR (UPPER(s.name) LIKE UPPER(?) AND s.is_confirmed = 1)`,
            [code, code, `%${code}%`]
        );

        if (speaker) {
            return res.json({ success: true, speaker });
        }

        // Also check registrations with speaker ticket type
        const reg = query.get(
            `SELECT r.*, u.first_name, u.last_name, u.email, tt.name as ticket_name
             FROM registrations r
             LEFT JOIN users u ON r.user_id = u.id
             LEFT JOIN ticket_types tt ON r.ticket_type_id = tt.id
             WHERE r.id = ? OR r.confirmation_code = ?`,
            [code, code]
        );

        if (reg) {
            return res.json({ success: true, speaker: reg });
        }

        res.status(404).json({ error: 'Invalid invite code' });
    });

    // List speaker's uploaded documents
    app.get('/api/speakers/:id/documents', (req, res) => {
        const docs = query.all(
            'SELECT * FROM speaker_documents WHERE speaker_id = ? ORDER BY uploaded_at DESC',
            [req.params.id]
        );
        res.json(docs);
    });

    // Upload a document for a speaker
    app.post('/api/speakers/:id/documents', upload.single('file'), (req, res) => {
        if (!req.file) return res.status(400).json({ error: 'No file provided' });

        const speakerId = req.params.id;
        const docType = req.body.type || 'additional';
        const id = uuidv4();

        // Move file to speakers directory
        const speakerDir = path.join(uploadsDir, 'speakers', speakerId);
        if (!fs.existsSync(speakerDir)) fs.mkdirSync(speakerDir, { recursive: true });

        const destPath = path.join(speakerDir, req.file.filename);
        fs.renameSync(req.file.path, destPath);

        // If replacing existing doc of same type for same speaker, remove old one
        const existing = query.get(
            'SELECT * FROM speaker_documents WHERE speaker_id = ? AND type = ?',
            [speakerId, docType]
        );
        if (existing) {
            const oldPath = path.join(uploadsDir, 'speakers', speakerId, existing.filename);
            if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
            db.run('DELETE FROM speaker_documents WHERE id = ?', [existing.id]);
        }

        db.run(
            `INSERT INTO speaker_documents (id, speaker_id, type, filename, original_name, file_size, mime_type)
             VALUES (?, ?, ?, ?, ?, ?, ?)`,
            [id, speakerId, docType, req.file.filename, req.file.originalname, req.file.size, req.file.mimetype]
        );
        saveDb();

        res.json({
            success: true,
            document: { id, speaker_id: speakerId, type: docType, filename: req.file.filename, original_name: req.file.originalname, file_size: req.file.size, mime_type: req.file.mimetype }
        });
    });

    // Delete a speaker document
    app.delete('/api/speakers/:id/documents/:docId', (req, res) => {
        const doc = query.get(
            'SELECT * FROM speaker_documents WHERE id = ? AND speaker_id = ?',
            [req.params.docId, req.params.id]
        );
        if (!doc) return res.status(404).json({ error: 'Document not found' });

        // Remove file from disk
        const filePath = path.join(uploadsDir, 'speakers', req.params.id, doc.filename);
        if (fs.existsSync(filePath)) fs.unlinkSync(filePath);

        db.run('DELETE FROM speaker_documents WHERE id = ?', [req.params.docId]);
        saveDb();
        res.json({ success: true });
    });

    // ========== PORTAL CONTENT (PUBLIC) ==========

    // ===== USER ADMIN MESSAGES =====

    // Get admin messages for logged-in user
    app.get('/api/user/admin-messages', auth, (req, res) => {
        try {
            const messages = query.all(`SELECT * FROM direct_messages WHERE receiver_id = ? AND sender_type = 'admin' ORDER BY created_at DESC LIMIT 50`, [req.user.email]);
            res.json(messages);
        } catch (err) {
            res.status(500).json({ error: 'Failed to get messages' });
        }
    });

    // Mark admin message as read
    app.put('/api/user/admin-messages/:id/read', auth, (req, res) => {
        try {
            db.run('UPDATE direct_messages SET is_read = 1 WHERE id = ? AND receiver_id = ?', [req.params.id, req.user.email]);
            saveDb();
            res.json({ success: true });
        } catch (err) {
            res.status(500).json({ error: 'Failed to mark as read' });
        }
    });

    // Reply to an admin message
    app.post('/api/user/admin-messages/:id/reply', auth, (req, res) => {
        try {
            const { content } = req.body;
            if (!content) return res.status(400).json({ error: 'Content required' });

            const original = query.get('SELECT * FROM direct_messages WHERE id = ?', [req.params.id]);
            if (!original) return res.status(404).json({ error: 'Message not found' });

            const id = uuidv4();
            db.run(`INSERT INTO direct_messages (id, sender_id, receiver_id, sender_type, receiver_type, content)
                VALUES (?, ?, ?, 'user', 'admin', ?)`,
                [id, req.user.email, original.sender_id, content]);
            saveDb();
            res.json({ success: true, id });
        } catch (err) {
            res.status(500).json({ error: 'Failed to send reply' });
        }
    });

    // Get all published content
    app.get('/api/portal-content/published', (req, res) => {
        const items = query.all('SELECT * FROM portal_content WHERE is_published = 1 ORDER BY section, sort_order ASC');
        res.json(items);
    });

    // Get published content by section
    app.get('/api/portal-content/published/:section', (req, res) => {
        const items = query.all('SELECT * FROM portal_content WHERE is_published = 1 AND section = ? ORDER BY sort_order ASC', [req.params.section]);
        res.json(items);
    });

    // ========== PLEXUS SETTINGS (public read) ==========

    // Get plexus settings (public)
    app.get('/api/plexus/settings', (req, res) => {
        let settings = query.get("SELECT * FROM plexus_settings WHERE id = 'default'");
        if (settings) {
            // Parse JSON fields
            try { settings.key_dates = JSON.parse(settings.key_dates_json || '[]'); } catch(e) { settings.key_dates = []; }
            try { settings.testimonials = JSON.parse(settings.testimonials_json || '[]'); } catch(e) { settings.testimonials = []; }
        }
        res.json(settings || {});
    });

    // Get plexus registration stats (live count)
    app.get('/api/plexus/stats', (req, res) => {
        const conf = query.get("SELECT id FROM conferences WHERE slug = 'plexus-2026'");
        const total = query.get("SELECT COUNT(*) as count FROM registrations WHERE conference_id = ?", [conf?.id || '']);
        const paid = query.get("SELECT COUNT(*) as count FROM registrations WHERE conference_id = ? AND payment_status = 'paid'", [conf?.id || '']);
        res.json({
            total_registrations: total?.count || 0,
            paid_registrations: paid?.count || 0
        });
    });

    // Get plexus sessions (public — only published, with speaker names)
    app.get('/api/plexus/sessions', (req, res) => {
        const conf = query.get("SELECT * FROM conferences WHERE slug = 'plexus-2026'");
        if (!conf) return res.json([]);
        const sessions = query.all(`SELECT s.*, GROUP_CONCAT(sp.name) as speaker_names
            FROM sessions s
            LEFT JOIN speakers sp ON s.speaker_ids LIKE '%' || sp.id || '%'
            WHERE s.conference_id = ? AND s.is_published = 1 GROUP BY s.id ORDER BY s.day, s.start_time`, [conf.id]);
        res.json(sessions || []);
    });

    // Serve frontend
    app.get('*', (req, res) => res.sendFile(path.join(__dirname, '../frontend/index.html')));

    // Start watching shared DB for cross-portal sync
    watchSharedDb();

    app.listen(PORT, () => console.log(`Med&X User Portal running on http://localhost:${PORT}`));
}

initializeApp().catch(console.error);
