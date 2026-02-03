'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { ArrowUp } from 'lucide-react';
import clsx from 'clsx';

interface ChatInputProps {
  onSend: (message: string) => void;
  disabled?: boolean;
  placeholder?: string;
}

export default function ChatInput({ onSend, disabled = false, placeholder = 'Ask anything...' }: ChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      textarea.style.height = `${Math.min(textarea.scrollHeight, 150)}px`;
    }
  }, [input]);

  const handleSend = () => {
    if (!input.trim() || disabled) return;
    onSend(input.trim());
    setInput('');
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    // Enter to send, Shift+Enter for newline
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const canSend = input.trim() && !disabled;

  return (
    <div className="p-3 border-t border-[var(--border)]">
      <div className="bg-[var(--surface)] border border-[var(--border)] rounded-xl overflow-hidden">
        {/* Textarea */}
        <div className="px-3 py-3">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={placeholder}
            disabled={disabled}
            className={clsx(
              "w-full bg-transparent resize-none text-sm leading-relaxed",
              "placeholder:text-[var(--muted)] text-[var(--foreground)]",
              "focus:outline-none disabled:opacity-50 disabled:cursor-not-allowed",
              "min-h-[20px] max-h-[120px]"
            )}
            rows={1}
          />
        </div>

        {/* Bottom toolbar */}
        <div className="px-3 py-2 flex items-center justify-between border-t border-[var(--border)]">
          <div className="text-xs text-[var(--muted)]">
            {disabled ? 'Waiting for response...' : 'Enter to send, Shift+Enter for newline'}
          </div>

          {/* Send button */}
          <button
            onClick={handleSend}
            disabled={!canSend}
            className={clsx(
              "p-1.5 rounded-lg transition-colors",
              canSend
                ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)]"
                : "bg-[var(--surface-hover)] text-[var(--muted)] cursor-not-allowed"
            )}
          >
            <ArrowUp className="w-4 h-4" />
          </button>
        </div>
      </div>
    </div>
  );
}
