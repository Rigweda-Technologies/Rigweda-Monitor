"""CustomTkinter login window for the classic premium desktop app."""

from __future__ import annotations

from io import BytesIO
import tkinter as tk
import urllib.error
import urllib.request

import customtkinter as ctk
from PIL import Image

from app.auth import ensure_service_running, login_to_hrms, register_startup
from app.screenshot_monitor import start_screenshot_monitor

COLORS = {
    "window_bg": "#1a1a2e",
    "panel_bg": "#22213a",
    "panel_border": "#3a3550",
    "gold": "#c9a86a",
    "gold_hover": "#b99655",
    "text": "#f3efe4",
    "text_muted": "#c9c3b7",
    "error": "#d96b6b",
    "success": "#76c893",
    "entry_bg": "#161629",
    "entry_border": "#4a4465",
    "focus_border": "#d2b57a",
    "button_text": "#1d1a10",
}

FONTS = {
    "title": ("Georgia", 30, "bold"),
    "subtitle": ("Segoe UI", 11),
    "label": ("Segoe UI", 11),
    "entry": ("Segoe UI", 12),
    "button": ("Segoe UI", 13, "bold"),
    "status": ("Segoe UI", 10),
}

WINDOW_WIDTH = 520
WINDOW_HEIGHT = 640
RADIUS = 16
PADDING_X = 42


class LoginApp:
    def __init__(self, saved_session: dict | None = None, *, hide_after_resume: bool = False) -> None:
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.saved_session = saved_session
        self.hide_after_resume = hide_after_resume
        self.profile_photo_image: ctk.CTkImage | None = None
        self.login_widgets: list[tk.Widget] = []

        self.root = ctk.CTk()
        self.root.title("MyApp Sign In")
        self.root.configure(fg_color=COLORS["window_bg"])
        self.root.resizable(False, False)
        self.root.geometry(self._center_geometry())
        self.root.minsize(WINDOW_WIDTH, WINDOW_HEIGHT)

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.root.destroy)
        if self.saved_session:
            self.root.after(250, self._resume_saved_session)

    def _center_geometry(self) -> str:
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = max((screen_width - WINDOW_WIDTH) // 2, 0)
        y = max((screen_height - WINDOW_HEIGHT) // 2, 0)
        return f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}+{x}+{y}"

    def _build_ui(self) -> None:
        outer = ctk.CTkFrame(
            self.root,
            width=420,
            height=540,
            corner_radius=RADIUS,
            fg_color=COLORS["panel_bg"],
            border_width=1,
            border_color=COLORS["panel_border"],
        )
        outer.place(relx=0.5, rely=0.5, anchor="center")

        accent = ctk.CTkFrame(
            outer,
            fg_color=COLORS["gold"],
            height=6,
            corner_radius=RADIUS,
        )
        accent.pack(fill="x", padx=0, pady=(0, 0))

        content = ctk.CTkFrame(outer, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=PADDING_X, pady=(28, 24))

        logo = tk.Canvas(
            content,
            width=72,
            height=72,
            bg=COLORS["panel_bg"],
            highlightthickness=0,
        )
        logo.pack(pady=(0, 14))
        logo.create_oval(6, 6, 66, 66, outline=COLORS["gold"], width=2)
        logo.create_text(36, 36, text="M", fill=COLORS["text"], font=("Georgia", 28, "bold"))

        self.title_label = ctk.CTkLabel(
            content,
            text="Sign In",
            text_color=COLORS["text"],
            font=FONTS["title"],
        )
        self.title_label.pack(pady=(0, 4))

        self.subtitle_label = ctk.CTkLabel(
            content,
            text="Welcome back. Enter your credentials to continue.",
            text_color=COLORS["text_muted"],
            font=FONTS["subtitle"],
        )
        self.subtitle_label.pack(pady=(0, 22))

        self.username_label = ctk.CTkLabel(
            content,
            text="Email",
            text_color=COLORS["text_muted"],
            font=FONTS["label"],
            anchor="w",
        )
        self.username_label.pack(fill="x")
        self.login_widgets.append(self.username_label)

        self.username_entry = ctk.CTkEntry(
            content,
            height=44,
            corner_radius=12,
            fg_color=COLORS["entry_bg"],
            border_width=1,
            border_color=COLORS["entry_border"],
            text_color=COLORS["text"],
            placeholder_text="name@company.com",
            font=FONTS["entry"],
        )
        self.username_entry.pack(fill="x", pady=(8, 16))
        self.username_entry.insert(0, "shivaramakrishna@luvetha.com")
        self._bind_entry_state(self.username_entry)
        self.login_widgets.append(self.username_entry)

        self.password_label = ctk.CTkLabel(
            content,
            text="Password",
            text_color=COLORS["text_muted"],
            font=FONTS["label"],
            anchor="w",
        )
        self.password_label.pack(fill="x")
        self.login_widgets.append(self.password_label)

        password_row = ctk.CTkFrame(content, fg_color="transparent")
        password_row.pack(fill="x", pady=(8, 10))
        self.login_widgets.append(password_row)

        self.password_entry = ctk.CTkEntry(
            password_row,
            height=44,
            corner_radius=12,
            fg_color=COLORS["entry_bg"],
            border_width=1,
            border_color=COLORS["entry_border"],
            text_color=COLORS["text"],
            placeholder_text="Enter password",
            show="*",
            font=FONTS["entry"],
        )
        self.password_entry.pack(side="left", fill="x", expand=True)
        self._bind_entry_state(self.password_entry)

        self.show_password = False
        self.toggle_button = ctk.CTkButton(
            password_row,
            text="Show",
            width=72,
            height=44,
            corner_radius=12,
            fg_color="#2c2940",
            hover_color="#38334f",
            text_color=COLORS["text"],
            font=("Segoe UI", 11, "bold"),
            command=self._toggle_password_visibility,
        )
        self.toggle_button.pack(side="left", padx=(10, 0))

        options_row = ctk.CTkFrame(content, fg_color="transparent")
        options_row.pack(fill="x", pady=(4, 16))
        self.login_widgets.append(options_row)

        self.remember_var = tk.BooleanVar(value=True)
        self.remember_checkbox = ctk.CTkCheckBox(
            options_row,
            text="Remember me",
            variable=self.remember_var,
            onvalue=True,
            offvalue=False,
            text_color=COLORS["text_muted"],
            border_color=COLORS["gold"],
            fg_color=COLORS["gold"],
            hover_color=COLORS["gold_hover"],
            checkbox_width=20,
            checkbox_height=20,
            font=FONTS["label"],
        )
        self.remember_checkbox.pack(side="left")

        self.status_label = ctk.CTkLabel(
            content,
            text="",
            text_color=COLORS["error"],
            font=FONTS["status"],
            anchor="w",
        )
        self.status_label.pack(fill="x", pady=(0, 12))

        self.employee_frame = ctk.CTkFrame(
            content,
            corner_radius=12,
            fg_color=COLORS["entry_bg"],
            border_width=1,
            border_color=COLORS["entry_border"],
        )

        self.profile_header = ctk.CTkFrame(self.employee_frame, fg_color="transparent")
        self.profile_header.pack(fill="x", padx=16, pady=(14, 8))

        self.profile_avatar_label = ctk.CTkLabel(
            self.profile_header,
            text="",
            width=64,
            height=64,
            corner_radius=32,
            fg_color="#2c2940",
            text_color=COLORS["gold"],
            font=("Segoe UI", 18, "bold"),
        )
        self.profile_avatar_label.pack(side="left")

        profile_title_frame = ctk.CTkFrame(self.profile_header, fg_color="transparent")
        profile_title_frame.pack(side="left", fill="x", expand=True, padx=(14, 0))

        self.employee_name_label = ctk.CTkLabel(
            profile_title_frame,
            text="",
            text_color=COLORS["text"],
            font=("Segoe UI", 15, "bold"),
            anchor="w",
        )
        self.employee_name_label.pack(fill="x")

        self.employee_role_label = ctk.CTkLabel(
            profile_title_frame,
            text="",
            text_color=COLORS["text_muted"],
            font=("Segoe UI", 10),
            anchor="w",
        )
        self.employee_role_label.pack(fill="x", pady=(3, 0))

        self.employee_details_label = ctk.CTkLabel(
            self.employee_frame,
            text="",
            text_color=COLORS["text_muted"],
            font=("Segoe UI", 10),
            justify="left",
            anchor="w",
        )
        self.employee_details_label.pack(fill="x", padx=16, pady=(0, 14))

        self.signin_button = ctk.CTkButton(
            content,
            text="Sign In",
            height=48,
            corner_radius=14,
            fg_color=COLORS["gold"],
            hover_color=COLORS["gold_hover"],
            text_color=COLORS["button_text"],
            font=FONTS["button"],
            command=self._handle_login,
        )
        self.signin_button.pack(fill="x", pady=(4, 12))

        footer = ctk.CTkLabel(
            content,
            text="Secure access to the desktop service backend.",
            text_color=COLORS["text_muted"],
            font=("Segoe UI", 10),
        )
        footer.pack(pady=(6, 0))

        self.username_entry.focus_set()
        self.root.bind("<Return>", self._handle_enter)

    def _bind_entry_state(self, entry: ctk.CTkEntry) -> None:
        entry.bind("<FocusIn>", lambda _event, widget=entry: widget.configure(border_color=COLORS["focus_border"]))
        entry.bind("<FocusOut>", lambda _event, widget=entry: widget.configure(border_color=COLORS["entry_border"]))

    def _toggle_password_visibility(self) -> None:
        self.show_password = not self.show_password
        self.password_entry.configure(show="" if self.show_password else "*")
        self.toggle_button.configure(text="Hide" if self.show_password else "Show")

    def _handle_enter(self, _event: tk.Event) -> None:
        self._handle_login()

    def _set_status(self, message: str, color: str) -> None:
        self.status_label.configure(text=message, text_color=color)

    def _hide_login_controls(self) -> None:
        for widget in self.login_widgets:
            widget.pack_forget()

    def _initials_for_employee(self, employee: dict) -> str:
        name = str(employee.get("name") or employee.get("email") or "Employee")
        parts = [part for part in name.replace("@", " ").replace(".", " ").split() if part]
        initials = "".join(part[0].upper() for part in parts[:2])
        return initials or "E"

    def _load_profile_photo(self, image_url: str | None) -> ctk.CTkImage | None:
        if not image_url:
            return None

        try:
            with urllib.request.urlopen(str(image_url), timeout=10) as response:
                image_data = response.read()
            image = Image.open(BytesIO(image_data)).convert("RGBA")
        except (OSError, urllib.error.URLError, TimeoutError, ValueError):
            return None

        image.thumbnail((128, 128))
        self.profile_photo_image = ctk.CTkImage(light_image=image, dark_image=image, size=(64, 64))
        return self.profile_photo_image

    def _format_profile_value(self, value: object) -> str | None:
        if value in (None, "", [], {}):
            return None
        if isinstance(value, bool):
            return "Yes" if value else "No"
        text = str(value).strip()
        if not text or text.lower() == "none":
            return None
        if "T" in text and text.endswith("Z"):
            return text.split("T", 1)[0]
        return text

    def _show_employee_details(self, session: dict | None) -> None:
        employee = session.get("employee", {}) if isinstance(session, dict) else {}
        role = employee.get("role") or employee.get("designation")
        detail_fields = [
            ("Email", employee.get("email") or session.get("email") if isinstance(session, dict) else None),
            ("Employee ID", employee.get("employeeId")),
            ("Phone", employee.get("phone")),
            ("Department", employee.get("department")),
            ("Designation", employee.get("designation")),
            ("Organization", employee.get("organization")),
            ("Employment Type", employee.get("employmentType")),
            ("Status", employee.get("status")),
            ("Lifecycle", employee.get("employmentLifecycleStatus")),
            ("Manager", employee.get("manager")),
            ("Shift", employee.get("shift")),
            ("Date of Joining", employee.get("dateOfJoining")),
            ("Profile Completed", employee.get("profileCompleted")),
        ]
        detail_text = "\n".join(
            f"{label}: {formatted}"
            for label, value in detail_fields
            if (formatted := self._format_profile_value(value))
        )

        self._hide_login_controls()
        self.title_label.configure(text="Profile")
        self.subtitle_label.configure(text="Monitoring is active. This window will hide automatically in 30 seconds.")
        self.employee_name_label.configure(text=str(employee.get("name") or "Employee"))
        self.employee_role_label.configure(text=str(role or "Employee"))
        self.employee_details_label.configure(text=detail_text or "Profile details are not available for this token.")

        photo = self._load_profile_photo(employee.get("profileImage"))
        if photo:
            self.profile_avatar_label.configure(image=photo, text="")
        else:
            self.profile_avatar_label.configure(image=None, text=self._initials_for_employee(employee))

        if not self.employee_frame.winfo_ismapped():
            self.employee_frame.pack(fill="x", pady=(0, 14), before=self.signin_button)

    def _hide_application(self) -> None:
        self.root.withdraw()

    def _start_monitoring(self, session: dict | None, *, register_windows_startup: bool) -> bool:
        started, message = ensure_service_running()
        if not started:
            self.signin_button.configure(state="normal", text="Sign In")
            self._set_status(message, COLORS["error"])
            return False

        screenshot_started, screenshot_message = start_screenshot_monitor()
        if not screenshot_started:
            self.signin_button.configure(state="normal", text="Sign In")
            self._set_status(screenshot_message, COLORS["error"])
            return False

        if register_windows_startup:
            register_startup()

        self.signin_button.configure(state="normal", text="Monitoring Active")
        self._show_employee_details(session)
        self._set_status("Login successful. Screenshot monitor is running.", COLORS["success"])
        self.root.update_idletasks()
        self.root.after(30_000, self._hide_application)
        return True

    def _resume_saved_session(self) -> None:
        self.signin_button.configure(state="disabled", text="Monitoring Active")
        if self._start_monitoring(self.saved_session, register_windows_startup=True) and self.hide_after_resume:
            self.root.after(1_000, self._hide_application)

    def _handle_login(self) -> None:
        username = self.username_entry.get().strip()
        password = self.password_entry.get()

        self.signin_button.configure(state="disabled", text="Signing in...")
        self.root.update_idletasks()

        logged_in, login_message, session = login_to_hrms(username, password)
        if not logged_in:
            self.signin_button.configure(state="normal", text="Sign In")
            self._set_status(login_message, COLORS["error"])
            return

        self._start_monitoring(session, register_windows_startup=True)

    def run(self) -> None:
        self.root.mainloop()

