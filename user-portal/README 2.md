# Med&X Portal

Internal project management portal for Med&X organization - managing Plexus Conference, Med&X Accelerator, and Biomedical Forum.

## Features

### Dashboard
- Clean overview of all three projects with inline task management
- Team chat for real-time communication between admins
- Task summary showing due items and in-progress work

### Task Management
- One-click task creation per project
- Click to toggle task status (todo → in progress → done)
- Priority levels and due dates
- Visible directly on dashboard - no navigation needed

### Plexus Conference
- Registration management
- Abstract submissions
- Speaker management
- Check-in system with QR codes

### Med&X Accelerator
- Multi-step application form
- Document upload (CV, motivation letter, transcript, passport, photo)
- Partner institution selection (Harvard, Yale, MIT, Mayo, etc.)
- Admin review with accept/reject decisions
- PDF package export of complete applications

### Biomedical Forum
- Member management (coming soon)

## Quick Start

### Prerequisites
- Node.js 18+
- npm

### Installation

```bash
# Clone the repo
git clone https://github.com/medx-hr/medx-portal.git
cd medx-portal

# Install backend dependencies
cd backend
npm install

# Start the server
npm start
```

Server runs at http://localhost:3001

### Access the Portal

1. Open `frontend/index.html` in your browser (or serve it via a local server)
2. Login with:
   - **Email:** president@medx.hr
   - **Password:** admin123

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
