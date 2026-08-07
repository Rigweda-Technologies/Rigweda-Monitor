import React from "react";
import ReactDOM from "react-dom/client";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Root } from "./Root";
import { AuthProvider } from "./features/auth/AuthProvider";
import { ThemeProvider } from "./theme/ThemeProvider";
import "./styles.css";

const queryClient = new QueryClient();
ReactDOM.createRoot(document.getElementById("root")!).render(<React.StrictMode><QueryClientProvider client={queryClient}><ThemeProvider><AuthProvider><Root /></AuthProvider></ThemeProvider></QueryClientProvider></React.StrictMode>);
