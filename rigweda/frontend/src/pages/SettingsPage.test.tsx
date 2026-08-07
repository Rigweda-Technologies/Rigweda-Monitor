import {render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {SettingsPage} from "./SettingsPage";

const authMocks = vi.hoisted(() => ({
  sessions: vi.fn(),
  changePassword: vi.fn(),
  revokeSession: vi.fn(),
  revokeOtherSessions: vi.fn()
}));

vi.mock("../features/auth/auth.api", () => ({authApi: authMocks}));

describe("Settings page", () => {
  beforeEach(() => {
    authMocks.sessions.mockResolvedValue([{
      id: "session-1",
      userAgent: "Chrome",
      ipAddress: "127.0.0.1",
      createdAt: "2026-08-07T00:00:00.000Z",
      lastUsedAt: "2026-08-07T00:00:00.000Z",
      expiresAt: "2026-09-07T00:00:00.000Z",
      current: true
    }]);
  });

  it("shows the password policy and active-device information", async () => {
    render(
      <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
        <SettingsPage onMenu={() => {}} onTheme={() => {}}/>
      </QueryClientProvider>
    );
    expect(screen.getByLabelText(/New password/)).toHaveAttribute("minlength", "12");
    expect(await screen.findByText("Chrome browser")).toBeInTheDocument();
    expect(screen.getByText("Current")).toBeInTheDocument();
  });
});
