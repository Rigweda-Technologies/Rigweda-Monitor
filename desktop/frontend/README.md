# MyApp Login Front-End

Classic premium-style login window built with `CustomTkinter` for a Windows desktop app.

## Project Layout

```text
myapp/
├── app/
│   ├── main.py
│   ├── login_view.py
│   └── auth.py
├── backend/
│   └── backend_service.py
├── installer/
│   └── install_service.bat
├── requirements.txt
├── .gitignore
└── README.md
```

## Setup

1. Create and activate a virtual environment.
2. Install dependencies:

```bash
pip install -r requirements.txt
```

## Run

From the `myapp` directory:

```bash
python -m app.main
```

## Default Credentials

- Username: `admin@gmail.com`
- Password: `changeme123`

## Service Notes

- The login screen authenticates with hardcoded credentials for now.
- On success, the app runs `sc start MyAppBackendService`.
- The backend service template in `backend/backend_service.py` expects `pywin32`.
- Use `installer/install_service.bat` from an elevated Command Prompt to install the service.

