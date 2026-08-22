"""CustomTkinter login window for the classic premium desktop app."""

from __future__ import annotations

from io import BytesIO
from pathlib import Path
import sys
import threading
import tkinter as tk
import urllib.error
import urllib.request

import customtkinter as ctk
from PIL import Image

from app.auth import ensure_service_running, login_to_hrms, register_startup
from app.monitor_settings import apply_monitor_feature_flags, get_monitor_feature_flags, start_monitor_settings_listener

COLORS = {
    "window_bg": "#f7f7f5",
    "panel_bg": "#ffffff",
    "panel_border": "#deded8",
    "gold": "#d8ad55",
    "gold_hover": "#c69739",
    "text": "#111111",
    "text_muted": "#666666",
    "error": "#c74f4f",
    "success": "#2f8f5b",
    "entry_bg": "#fbfbfa",
    "entry_border": "#d7d7d0",
    "focus_border": "#111111",
    "button_text": "#ffffff",
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
PROFILE_WINDOW_WIDTH = 840
PROFILE_WINDOW_HEIGHT = 460
RADIUS = 16
PADDING_X = 42
ASSETS_DIR = Path(__file__).resolve().parents[1] / "assets"


class LoginApp:
    def __init__(
        self,
        saved_session: dict | None = None,
        *,
        hide_after_resume: bool = False,
        auto_resume_saved_session: bool = True,
        startup_notice: str | None = None,
    ) -> None:
        ctk.set_appearance_mode("light")
        ctk.set_default_color_theme("blue")

        self.saved_session = saved_session
        self.hide_after_resume = hide_after_resume
        self.auto_resume_saved_session = auto_resume_saved_session
        self.startup_notice = startup_notice
        self.profile_photo_image: ctk.CTkImage | None = None
        self.logo_image: ctk.CTkImage | None = None
        self._email_prefilled = bool(self.saved_session and self.saved_session.get("email") and not self.auto_resume_saved_session)
        self.login_widgets: list[tk.Widget] = []
        self.auto_close_seconds = 20
        self.auto_close_after_id: str | None = None
        self._login_in_progress = False
        self._is_profile_mode = False

        self.root = ctk.CTk()
        self.root.title("Rigweda Monitor")
        self.root.configure(fg_color=COLORS["window_bg"])
        self.root.resizable(False, False)
        self.root.geometry(self._center_geometry())
        self.root.minsize(WINDOW_WIDTH, WINDOW_HEIGHT)
        self.root.overrideredirect(True)
        self.root.attributes("-topmost", True)

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.root.destroy)
        self.root.after(100, lambda: self.root.attributes("-topmost", True))
        self.root.after(150, self.root.lift)
        self.root.after(200, self.root.focus_force)
        if self.startup_notice:
            self.subtitle_label.configure(text=self.startup_notice)

        if self._email_prefilled:
            self.username_entry.delete(0, tk.END)
            self.username_entry.insert(0, str(self.saved_session.get("email")))

        if self.saved_session and self.auto_resume_saved_session:
            self.root.after(250, self._resume_saved_session)

        if self._email_prefilled:
            self.root.after(100, self.password_entry.focus_set)
        else:
            self.root.after(100, self.username_entry.focus_set)

    def _center_geometry(self) -> str:
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = max((screen_width - WINDOW_WIDTH) // 2, 0)
        y = max((screen_height - WINDOW_HEIGHT) // 2, 0)
        return f"{WINDOW_WIDTH}x{WINDOW_HEIGHT}+{x}+{y}"

    def _profile_geometry(self) -> str:
        screen_width = self.root.winfo_screenwidth()
        screen_height = self.root.winfo_screenheight()
        x = max((screen_width - PROFILE_WINDOW_WIDTH) // 2, 0)
        y = max((screen_height - PROFILE_WINDOW_HEIGHT) // 2, 0)
        return f"{PROFILE_WINDOW_WIDTH}x{PROFILE_WINDOW_HEIGHT}+{x}+{y}"

    def _build_ui(self) -> None:
        self.outer = ctk.CTkFrame(
            self.root,
            width=420,
            height=540,
            corner_radius=RADIUS,
            fg_color=COLORS["panel_bg"],
            border_width=1,
            border_color=COLORS["panel_border"],
        )
        self.outer.place(relx=0.5, rely=0.5, anchor="center")

        accent = ctk.CTkFrame(
            self.outer,
            fg_color=COLORS["gold"],
            height=6,
            corner_radius=RADIUS,
        )
        accent.pack(fill="x", padx=0, pady=(0, 0))

        content = ctk.CTkFrame(self.outer, fg_color="transparent")
        content.pack(fill="both", expand=True, padx=PADDING_X, pady=(22, 24))

        logo = self._build_logo_widget(content)
        logo.pack(pady=(0, 10))

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
            placeholder_text="Enter your email",
            font=FONTS["entry"],
        )
        self.username_entry.pack(fill="x", pady=(8, 16))
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
            fg_color="#111111",
            hover_color="#333333",
            text_color="#ffffff",
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

        self.profile_frame = ctk.CTkFrame(
            content,
            corner_radius=18,
            fg_color="#ffffff",
            border_width=1,
            border_color=COLORS["entry_border"],
        )

        profile_shell = ctk.CTkFrame(self.profile_frame, fg_color="transparent")
        profile_shell.pack(fill="both", expand=True, padx=12, pady=12)

        self.profile_left_panel = ctk.CTkFrame(
            profile_shell,
            width=240,
            height=262,
            corner_radius=18,
            fg_color="#ffffff",
            border_width=1,
            border_color=COLORS["entry_border"],
        )
        self.profile_left_panel.pack(side="left", fill="y", padx=(0, 16))
        self.profile_left_panel.pack_propagate(False)

        self.profile_avatar_label = ctk.CTkLabel(
            self.profile_left_panel,
            text="",
            width=132,
            height=132,
            corner_radius=28,
            fg_color="#f2f2ef",
            text_color=COLORS["gold"],
            font=("Segoe UI", 28, "bold"),
        )
        self.profile_avatar_label.pack(pady=(12, 8))

        self.employee_name_label = ctk.CTkLabel(
            self.profile_left_panel,
            text="",
            text_color=COLORS["text"],
            font=("Segoe UI", 14, "bold"),
            anchor="center",
            justify="center",
            wraplength=200,
        )
        self.employee_name_label.pack(fill="x", padx=12, pady=(0, 2))

        self.employee_role_frame = ctk.CTkFrame(
            self.profile_left_panel,
            fg_color="#f2f2ef",
            corner_radius=999,
        )
        self.employee_role_frame.pack(fill="x", padx=24, pady=(0, 10))

        self.employee_role_label = ctk.CTkLabel(
            self.employee_role_frame,
            text="",
            text_color=COLORS["text"],
            font=("Segoe UI", 11, "bold"),
            anchor="center",
            justify="center",
            wraplength=200,
        )
        self.employee_role_label.pack(fill="x", padx=10, pady=4)

        self.profile_right_panel = ctk.CTkFrame(
            profile_shell,
            corner_radius=18,
            fg_color="#ffffff",
            border_width=1,
            border_color=COLORS["entry_border"],
        )
        self.profile_right_panel.pack(side="left", fill="both", expand=True)

        self.profile_heading_label = ctk.CTkLabel(
            self.profile_right_panel,
            text="Employee Details",
            text_color=COLORS["text"],
            font=("Segoe UI", 14, "bold"),
            anchor="w",
        )
        self.profile_heading_label.pack(fill="x", padx=14, pady=(14, 6))

        self.employee_details_rows = ctk.CTkFrame(self.profile_right_panel, fg_color="transparent")
        self.employee_details_rows.pack(fill="both", expand=True, padx=14, pady=(0, 12))

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
        self.login_widgets.append(self.signin_button)

        self.footer_label = ctk.CTkLabel(
            content,
            text="Secure access to the desktop service backend.",
            text_color=COLORS["text_muted"],
            font=("Segoe UI", 10),
        )
        self.footer_label.pack(pady=(6, 0))

        self.root.bind("<Return>", self._handle_enter)

    def _bind_entry_state(self, entry: ctk.CTkEntry) -> None:
        entry.bind("<FocusIn>", lambda _event, widget=entry: widget.configure(border_color=COLORS["focus_border"]))
        entry.bind("<FocusOut>", lambda _event, widget=entry: widget.configure(border_color=COLORS["entry_border"]))

    def _asset_path(self, filename: str) -> Path:
        if hasattr(sys, "_MEIPASS"):
            return Path(sys._MEIPASS) / "assets" / filename
        return ASSETS_DIR / filename

    def _build_logo_widget(self, parent: tk.Misc) -> tk.Widget:
        logo_path_candidates = (
            self._asset_path("app-logo.png"),
            self._asset_path("app-logo.app"),
        )
        for path in logo_path_candidates:
            if not path.exists():
                continue
            try:
                logo_image = Image.open(path).convert("RGBA")
                alpha_bbox = logo_image.getchannel("A").getbbox()
                if alpha_bbox:
                    logo_image = logo_image.crop(alpha_bbox)
                logo_image.thumbnail((240, 110))
                self.logo_image = ctk.CTkImage(
                    light_image=logo_image,
                    dark_image=logo_image,
                    size=logo_image.size,
                )
                return ctk.CTkLabel(parent, text="", image=self.logo_image, fg_color="transparent")
            except OSError:
                continue

        fallback = tk.Canvas(parent, width=72, height=72, bg=COLORS["panel_bg"], highlightthickness=0)
        fallback.create_oval(6, 6, 66, 66, outline=COLORS["gold"], width=2)
        fallback.create_text(36, 36, text="R", fill=COLORS["text"], font=("Georgia", 28, "bold"))
        return fallback

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
        self.signin_button.pack_forget()

    def _enter_profile_mode(self) -> None:
        if self._is_profile_mode:
            return

        self._is_profile_mode = True
        self.root.geometry(self._profile_geometry())
        self.outer.configure(width=PROFILE_WINDOW_WIDTH - 60, height=PROFILE_WINDOW_HEIGHT - 40)
        self.root.update_idletasks()

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

        image.thumbnail((132, 132))
        self.profile_photo_image = ctk.CTkImage(light_image=image, dark_image=image, size=(132, 132))
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
            ("Status", employee.get("status")),
            ("Manager", employee.get("manager")),
            ("Shift", employee.get("shift")),
            ("Date of Joining", employee.get("dateOfJoining")),
        ]

        self._hide_login_controls()
        self._enter_profile_mode()
        self.title_label.pack_forget()
        self.subtitle_label.configure(
            text="Session verified. Employee profile is active. This popup will close automatically.",
            text_color=COLORS["text_muted"],
        )
        self.status_label.configure(text="")
        self.employee_name_label.configure(text=str(employee.get("name") or "Employee"))
        self.employee_role_label.configure(text=f"Designation: {role or 'Employee'}")
        if role:
            self.employee_role_frame.pack(fill="x", padx=24, pady=(0, 10))
        else:
            self.employee_role_frame.pack_forget()
        for child in self.employee_details_rows.winfo_children():
            child.destroy()

        visible_fields = [
            (label, formatted)
            for label, value in detail_fields
            if (formatted := self._format_profile_value(value))
        ]
        if visible_fields:
            for label, formatted in visible_fields:
                row = ctk.CTkFrame(self.employee_details_rows, fg_color="transparent")
                row.pack(fill="x", pady=1)

                key_label = ctk.CTkLabel(
                    row,
                    text=f"{label}:",
                    text_color="#444444",
                    font=("Segoe UI", 10, "bold"),
                    anchor="w",
                    width=122,
                )
                key_label.pack(side="left", anchor="w")

                value_label = ctk.CTkLabel(
                    row,
                    text=formatted,
                    text_color=COLORS["text"],
                    font=("Segoe UI", 10),
                    anchor="w",
                    justify="left",
                )
                value_label.pack(side="left", fill="x", expand=True, padx=(8, 0))
        else:
            empty_label = ctk.CTkLabel(
                self.employee_details_rows,
                text="Profile details are not available for this token.",
                text_color=COLORS["text_muted"],
                font=("Segoe UI", 10),
                anchor="w",
                justify="left",
            )
            empty_label.pack(fill="x")
        if not self.profile_frame.winfo_ismapped():
            self.profile_frame.pack(fill="x", pady=(0, 14), before=self.footer_label)

        photo = self._load_profile_photo(employee.get("profileImage"))
        if photo:
            self.profile_avatar_label.configure(image=photo, text="")
        else:
            self.profile_avatar_label.configure(image=None, text=self._initials_for_employee(employee))

    def _start_monitoring(self, session: dict | None, *, register_windows_startup: bool) -> bool:
        started, message = ensure_service_running()
        if not started:
            self.signin_button.configure(state="normal", text="Sign In")
            self._set_status(message, COLORS["error"])
            return False

        flags = start_monitor_settings_listener(session, on_change=apply_monitor_feature_flags)

        if register_windows_startup:
            register_startup()

        self._show_employee_details(session)
        enabled_labels = []
        if flags.get("screenshotsEnabled", True):
            enabled_labels.append("screenshots")
        if flags.get("mouseEnabled", True):
            enabled_labels.append("mouse activity")
        if flags.get("keyboardEnabled", True):
            enabled_labels.append("keyboard")
        if flags.get("appUsageEnabled", True):
            enabled_labels.append("app usage")

        if enabled_labels:
            self._set_status(
                f"Login successful. {', '.join(enabled_labels).capitalize()} monitoring is active.",
                COLORS["success"],
            )
        else:
            self._set_status("Login successful. Monitoring is disabled by Employee Monitor settings.", COLORS["success"])
        self.subtitle_label.configure(
            text=f"Session verified. Employee profile is active. Popup closes in {self.auto_close_seconds} seconds.",
            text_color=COLORS["text_muted"],
        )
        self._start_auto_close(20)
        self.root.update_idletasks()
        return True

    def _resume_saved_session(self) -> None:
        if self._start_monitoring(self.saved_session, register_windows_startup=True) and self.hide_after_resume:
            self.hide_after_resume = False

    def _start_auto_close(self, seconds: int = 20) -> None:
        if self.auto_close_after_id:
            self.root.after_cancel(self.auto_close_after_id)
            self.auto_close_after_id = None

        self.auto_close_seconds = max(int(seconds), 1)
        self._tick_auto_close()

    def _tick_auto_close(self) -> None:
        if self.auto_close_seconds <= 0:
            self.auto_close_after_id = None
            self.root.destroy()
            return

        self.subtitle_label.configure(
            text=f"Session verified. Employee profile is active. Popup closes in {self.auto_close_seconds} seconds.",
            text_color=COLORS["text_muted"],
        )
        self.auto_close_seconds -= 1
        self.auto_close_after_id = self.root.after(1000, self._tick_auto_close)

    def _handle_login(self) -> None:
        if self._login_in_progress:
            return

        username = self.username_entry.get().strip()
        password = self.password_entry.get()

        if not username or not password:
            self._set_status("Please enter both email and password.", COLORS["error"])
            return

        self._login_in_progress = True
        self.signin_button.configure(state="disabled", text="Signing in...")
        self._set_status("Contacting login service...", COLORS["text_muted"])
        self.root.update_idletasks()

        def worker() -> None:
            logged_in, login_message, session = login_to_hrms(username, password)

            def finalize() -> None:
                self._login_in_progress = False
                if not logged_in:
                    self.signin_button.configure(state="normal", text="Sign In")
                    self._set_status(login_message, COLORS["error"])
                    return

                self._start_monitoring(session, register_windows_startup=True)

            self.root.after(0, finalize)

        threading.Thread(target=worker, daemon=True).start()

    def run(self) -> None:
        self.root.mainloop()

