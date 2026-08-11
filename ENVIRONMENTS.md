# Local and server run modes

The shared `.env` in each app remains the source for secrets and common
settings. The mode files below are already set up and override only URLs and
ports that change by environment:

- `desktop/frontend/.env.local` and `desktop/frontend/.env.server`
- `desktop/backend/.env.local` and `desktop/backend/.env.server`
- `hrms/back-end/.env.local` and `hrms/back-end/.env.server`
- `hrms/front-end/.env.local` and `hrms/front-end/.env.server`

For local mode, the files use localhost URLs. For server mode, they use the
deployed Vercel API URLs. Keep database and Cloudinary credentials in the
shared backend `.env` files; Vite exposes only variables whose names start
with `VITE_` to the browser.

From the workspace root:

```powershell
npm run desktop:local
npm run desktop:server
npm run hrms:local
npm run hrms:server
```

In `local` mode, the desktop command starts the monitor backend and Python
desktop agent; the HRMS command starts the HRMS backend and Vite web frontend.
In `server` mode, each command starts only its frontend/agent and connects to
the deployed URLs—no localhost API is started. Press `Ctrl+C` in the terminal
to stop the started processes.

You may also run an individual backend:

```powershell
cd desktop/backend; npm run local   # or: npm run server
cd hrms/back-end; npm run local     # or: npm run server
```
