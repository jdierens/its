"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { errorText } from "@/lib/errors";
import { openScan } from "@/lib/openScan";

type DetectorCode = { rawValue?: string };
type Detector = { detect: (source: HTMLVideoElement) => Promise<DetectorCode[]> };
type DetectorCtor = new (options?: { formats?: string[] }) => Detector;

function detectorAvailable(): DetectorCtor | null {
  const candidate = (window as Window & { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
  return candidate ?? null;
}

export function ScanPage() {
  const router = useRouter();
  const params = useSearchParams();
  const videoRef = useRef<HTMLVideoElement>(null);
  const handled = useRef(false);
  const [message, setMessage] = useState<string | null>(params.get("error"));
  const [manual, setManual] = useState(params.get("code") ?? "");
  const [running, setRunning] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    return () => stopCamera(videoRef.current);
  }, []);

  async function follow(raw: string) {
    if (handled.current) return;
    handled.current = true;
    setBusy(true);
    setMessage(null);
    try {
      router.push(await openScan(raw));
    } catch (error) {
      handled.current = false;
      setMessage(errorText(error));
      setBusy(false);
    }
  }

  async function startCamera() {
    const video = videoRef.current;
    if (!video) return;
    setMessage(null);
    setRunning(true);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: { ideal: "environment" } },
      });
      video.srcObject = stream;
      await video.play();
      const Detector = detectorAvailable();
      if (Detector) {
        const detector = new Detector({ formats: ["qr_code", "code_128"] });
        const tick = async () => {
          if (!videoRef.current || videoRef.current.srcObject !== stream) return;
          try {
            const codes = await detector.detect(video);
            const value = codes[0]?.rawValue;
            if (value) {
              stopCamera(video);
              setRunning(false);
              await follow(value);
              return;
            }
          } catch {
            // A frame can fail while the camera is still starting.
          }
          requestAnimationFrame(() => void tick());
        };
        void tick();
        return;
      }
      const { BrowserMultiFormatReader } = await import("@zxing/browser");
      const reader = new BrowserMultiFormatReader();
      await reader.decodeFromVideoElement(video, (result) => {
        const value = result?.getText();
        if (!value) return;
        stopCamera(video);
        setRunning(false);
        void follow(value);
      });
    } catch (error) {
      setRunning(false);
      stopCamera(video);
      setMessage(errorText(error) || "The camera is not available. Type the code instead.");
    }
  }

  return (
    <main className="page scan-page">
      <p className="hint">
        Point the camera at an item QR code, a Code 128 SKU, or a bin code such as 20000-P. A handheld scanner works from any page.
      </p>
      <video ref={videoRef} className="scan-video" playsInline muted autoPlay />
      <button type="button" onClick={() => void startCamera()} disabled={running || busy}>
        {running ? "Looking…" : "Start camera"}
      </button>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void follow(manual);
        }}
      >
        <label>
          Code
          <input
            value={manual}
            onChange={(event) => setManual(event.target.value)}
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="SKU, item link, or 20000-P"
          />
        </label>
        <button type="submit" className="secondary" disabled={busy || manual.trim().length === 0}>
          Open
        </button>
      </form>
      {message ? <p className="banner error">{message}</p> : null}
    </main>
  );
}

function stopCamera(video: HTMLVideoElement | null) {
  const stream = video?.srcObject;
  if (stream instanceof MediaStream) {
    for (const track of stream.getTracks()) track.stop();
  }
  if (video) video.srcObject = null;
}
