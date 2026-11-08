import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./index.css";

// `room.py serve --dev` lets the address pick who you are: ?as=EMAIL (only ever on your own computer)
const as = new URLSearchParams(location.search).get("as");
if (as) document.cookie = "as=" + encodeURIComponent(as) + "; path=/; SameSite=Strict";

createRoot(document.getElementById("root")!).render(<App />);
