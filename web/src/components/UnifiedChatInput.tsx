'use client';

import { useState, useRef, useEffect, KeyboardEvent } from 'react';
import { ArrowUp, Lightbulb } from 'lucide-react';
import clsx from 'clsx';

interface UnifiedChatInputProps {
  onSend: (message: string) => void;
  disabled: boolean;
  placeholder?: string;
}

const SUGGESTION_CHIPS = [
  "What's the weather in NYC?",
  "Detailed weather for Tokyo",
  "Is it raining in London?",
  "San Francisco forecast",
];

export default function UnifiedChatInput({
  onSend,
  disabled,
  placeholder = "Ask about weather in any city...",
}: UnifiedChatInputProps) {
  const [input, setInput] = useState('');
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Auto-resize textarea up to 3 lines (approximately 72px)
  useEffect(() => {
    const textarea = textareaRef.current;
    if (textarea) {
      textarea.style.height = 'auto';
      // 24px per line * 3 lines = 72px max
      textarea.style.height = `${Math.min(textarea.scrollHeight, 72)}px`;
    }
  }, [input]);

  // Focus textarea on mount
  useEffect(() => {
    if (textareaRef.current && !disabled) {
      textareaRef.current.focus();
    }
  }, [disabled]);

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

  const handleSuggestionClick = (suggestion: string) => {
    if (disabled) return;
    onSend(suggestion);
  };

  const canSend = input.trim() && !disabled;

  return (
    <div
      className={clsx(
        "sticky bottom-0 w-full",
        "border-t border-[var(--border)]",
        "glass" // Uses the glass utility class from globals.css
      )}
      role="region"
      aria-label="Chat input"
    >
      <div className="max-w-4xl mx-auto px-4 py-4">
        {/* Main input container */}
        <div
          className={clsx(
            "bg-[var(--surface)] border border-[var(--border)] rounded-2xl",
            "shadow-lg transition-all duration-200",
            "focus-within:border-[var(--border-hover)] focus-within:shadow-xl",
            disabled && "opacity-60"
          )}
        >
          {/* Textarea row */}
          <div className="flex items-end gap-3 px-4 py-3">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder={placeholder}
              disabled={disabled}
              aria-label="Message input"
              aria-describedby="input-hint"
              className={clsx(
                "flex-1 bg-transparent resize-none text-base leading-6",
                "placeholder:text-[var(--muted)] text-[var(--foreground)]",
                "focus:outline-none disabled:cursor-not-allowed",
                "min-h-[24px] max-h-[72px]"
              )}
              rows={1}
            />

            {/* Send button */}
            <button
              onClick={handleSend}
              disabled={!canSend}
              aria-label={canSend ? "Send message" : "Cannot send - input is empty or processing"}
              className={clsx(
                "flex-shrink-0 p-2.5 rounded-xl transition-all duration-200",
                canSend
                  ? "bg-[var(--accent)] text-white hover:bg-[var(--accent-hover)] hover:scale-105 active:scale-95"
                  : "bg-[var(--surface-hover)] text-[var(--muted)] cursor-not-allowed"
              )}
            >
              <ArrowUp className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Hint and suggestions */}
        <div className="mt-3 space-y-2">
          {/* Hint text */}
          <p
            id="input-hint"
            className="text-xs text-[var(--muted)] text-center flex items-center justify-center gap-1.5"
          >
            <Lightbulb className="w-3.5 h-3.5" />
            <span>
              {disabled
                ? "Waiting for responses..."
                : 'Try: "What\'s the weather in Tokyo?" or "Give me detailed NYC"'}
            </span>
          </p>

          {/* Suggestion chips */}
          <div
            className="flex flex-wrap justify-center gap-2"
            role="group"
            aria-label="Quick suggestions"
          >
            {SUGGESTION_CHIPS.map((suggestion) => (
              <button
                key={suggestion}
                onClick={() => handleSuggestionClick(suggestion)}
                disabled={disabled}
                aria-label={`Send: ${suggestion}`}
                className={clsx(
                  "px-3 py-1.5 text-xs rounded-full",
                  "border border-[var(--border)] bg-[var(--surface)]",
                  "text-[var(--muted-foreground)]",
                  "transition-all duration-200",
                  disabled
                    ? "opacity-50 cursor-not-allowed"
                    : "hover:border-[var(--border-hover)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] hover:scale-105 active:scale-95"
                )}
              >
                {suggestion}
              </button>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
