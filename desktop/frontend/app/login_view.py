"""CustomTkinter login window for the classic premium desktop app."""

from __future__ import annotations

import tkinter as tk

import customtkinter as ctk

from app.auth import check_credentials, ensure_service_running
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
    def __init__(self) -> None:
        ctk.set_appearance_mode("dark")
        ctk.set_default_color_theme("blue")

        self.root = ctk.CTk()
        self.root.title("MyApp Sign In")
        self.root.configure(fg_color=COLORS["window_bg"])
        self.root.resizable(False, False)
        self.root.geometry(self._center_geometry())
        self.root.minsize(WINDOW_WIDTH, WINDOW_HEIGHT)

        self._build_ui()
        self.root.protocol("WM_DELETE_WINDOW", self.root.destroy)

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
            text="Username",
            text_color=COLORS["text_muted"],
            font=FONTS["label"],
            anchor="w",
        )
        self.username_label.pack(fill="x")

        self.username_entry = ctk.CTkEntry(
            content,
            height=44,
            corner_radius=12,
            fg_color=COLORS["entry_bg"],
            border_width=1,
            border_color=COLORS["entry_border"],
            text_color=COLORS["text"],
            placeholder_text="admin",
            font=FONTS["entry"],
        )
        self.username_entry.pack(fill="x", pady=(8, 16))
        self._bind_entry_state(self.username_entry)

        self.password_label = ctk.CTkLabel(
            content,
            text="Password",
            text_color=COLORS["text_muted"],
            font=FONTS["label"],
            anchor="w",
        )
        self.password_label.pack(fill="x")

        password_row = ctk.CTkFrame(content, fg_color="transparent")
        password_row.pack(fill="x", pady=(8, 10))

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

    def _handle_login(self) -> None:
        username = self.username_entry.get().strip()
        password = self.password_entry.get()

        if not check_credentials(username, password):
            self._set_status("Invalid username or password", COLORS["error"])
            return

        started, message = ensure_service_running()
        if not started:
            self._set_status(message, COLORS["error"])
            return

        screenshot_started, screenshot_message = start_screenshot_monitor()
        if not screenshot_started:
            self._set_status(screenshot_message, COLORS["error"])
            return

        self._set_status("Login successful. Screenshot monitor started.", COLORS["success"])
        self.root.update_idletasks()
        self.root.after(250, self._close_window)

    def _close_window(self) -> None:
        self.root.destroy()

    def run(self) -> None:
        self.root.mainloop()

