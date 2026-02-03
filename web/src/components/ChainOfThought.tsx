'use client';

import { useEffect, useState } from 'react';

interface ChainOfThoughtProps {
  content?: string;
  isStreaming: boolean;
  startTime?: number;
  defaultExpanded?: boolean;
  variant?: 'anonymous' | 'verified';
}

export default function ChainOfThought({
  isStreaming,
  startTime,
}: ChainOfThoughtProps) {
  const [elapsedTime, setElapsedTime] = useState(0);

  useEffect(() => {
    if (!startTime) return;

    const updateTime = () => {
      setElapsedTime((Date.now() - startTime) / 1000);
    };

    updateTime();

    if (isStreaming) {
      const interval = setInterval(updateTime, 100);
      return () => clearInterval(interval);
    }
  }, [startTime, isStreaming]);

  const formatTime = (seconds: number) => {
    return seconds.toFixed(1) + 's';
  };

  return (
    <div className="mb-2">
      <span className="text-xs text-[var(--muted-foreground)] italic">
        {isStreaming ? (
          <span className="inline-flex items-center gap-1.5">
            <span className="inline-block w-1 h-1 bg-[var(--muted-foreground)] rounded-full animate-pulse" />
            Thinking...
          </span>
        ) : (
          <span>Thought for {formatTime(elapsedTime)}</span>
        )}
      </span>
    </div>
  );
}
