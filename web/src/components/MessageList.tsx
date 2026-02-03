'use client';

import { useRef, useEffect } from 'react';
import { Loader2 } from 'lucide-react';
import Message, { MessageType } from './Message';

interface MessageListProps {
  messages: MessageType[];
  isStreaming: boolean;
  streamingMessageId: string | null;
}

export default function MessageList({ messages, isStreaming, streamingMessageId }: MessageListProps) {
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new messages
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isStreaming]);

  return (
    <div className="flex-1 overflow-y-auto px-4 py-4">
      {messages.length === 0 && (
        <div className="flex flex-col items-center justify-center h-full text-[var(--muted)]">
          <p className="text-sm">Start a conversation</p>
        </div>
      )}

      {messages.map((message) => (
        <Message
          key={message.id}
          message={message}
          isStreaming={isStreaming && message.id === streamingMessageId}
        />
      ))}

      {/* Thinking indicator when waiting for first token */}
      {isStreaming && !streamingMessageId && (
        <div className="flex items-center gap-2 text-sm text-[var(--muted-foreground)] py-2 pl-4">
          <Loader2 className="w-4 h-4 animate-spin" />
          <span>Thinking...</span>
        </div>
      )}

      <div ref={messagesEndRef} />
    </div>
  );
}
