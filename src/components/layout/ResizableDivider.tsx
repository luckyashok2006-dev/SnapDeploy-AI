import React, { useState, useCallback, useEffect } from 'react';
import { GripVertical, GripHorizontal } from 'lucide-react';

interface ResizableDividerProps {
  orientation: 'horizontal' | 'vertical';
  onResize: (delta: number) => void;
  onDragStart?: () => void;
  onDragEnd?: () => void;
  className?: string;
  minLimit?: number;
  maxLimit?: number;
}

export const ResizableDivider: React.FC<ResizableDividerProps> = ({
  orientation,
  onResize,
  onDragStart,
  onDragEnd,
  className = '',
}) => {
  const [isDragging, setIsDragging] = useState(false);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    setIsDragging(true);
    onDragStart?.();

    let lastPos = orientation === 'horizontal' ? e.clientX : e.clientY;

    const handleMouseMove = (moveEvent: MouseEvent) => {
      const currentPos = orientation === 'horizontal' ? moveEvent.clientX : moveEvent.clientY;
      const delta = currentPos - lastPos;
      if (delta !== 0) {
        onResize(delta);
        lastPos = currentPos;
      }
    };

    const handleMouseUp = () => {
      setIsDragging(false);
      onDragEnd?.();
      window.removeEventListener('mousemove', handleMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
    };

    document.body.style.cursor = orientation === 'horizontal' ? 'col-resize' : 'row-resize';
    document.body.style.userSelect = 'none';

    window.addEventListener('mousemove', handleMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
  }, [orientation, onResize, onDragStart, onDragEnd]);

  if (orientation === 'horizontal') {
    return (
      <div
        onMouseDown={handleMouseDown}
        className={`w-1.5 hover:w-1.5 bg-slate-900/80 hover:bg-indigo-500/80 active:bg-indigo-400 transition-colors cursor-col-resize relative flex items-center justify-center z-20 shrink-0 group border-x border-slate-800/40 ${
          isDragging ? 'bg-indigo-500 w-1.5' : ''
        } ${className}`}
        title="Drag to resize panel"
      >
        <div className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-slate-300 group-hover:text-white">
          <GripVertical className="w-3 h-3" />
        </div>
      </div>
    );
  }

  return (
    <div
      onMouseDown={handleMouseDown}
      className={`h-1.5 hover:h-1.5 bg-slate-900/80 hover:bg-indigo-500/80 active:bg-indigo-400 transition-colors cursor-row-resize relative flex items-center justify-center z-20 shrink-0 group border-y border-slate-800/40 ${
        isDragging ? 'bg-indigo-500 h-1.5' : ''
      } ${className}`}
      title="Drag to resize drawer"
    >
      <div className="opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none text-slate-300 group-hover:text-white">
        <GripHorizontal className="w-3 h-3" />
      </div>
    </div>
  );
};
