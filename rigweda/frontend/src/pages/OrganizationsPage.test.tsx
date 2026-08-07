import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { OrganizationsPage } from "./OrganizationsPage";

vi.mock("../features/auth/AuthProvider",()=>({useAuth:()=>({hasPermission:()=>true})}));

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions:{ queries:{ retry:false } } })}><OrganizationsPage onMenu={()=>{}} onTheme={()=>{}} /></QueryClientProvider>);

describe("Organizations page", () => {
  beforeEach(() => localStorage.clear());
  it("loads the development directory and filters it", async () => {
    renderPage();
    expect(await screen.findByText("Rigweda Labs")).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Search organizations"), { target:{ value:"Northstar" } });
    await waitFor(() => expect(screen.queryByText("Rigweda Labs")).not.toBeInTheDocument());
    expect(screen.getByText("Northstar Studio")).toBeInTheDocument();
  });
  it("opens a validated creation form", async () => {
    renderPage();
    await screen.findByText("Rigweda Labs");
    fireEvent.click(screen.getByRole("button", { name:/new organization/i }));
    expect(screen.getByRole("heading", { name:"Create organization" })).toBeInTheDocument();
    expect(screen.getByLabelText("Display name")).toBeRequired();
  });
});
