import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import App from "./App";
import { ThemeProvider } from "./theme/ThemeProvider";
import { vi } from "vitest";

vi.mock("./features/auth/AuthProvider", () => ({useAuth: () => ({hasPermission: () => true})}));

describe("Rigweda shell", () => {
  it("renders the original dashboard experience", () => {
    render(<ThemeProvider><App /></ThemeProvider>);
    expect(screen.getByText("Everyone, moving together.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /theme/i })).toBeInTheDocument();
  });
});
