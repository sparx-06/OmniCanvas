import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";
import { useStore } from "./store";
import { player } from "./engine/player";

// Handle for automated tests and future automation; not used by the app itself.
(window as any).omnicanvas = { store: useStore, player };

// Block the WebView's own right-click menu; the app shows its own where it has one.
window.addEventListener("contextmenu", e => {
  const t = e.target as HTMLElement;
  if (t.tagName !== "INPUT" && t.tagName !== "TEXTAREA") e.preventDefault();
});

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
