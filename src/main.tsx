import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

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
