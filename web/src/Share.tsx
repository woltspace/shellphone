// The share button on pictures, videos and files: the phone's share sheet with the file (Save Video, AirDrop…),
// or a download on a computer. See sharefile.js.
import { useState } from "react";
import { Download, Loader2, Share } from "lucide-react";
import { canShareFiles, share } from "./sharefile.js";

export function ShareButton({ url, name, className = "" }: { url: string; name?: string; className?: string }) {
  const [state, setState] = useState<"" | "busy" | "again" | "failed">("");
  const files = canShareFiles(), Icon = state === "busy" ? Loader2 : files ? Share : Download;
  const label = state === "again" ? "Tap to share" : state === "failed" ? "Couldn't get it" : "";
  const go = async (e: React.MouseEvent) => {
    e.stopPropagation();  // not a tap on the bubble or the viewer behind
    if (state === "busy") return;
    setState("busy");
    try { const r = await share(url, name); setState(r === "again" ? "again" : ""); }
    catch { setState("failed"); setTimeout(() => setState(""), 2500); }
  };
  return <button type="button" data-tap aria-label={files ? "Share" : "Download"} title={files ? "Share" : "Download"} onClick={go}
    className={`inline-flex items-center gap-1.5 h-9 min-w-9 px-2 justify-center rounded-full cursor-pointer ${className}`}>
    <Icon size={18} className={state === "busy" ? "animate-spin" : ""} />{label && <span className="text-[13px] font-semibold pr-1">{label}</span>}
  </button>;
}
