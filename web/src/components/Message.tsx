'use client';

import { useState } from 'react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import { Check, Copy } from 'lucide-react';
import clsx from 'clsx';

export interface MessageType {
  id: string;
  role: 'user' | 'assistant';
  content: string;
}

interface MessageProps {
  message: MessageType;
  isStreaming?: boolean;
}

export default function Message({ message, isStreaming }: MessageProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // User message - right-aligned, accent background
  if (message.role === 'user') {
    return (
      <div className="mb-4 flex justify-end">
        <div className="group relative max-w-[80%]">
          <div className="bg-[var(--accent)] text-white rounded-2xl rounded-br-md px-4 py-2.5">
            <p className="text-sm leading-relaxed whitespace-pre-wrap">{message.content}</p>
          </div>
          <button
            onClick={handleCopy}
            className="absolute -bottom-6 right-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        </div>
      </div>
    );
  }

  // Assistant message - left-aligned, dark surface
  return (
    <div className="mb-4 flex justify-start">
      <div className="group relative max-w-[80%]">
        <div className="bg-[var(--surface)] border border-[var(--border)] rounded-2xl rounded-bl-md px-4 py-2.5">
          <div className={clsx(
            "prose prose-sm prose-invert max-w-none",
            "prose-p:my-1.5 prose-p:leading-relaxed",
            "prose-ul:my-2 prose-ol:my-2 prose-li:my-0.5",
            "prose-headings:mt-3 prose-headings:mb-1.5",
            "prose-code:bg-[var(--background)] prose-code:px-1 prose-code:py-0.5 prose-code:rounded prose-code:text-xs",
            "prose-pre:bg-[var(--background)] prose-pre:p-3 prose-pre:rounded-lg",
            "prose-a:text-[var(--accent)] prose-a:no-underline hover:prose-a:underline"
          )}>
            <ReactMarkdown remarkPlugins={[remarkGfm]}>
              {message.content}
            </ReactMarkdown>
            {isStreaming && (
              <span className="inline-block w-0.5 h-4 bg-[var(--foreground)] animate-pulse ml-0.5 align-middle" />
            )}
          </div>
        </div>
        {!isStreaming && message.content && (
          <button
            onClick={handleCopy}
            className="absolute -bottom-6 left-0 opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-[var(--muted)] hover:text-[var(--foreground)]"
          >
            {copied ? (
              <>
                <Check className="w-3 h-3" />
                <span>Copied</span>
              </>
            ) : (
              <>
                <Copy className="w-3 h-3" />
                <span>Copy</span>
              </>
            )}
          </button>
        )}
      </div>
    </div>
  );
}
