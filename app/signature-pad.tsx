"use client";

import { useEffect, useRef } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";

type Props = {
  label: string;
  value: string;
  onChange: (value: string) => void;
};

/** Touch-friendly signature pad. Emits a PNG data URL ("" when cleared). */
export default function SignaturePad({ label, value, onChange }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const dirty = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);

  const valueRef = useRef(value);
  valueRef.current = value;

  // Size the backing store to the rendered size so strokes stay sharp, and
  // re-fit it when the rendered size changes (iPad rotation, phone ↔ tablet
  // layout): resizing clears a canvas, so the current signature is redrawn.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const fit = () => {
      const rect = canvas.getBoundingClientRect();
      if (!rect.width || !rect.height) return;
      const ratio = Math.min(window.devicePixelRatio || 1, 2);
      const width = Math.max(1, Math.round(rect.width * ratio));
      const height = Math.max(1, Math.round(rect.height * ratio));
      if (canvas.width === width && canvas.height === height) return;
      canvas.width = width;
      canvas.height = height;
      const saved = valueRef.current;
      if (!saved) return;
      const image = new Image();
      image.onload = () => canvas.getContext("2d")?.drawImage(image, 0, 0, canvas.width, canvas.height);
      image.src = saved;
    };
    fit();
    if (typeof ResizeObserver === "undefined") return;
    const observer = new ResizeObserver(fit);
    observer.observe(canvas);
    return () => observer.disconnect();
  }, []);

  // Clear when the value is reset; redraw a restored signature (e.g. saved draft).
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
    const image = new Image();
    image.onload = () => ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    image.src = value;
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
