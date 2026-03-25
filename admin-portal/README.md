# Med&X Client Portal

Internal management portal for Med&X organization - Plexus Conference, Accelerator, Biomedical Forum, Building Bridges, Finances, and PR & Media.

---

## QUICK START (For Miro & Laura)

### Step 1: Install Node.js (if not installed)
Download and install from: https://nodejs.org/ (choose LTS version)

### Step 2: Run the Portal

**Mac:**
1. Open Terminal
2. Navigate to the backend folder:
   ```
   cd ~/Downloads/medx-portal/backend
   ```
3. Install dependencies (first time only):
   ```
   npm install
   ```
4. Start the server:
   ```
   npm start
   ```
5. Open browser: http://localhost:3001

**Windows:**
1. Open Command Prompt
2. Navigate to the backend folder:
   ```
   cd Downloads\medx-portal\backend
   ```
3. Install dependencies (first time only):
   ```
   npm install
   ```
4. Start the server:
   ```
   npm start
   ```
5. Open browser: http://localhost:3001

### Login Credentials

| User | Email | Password |
|------|-------|----------|
| Alen | juginovic.alen@gmail.com | admin123 |
| Miro | vp@medx.hr | admin123 |
| Laura | laura.rodman@medx.hr | MedX2026! |

---

## Features Overview

### Home Dashboard
- Overview of all projects with task counts
- Timeline showing upcoming events
- To-do tasks and sequences assigned to you

### Plexus Conference
- Registration management
- Abstract submissions
- Speaker management
- Check-in system

### Med&X Accelerator
- Multi-step application form
- Document uploads
- Partner institution selection
- Admin review with accept/reject

### Biomedical Forum
- Member community
- Events and discussions
- Groups and mentorship

### Building Bridges
- Mini-events for diaspora symposiums
- Registration tracking

### Finances
- Income and expense transactions
- Invoices (incoming and outgoing)
- Travel orders with full details
- Payment orders
- Work units (radne jedinice) for grants

### PR & Media
- Social posts with scheduling
- Analytics dashboard
- Content calendar
- AI generation history

---

## FEEDBACK REQUEST

Please note the **most important/biggest feedback items** only.
Details and polish can be refined later - focus on:
- Major structural issues
- Missing critical functionality
- Confusing navigation
- Data that doesn't make sense

---

### Team Members (for testing chat)
- Alen Juginovic (President)
- Miro Vukovic (Vice President)
- Laura Rodman (Executive Assistant)
- Ivan Nikolic (Plexus Lead)
- Sara Bonet (Operations)
- Petra Horvat (Marketing)

## Tech Stack

- **Backend:** Node.js, Express
- **Database:** SQLite (sql.js - pure JavaScript)
- **Auth:** JWT + bcrypt
- **File Upload:** Multer
- **PDF Generation:** PDFKit
- **Frontend:** Vanilla HTML/CSS/JS (single page app)

## API Endpoints

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user

### Tasks
- `GET /api/tasks` - Get all tasks summary
- `GET /api/tasks/:project` - Get tasks for project
- `POST /api/tasks` - Create task
- `POST /api/tasks/:id/toggle` - Toggle task status
- `PUT /api/tasks/:id` - Update task
- `DELETE /api/tasks/:id` - Delete task

### Chat
- `GET /api/team` - Get team members
- `GET /api/chat/messages` - Get messages
- `POST /api/chat/messages` - Send message

### Accelerator
- `GET /api/accelerator/program` - Get active program
- `GET /api/accelerator/institutions` - Get partner institutions
- `POST /api/accelerator/applications` - Create/update application
- `POST /api/accelerator/applications/:id/documents/:type` - Upload document
- `GET /api/accelerator/applications/:id/package` - Download PDF package

## Project Structure

```
medx-portal/
├── backend/
│   ├── server.js          # Main server with all routes
│   ├── package.json       # Dependencies
│   └── uploads/           # Uploaded files
├── frontend/
│   └── index.html         # Single-page frontend app
└── README.md
```

## Notes

- Database is SQLite stored in `medx_portal.db` (auto-created on first run)
- Uploaded documents stored in `backend/uploads/accelerator/`
- Chat polls for new messages every 5 seconds
- Sample tasks and team members are seeded automatically

---

Built for Med&X | 2026
