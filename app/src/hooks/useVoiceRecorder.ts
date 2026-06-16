// MediaRecorder-based voice memo recorder. Used by the request composer so
// "voice" is an actual input affordance instead of just a metadata label.
//
// Returns a small API:
//   - status: 'idle' | 'recording' | 'stopping' | 'denied' | 'unsupported'
//   - durationMs: live elapsed time while recording
//   - error: human-readable error if recording failed
//   - start(): asks for mic permission and starts a new recording
//   - stop(): returns the recorded Blob (webm/opus by default)
//   - cancel(): aborts without producing a blob
//
// Works inside Tauri's webview on macOS as long as NSMicrophoneUsageDescription
// is set in Info.plist (Tauri 2 ships with it by default for the webview).

import { useEffect, useRef, useState } from 'react';

export type RecorderStatus = 'idle' | 'recording' | 'stopping' | 'denied' | 'unsupported';

export function useVoiceRecorder() {
  const [status, setStatus] = useState<RecorderStatus>(
    typeof window !== 'undefined' && !!(window as any).MediaRecorder ? 'idle' : 'unsupported',
  );
  const [durationMs, setDurationMs] = useState(0);
  const [error, setError] = useState<string | null>(null);

  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);
  const tickRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const resolveStopRef = useRef<((blob: Blob | null) => void) | null>(null);

  // Stop any active stream/timer when the hook unmounts.
  useEffect(() => () => {
    if (tickRef.current) clearInterval(tickRef.current);
    streamRef.current?.getTracks().forEach((t) => t.stop());
  }, []);

  const start = async (): Promise<boolean> => {
    if (status === 'unsupported') return false;
    setError(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const rec = new MediaRecorder(stream, pickMimeType());
      chunksRef.current = [];
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data);
      };
      rec.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: rec.mimeType || 'audio/webm' });
        chunksRef.current = [];
        stream.getTracks().forEach((t) => t.stop());
        streamRef.current = null;
        if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
        setDurationMs(0);
        setStatus('idle');
        resolveStopRef.current?.(blob);
        resolveStopRef.current = null;
      };
      recorderRef.current = rec;
      startedAtRef.current = Date.now();
      setDurationMs(0);
      tickRef.current = setInterval(
        () => setDurationMs(Date.now() - startedAtRef.current),
        200,
      );
      rec.start();
      setStatus('recording');
      return true;
    } catch (err: any) {
      // NotAllowedError = user denied; SecurityError = HTTPS/permission missing.
      if (err?.name === 'NotAllowedError' || err?.name === 'PermissionDeniedError') {
        setStatus('denied');
        setError('Microphone access was denied. Enable it in System Settings → Privacy & Security → Microphone.');
      } else {
        setError(err?.message || 'Could not access microphone');
      }
      return false;
    }
  };

  const stop = (): Promise<Blob | null> => {
    return new Promise((resolve) => {
      const rec = recorderRef.current;
      if (!rec || rec.state === 'inactive') return resolve(null);
      resolveStopRef.current = resolve;
      setStatus('stopping');
      try { rec.stop(); } catch { resolve(null); resolveStopRef.current = null; }
    });
  };

  const cancel = () => {
    const rec = recorderRef.current;
    chunksRef.current = [];
    resolveStopRef.current = null;
    if (rec && rec.state !== 'inactive') {
      try { rec.stop(); } catch {}
    }
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (tickRef.current) { clearInterval(tickRef.current); tickRef.current = null; }
    setDurationMs(0);
    setStatus('idle');
  };

  return { status, durationMs, error, start, stop, cancel };
}

// Prefer Opus where supported (small files, good quality). Safari uses mp4.
function pickMimeType(): MediaRecorderOptions {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/mp4',
    'audio/ogg;codecs=opus',
  ];
  const Recorder = (typeof window !== 'undefined' ? (window as any).MediaRecorder : null);
  if (!Recorder?.isTypeSupported) return {};
  for (const m of candidates) if (Recorder.isTypeSupported(m)) return { mimeType: m };
  return {};
}

// Format the live duration in mm:ss for the recording chip.
export function formatRecorderDuration(ms: number): string {
  const total = Math.floor(ms / 1000);
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}
