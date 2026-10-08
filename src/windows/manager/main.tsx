import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles/app.css";
import { installDropGuard } from "@/lib/dropGuard";
import { ManagerApp } from "./ManagerApp";

installDropGuard();

const container = document.getElementById("root");
if (!container) throw new Error("#root が見つかりません");

createRoot(container).render(
  <StrictMode>
    <ManagerApp />
  </StrictMode>,
);
