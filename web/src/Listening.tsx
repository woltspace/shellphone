// Listening: Shell's sheet. Tap the mic, talk, tap send: it goes to the room as a voice note and gets written down.
import { useEffect, useRef, useState } from "react";

export type Recording = { blob: Blob; type: string; seconds: number };

export function Listening({ sprite, audio, onDone }: { sprite: string; audio: AudioContext | null; onDone: (r: Recording | null) => void }) {
  const [secs, setSecs] = useState(0);
  const [quiet, setQuiet] = useState(false);
  const bars = useRef<HTMLDivElement>(null);
  const rec = useRef<{ recorder: MediaRecorder; stream: MediaStream; parts: Blob[]; start: number; keep: boolean } | null>(null);

  useEffect(() => {
    let frame = 0, clock = 0, ctx: AudioContext | null = audio, lock: any = null, gone = false;
    (async () => {
      let stream: MediaStream;
      try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
      catch { onDone(null); return; }
      if (gone) { stream.getTracks().forEach((t) => t.stop()); return; }
      const recorder = new MediaRecorder(stream), parts: Blob[] = [];
      const r = (rec.current = { recorder, stream, parts, start: Date.now(), keep: true });
      recorder.ondataavailable = (e) => { if (e.data.size) parts.push(e.data); };
      recorder.onstop = () => {
        stream.getTracks().forEach((t) => t.stop());
        if (!r.keep || !parts.length || Date.now() - r.start < 700) return onDone(null);
        const type = (parts[0].type || recorder.mimeType || "audio/mp4").split(";")[0];
        onDone({ blob: new Blob(parts, { type }), type, seconds: Math.round((Date.now() - r.start) / 100) / 10 });
      };
      recorder.start(1000);
      clock = window.setInterval(() => setSecs(Math.floor((Date.now() - r.start) / 1000)), 250);
      try { if ("wakeLock" in navigator) lock = await (navigator as any).wakeLock.request("screen"); } catch { /* fine without */ }
      // the level meter: real levels if the phone gives them, a gentle pulse if it doesn't
      try {
        ctx = ctx || new AudioContext();
        const an = ctx.createAnalyser(); an.fftSize = 512; ctx.createMediaStreamSource(stream).connect(an); ctx.resume().catch(() => {});
        const buf = new Uint8Array(an.fftSize), lv = new Array(40).fill(0.06), t0 = performance.now();
        let last = 0, heard = false;
        const step = (now: number) => {
          frame = requestAnimationFrame(step);
          if (now - last < 70) return; last = now;
          an.getByteTimeDomainData(buf);
          const peak = buf.reduce((a, v) => Math.max(a, Math.abs(v - 128)), 0) / 128;
          lv.push(Math.max(0.06, Math.min(1, peak * 2.4))); lv.shift();
          if (peak > 0.01) heard = true;
          if (!heard && now - t0 > 1200) { setQuiet(true); return; }
          setQuiet(false);
          [...(bars.current?.children || [])].forEach((b, i) => { (b as HTMLElement).style.transform = `scaleY(${lv[i]})`; });
        };
        frame = requestAnimationFrame(step);
      } catch { setQuiet(true); }
    })();
    return () => { gone = true; cancelAnimationFrame(frame); clearInterval(clock); ctx?.close().catch(() => {}); lock?.release().catch(() => {}); };
  }, []);

  const stop = (keep: boolean) => {
    const r = rec.current;
    if (!r || r.recorder.state === "inactive") return onDone(null);
    r.keep = keep; r.recorder.stop();
  };
  const round = "w-[72px] h-[72px] rounded-full grid place-items-center cursor-pointer border-0";
  return (
    <div className="fixed inset-0 z-[2000] bg-[#18100a55]" data-busy>
      <div role="dialog" aria-label="Listening" className="absolute inset-x-0 bottom-0 top-[calc(env(safe-area-inset-top)+48px)] max-w-[640px] mx-auto flex flex-col px-[18px] pt-2 pb-[calc(24px+env(safe-area-inset-bottom))] bg-paper rounded-t-[14px] animate-[rise_.22s_ease-out]">
        <div className="w-9 h-[5px] mx-auto mb-4 rounded bg-line" />
        <div className="flex items-center gap-2.5">
          <img src={sprite} alt="" className="pixel w-[42px] h-[42px] animate-[bob_2.8s_ease-in-out_infinite]" />
          <div><h2 className="m-0 font-mono font-semibold text-[17px] text-acc">Listening</h2><p className="m-0 text-dim text-[13px]">Talk, then tap send. It goes to the room as a voice note.</p></div>
        </div>
        <div ref={bars} aria-hidden className={`wave flex items-center justify-center gap-[3px] h-[72px] mt-7 text-acc ${quiet ? "quiet" : ""}`}>
          {Array.from({ length: 40 }, (_, i) => <i key={i} className="block w-[3px] h-[72px] rounded-sm bg-current transition-transform duration-[90ms]" style={{ transform: "scaleY(.06)", animationDelay: `${-(i * 0.13) % 1.4}s` }} />)}
        </div>
        <div className="text-center font-light text-[40px] tabular-nums mt-1.5">{Math.floor(secs / 60)}:{String(secs % 60).padStart(2, "0")}</div>
        <div className="flex-1" />
        <div className="flex justify-center gap-14">
          <div><button type="button" aria-label="Cancel" className={`${round} bg-line`} onClick={() => stop(false)}>
            <svg viewBox="0 0 24 24" className="w-[30px] h-[30px] fill-none stroke-[#5c4d3c] stroke-[2.6] [stroke-linecap:round]"><path d="M6 6l12 12M18 6L6 18" /></svg></button>
            <span className="block mt-2 text-center text-dim font-mono text-xs">cancel</span></div>
          <div><button type="button" aria-label="Send" className={`${round} bg-go shadow-[0_4px_14px_#2e9d5755]`} onClick={() => stop(true)}>
            <svg viewBox="0 0 24 24" className="w-[30px] h-[30px] fill-none stroke-white stroke-[2.6] [stroke-linecap:round] [stroke-linejoin:round]"><path d="M12 19V5M5 12l7-7 7 7" /></svg></button>
            <span className="block mt-2 text-center text-dim font-mono text-xs">send</span></div>
        </div>
      </div>
    </div>
  );
}
