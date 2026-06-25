import { useCallback, useEffect, useRef, useState } from "react";

export default function CircuitDiagram({ svg }) {
  const frameRef = useRef(null);
  const dragRef = useRef(null);
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 });
  const [isFullscreen, setIsFullscreen] = useState(false);

  function clampScale(scale) {
    return Math.min(2.5, Math.max(0.4, scale));
  }

  function zoomBy(factor) {
    setView((current) => ({ ...current, scale: clampScale(current.scale * factor) }));
  }

  const handleWheel = useCallback((event) => {
    event.preventDefault();
    event.stopPropagation();
    if (!frameRef.current) return;
    const rect = frameRef.current.getBoundingClientRect();
    const cursorX = event.clientX - rect.left;
    const cursorY = event.clientY - rect.top;
    const factor = event.deltaY < 0 ? 1.12 : 0.88;
    setView((current) => {
      const nextScale = clampScale(current.scale * factor);
      const scaleRatio = nextScale / current.scale;
      return {
        scale: nextScale,
        x: cursorX - (cursorX - current.x) * scaleRatio,
        y: cursorY - (cursorY - current.y) * scaleRatio
      };
    });
  }, []);

  useEffect(() => {
    const frame = frameRef.current;
    if (!frame) return undefined;
    frame.addEventListener("wheel", handleWheel, { passive: false });
    return () => frame.removeEventListener("wheel", handleWheel);
  }, [handleWheel, svg]);

  useEffect(() => {
    if (!isFullscreen) return undefined;
    function handleKeyDown(event) {
      if (event.key === "Escape") setIsFullscreen(false);
    }
    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [isFullscreen]);

  useEffect(() => {
    setView({ scale: 1, x: 0, y: 0 });
  }, [svg]);

  if (!svg) {
    return <div className="diagram-placeholder">Generate results to display the SVG sequential circuit diagram.</div>;
  }

  function handleMouseDown(event) {
    dragRef.current = { startX: event.clientX, startY: event.clientY, baseX: view.x, baseY: view.y };
  }

  function handleMouseMove(event) {
    if (!dragRef.current) return;
    const { startX, startY, baseX, baseY } = dragRef.current;
    setView((current) => ({
      ...current,
      x: baseX + event.clientX - startX,
      y: baseY + event.clientY - startY
    }));
  }

  function stopDrag() {
    dragRef.current = null;
  }

  return (
    <div
      className={`diagram-frame zoomable-diagram${isFullscreen ? " diagram-fullscreen" : ""}`}
      ref={frameRef}
      onMouseDown={handleMouseDown}
      onMouseMove={handleMouseMove}
      onMouseUp={stopDrag}
      onMouseLeave={stopDrag}
    >
      <div className="diagram-toolbar">
        <span className="zoom-badge">{Math.round(view.scale * 100)}%</span>
        <button
          className="diagram-tool-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            zoomBy(0.86);
          }}
        >
          Zoom -
        </button>
        <button
          className="diagram-tool-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            zoomBy(1.16);
          }}
        >
          Zoom +
        </button>
        <button
          className="diagram-tool-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setView({ scale: 0.72, x: 20, y: 20 });
          }}
        >
          Fit
        </button>
        <button
          className="diagram-tool-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setView({ scale: 1, x: 0, y: 0 });
          }}
        >
          Reset View
        </button>
        <button
          className="fullscreen-button diagram-tool-button"
          type="button"
          onClick={(event) => {
            event.stopPropagation();
            setIsFullscreen((current) => !current);
          }}
        >
          {isFullscreen ? "Exit Fullscreen" : "Fullscreen"}
        </button>
      </div>
      <div
        className="diagram-transform"
        style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.scale})` }}
        dangerouslySetInnerHTML={{ __html: svg }}
      />
    </div>
  );
}
