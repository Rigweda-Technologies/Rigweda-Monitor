import {fireEvent, render, screen} from "@testing-library/react";
import {QueryClient, QueryClientProvider} from "@tanstack/react-query";
import {beforeEach, describe, expect, it, vi} from "vitest";
import {PeoplePage} from "./PeoplePage";

vi.mock("../features/auth/AuthProvider", () => ({useAuth: () => ({hasPermission: () => true})}));

const accessMocks = vi.hoisted(() => ({
  users: vi.fn(),
  roles: vi.fn(),
  permissions: vi.fn(),
  createUser: vi.fn(),
  updateUser: vi.fn(),
  createRole: vi.fn(),
  updateRole: vi.fn()
}));

vi.mock("../features/access/access.api", () => ({accessApi: accessMocks}));

const roles = [{
  id: "181cb122-b4b1-4793-9801-f3c7300c4927",
  key: "system_admin",
  name: "System Administrator",
  description: "Full workspace access",
  isSystem: true,
  userCount: 1,
  permissions: ["users.manage"]
}];

const renderPage = () => render(
  <QueryClientProvider client={new QueryClient({defaultOptions: {queries: {retry: false}}})}>
    <PeoplePage onMenu={() => {}} onTheme={() => {}}/>
  </QueryClientProvider>
);

describe("People page", () => {
  beforeEach(() => {
    accessMocks.users.mockResolvedValue({items: [{
      id: "user-1",
      email: "admin@rigweda.com",
      displayName: "Rigweda Administrator",
      accountStatus: "active",
      membershipStatus: "active",
      roleId: roles[0].id,
      roleName: roles[0].name,
      roleKey: roles[0].key,
      lastLoginAt: null,
      joinedAt: "2026-08-07T00:00:00.000Z"
    }], total: 1});
    accessMocks.roles.mockResolvedValue(roles);
    accessMocks.permissions.mockResolvedValue([]);
  });

  it("loads users and switches to organization roles", async () => {
    renderPage();
    expect(await screen.findByText("Rigweda Administrator")).toBeInTheDocument();
    const roleCards = await screen.findAllByText("System Administrator");
    expect(roleCards.length).toBeGreaterThan(0);
    expect(screen.getByText("System Administrator", {selector: "em"})).toBeInTheDocument();
  });

  it("opens the user-creation workflow", async () => {
    renderPage();
    await screen.findByText("Rigweda Administrator");
    fireEvent.click(screen.getByRole("button", {name: /add member/i}));
    expect(screen.getByRole("heading", {name: "Invite a workspace member"})).toBeInTheDocument();
    expect(screen.getByLabelText(/Temporary password/)).toHaveAttribute("minlength", "12");
  });
});
