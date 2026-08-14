# Digital Notice Board — Render Deployment

## Project structure
- `index.html` — frontend
- `style.css` — styles
- `script.js` — frontend logic
- `server.js` — Express + Socket.IO backend
- `data/notices.json` — notice data
- `data/users.json` — demo accounts
- `uploads/` — uploaded notice attachments

## Run locally
```bash
npm install
npm start
```
Open http://localhost:5000

## Demo accounts
Admin:
- College ID: COLLEGE001
- Password: admin123

Student:
- College Security Key: admin123
- Roll Number: 23A81A0501
- Password: student123

## Render
Use the repository root as the Render service root.
- Build Command: `npm install`
- Start Command: `npm start`
- Health Check: `/health`

If using Supabase, add `SUPABASE_URL` and `SUPABASE_ANON_KEY` in Render Environment Variables.
