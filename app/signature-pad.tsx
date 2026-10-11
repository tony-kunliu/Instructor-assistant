"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/** Backing-store size of every signature PNG: 2:1, no more pixels than a phone pad
 * produced before (≈732×300), so saved PNG sizes stay where they were and
 * under the server's MAX_SIGNATURE_LENGTH (lib/repo.ts) even when scribbled over. */
export const SIGNATURE_WIDTH = 640;
export const SIGNATURE_HEIGHT = 320;

/** Touch-friendly signature pad. Emits a PNG data URL ("" when cleared). */
export default function SignaturePad({ label, value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  // The backing store has a FIXED size (SIGNATURE_WIDTH x SIGNATURE_HEIGHT),
  // independent of layout; CSS only scales the display at the same aspect
  // ratio (.sig canvas), so rotation or a phone/tablet layout change never
  // resizes or resamples the drawing, and every saved PNG has the same size.
  // Clear when the value is reset; redraw a restored signature (saved draft,
  // History edit). PNGs of other sizes (older saves) are letterboxed, keeping
  // their aspect ratio.
  useEffect(() => {
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    if (!value) {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      dirty.current = false;
      return;
    }
    if (dirty.current) return;
    let cancelled = false;
    const image = new Image();
    image.onload = () => {
      if (cancelled || dirty.current || !image.naturalWidth || !image.naturalHeight) return;
      const scale = Math.min(canvas.width / image.naturalWidth, canvas.height / image.naturalHeight);
      const w = image.naturalWidth * scale;
      const h = image.naturalHeight * scale;
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.drawImage(image, (canvas.width - w) / 2, (canvas.height - h) / 2, w, h);
    };
    image.src = value;
    return () => { cancelled = true; };
  }, [value]);

  const point = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    const canvas = canvasRef.current!;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (event.clientX - rect.left) * (canvas.width / rect.width),
      y: (event.clientY - rect.top) * (canvas.height / rect.height),
    };
  };

  const start = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    event.preventDefault();
    canvasRef.current?.setPointerCapture(event.pointerId);
    drawing.current = true;
    last.current = point(event);
  };

  const move = (event: ReactPointerEvent<HTMLCanvasElement>) => {
    if (!drawing.current || !last.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas?.getContext("2d");
    if (!canvas || !ctx) return;
    const next = point(event);
    ctx.strokeStyle = "#111";
    ctx.lineWidth = 2.5 * (canvas.width / canvas.getBoundingClientRect().width);
    ctx.lineCap = "round";
    ctx.lineJoin = "round";
    ctx.beginPath();
    ctx.moveTo(last.current.x, last.current.y);
    ctx.lineTo(next.x, next.y);
    ctx.stroke();
    last.current = next;
    dirty.current = true;
  };

  const finish = () => {
    if (!drawing.current) return;
    drawing.current = false;
    last.current = null;
    if (dirty.current && canvasRef.current) onChange(canvasRef.current.toDataURL("image/png"));
  };

  const clear = () => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    dirty.current = false;
    onChange("");
  };

  return (
    <div className="sig">
      <div className="sig-head">
        <strong>{label}</strong>
        <span className={value ? "sig-ok" : "sig-todo"}>{value ? "Signed ✓" : "Sign below"}</span>
        <button type="button" className="link" onClick={clear}>Clear</button>
      </div>
      <canvas
        ref={canvasRef}
        width={SIGNATURE_WIDTH}
        height={SIGNATURE_HEIGHT}
        aria-label={label}
        onPointerDown={start}
        onPointerMove={move}
        onPointerUp={finish}
        onPointerCancel={finish}
        onPointerLeave={finish}
      />
    </div>
  );
}
