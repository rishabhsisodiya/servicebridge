"use client";

import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
} from "react";
import { Eraser } from "lucide-react";
import { Button } from "@/components/ui/button";

export interface SignaturePadHandle {
  /** PNG of the signature, or null when nothing was drawn. */
  toBlob: () => Promise<Blob | null>;
  clear: () => void;
  readonly hasInk: boolean;
}

const HEIGHT = 176;

function setupCanvas(canvas: HTMLCanvasElement) {
  const ratio = window.devicePixelRatio || 1;
  const { width } = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(width * ratio));
  canvas.height = Math.round(HEIGHT * ratio);
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.scale(ratio, ratio);
  ctx.lineWidth = 2.2;
  ctx.lineCap = "round";
  ctx.lineJoin = "round";
  // Theme-aware ink: follows the surrounding text colour (light + dark).
  ctx.strokeStyle = getComputedStyle(canvas).color;
  return ctx;
}

/**
 * A finger/mouse signature pad. No dependencies: one canvas, pointer events,
 * scaled for high-DPI screens. The parent reads the PNG with the ref's toBlob().
 */
export const SignaturePad = forwardRef<SignaturePadHandle>(function SignaturePad(_, ref) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const last = useRef<{ x: number; y: number } | null>(null);
  const [hasInk, setHasInk] = useState(false);
  // Mirror of hasInk for the resize listener, which is registered once.
  const inkRef = useRef(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    setupCanvas(canvas);
    // Re-fit on resize. Restoring through the scaled context keeps the ink 1:1.
    const onResize = () => {
      const data = canvas.toDataURL();
      const hadInk = inkRef.current;
      setupCanvas(canvas);
      if (hadInk) {
        const { width } = canvas.getBoundingClientRect();
        const img = new Image();
        img.onload = () =>
          canvas.getContext("2d")?.drawImage(img, 0, 0, width, HEIGHT);
        img.src = data;
      }
    };
    window.addEventListener("resize", onResize);
    return () => window.removeEventListener("resize", onResize);
  }, []);

  const point = (event: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current!.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  const clear = useCallback(() => {
    const canvas = canvasRef.current;
    canvas?.getContext("2d")?.clearRect(0, 0, canvas.width, canvas.height);
    inkRef.current = false;
    setHasInk(false);
  }, []);

  const toBlob = useCallback(
    () =>
      new Promise<Blob | null>((resolve) => {
        if (!hasInk || !canvasRef.current) return resolve(null);
        canvasRef.current.toBlob((blob) => resolve(blob), "image/png");
      }),
    [hasInk],
  );

  useImperativeHandle(ref, () => ({ toBlob, clear, hasInk }), [toBlob, clear, hasInk]);

  return (
    <div>
      <canvas
        ref={canvasRef}
        role="img"
        aria-label="Signature pad. Draw the customer's signature here with a finger, stylus or mouse."
        className="block h-44 w-full cursor-crosshair touch-none rounded-lg border border-line bg-surface-2 text-text"
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId);
          drawing.current = true;
          last.current = point(e);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = canvasRef.current?.getContext("2d");
          const p = point(e);
          if (ctx && last.current) {
            ctx.beginPath();
            ctx.moveTo(last.current.x, last.current.y);
            ctx.lineTo(p.x, p.y);
            ctx.stroke();
          }
          last.current = p;
          inkRef.current = true;
          setHasInk(true);
        }}
        onPointerUp={() => {
          drawing.current = false;
          last.current = null;
        }}
        onPointerCancel={() => {
          drawing.current = false;
          last.current = null;
        }}
      >
        Draw the customer&apos;s signature here.
      </canvas>
      <div className="mt-1.5 flex justify-end">
        <Button size="sm" variant="ghost" icon={<Eraser className="size-4" aria-hidden />} onClick={clear} disabled={!hasInk}>
          Clear
        </Button>
      </div>
    </div>
  );
});
