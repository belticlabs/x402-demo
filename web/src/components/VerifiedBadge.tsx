'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X } from 'lucide-react';
import clsx from 'clsx';

export interface VerifiedBadgeProps {
  agentName: string;
  agentId: string;
  agentVersion: string;
  kybTier: string;
  safetyScores: {
    harmfulContent: number;
    promptInjection: number;
    piiLeakage: number;
    toolAbuse: number;
  };
  overallRating: string;
  validFrom: string;
  validUntil: string;
  issuer: string;
}

function truncateId(id: string, length: number = 12): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

export default function VerifiedBadge({
  agentName,
  agentId,
  agentVersion,
  kybTier,
  safetyScores,
  overallRating,
  validFrom,
  validUntil,
  issuer,
}: VerifiedBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [position, setPosition] = useState<'bottom-left' | 'bottom-right' | 'top-left'>('bottom-left');
  const badgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const averageScore = Math.round(
    (safetyScores.harmfulContent +
      safetyScores.promptInjection +
      safetyScores.piiLeakage +
      safetyScores.toolAbuse) /
      4
  );

  const calculatePosition = useCallback(() => {
    if (!badgeRef.current) return;

    const rect = badgeRef.current.getBoundingClientRect();
    const popoverWidth = 280;
    const popoverHeight = 280;
    const padding = 16;

    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const spaceRight = window.innerWidth - rect.left - padding;

    // Prefer bottom-left, but adjust if not enough space
    if (spaceBelow >= popoverHeight) {
      if (spaceRight >= popoverWidth) {
        setPosition('bottom-left');
      } else {
        setPosition('bottom-right');
      }
    } else {
      setPosition('top-left');
    }
  }, []);

  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(event.target as Node) &&
        badgeRef.current &&
        !badgeRef.current.contains(event.target as Node)
      ) {
        setIsOpen(false);
      }
    }

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      calculatePosition();
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [isOpen, calculatePosition]);

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      setIsOpen(true);
    }, 200);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  const handleClick = () => {
    calculatePosition();
    setIsOpen((prev) => !prev);
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) {
        clearTimeout(hoverTimeoutRef.current);
      }
    };
  }, []);

  return (
    <div className="relative inline-block">
      {/* Badge - small and subtle */}
      <button
        ref={badgeRef}
        onClick={handleClick}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        className={clsx(
          'inline-flex items-center gap-1 px-1.5 py-0.5 rounded',
          'bg-[var(--success)]/15 text-[var(--success)] text-xs',
          'transition-colors duration-150',
          'hover:bg-[var(--success)]/25',
          'focus:outline-none focus:ring-1 focus:ring-[var(--success)]/50'
        )}
        aria-expanded={isOpen}
        aria-haspopup="dialog"
      >
        <Check className="w-3 h-3" />
        <span>Verified</span>
      </button>

      {/* Popover - clean and minimal */}
      {isOpen && (
        <div
          ref={popoverRef}
          onMouseEnter={() => {
            if (hoverTimeoutRef.current) {
              clearTimeout(hoverTimeoutRef.current);
            }
          }}
          onMouseLeave={handleMouseLeave}
          className={clsx(
            'absolute z-50 w-[280px]',
            'bg-[var(--surface)] border border-[var(--border)] rounded-lg',
            'shadow-lg',
            position === 'bottom-left' && 'top-full mt-2 right-0',
            position === 'bottom-right' && 'top-full mt-2 right-0',
            position === 'top-left' && 'bottom-full mb-2 right-0'
          )}
          role="dialog"
          aria-label="Agent Certificate Details"
        >
          {/* Header */}
          <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--border)]">
            <h3 className="text-xs font-medium text-[var(--foreground)]">
              Agent Certificate
            </h3>
            <button
              onClick={() => setIsOpen(false)}
              className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Content */}
          <div className="px-3 py-2 space-y-2 text-xs">
            {/* Agent Info */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Agent</span>
                <span className="text-[var(--foreground)]">{agentName}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">ID</span>
                <span className="text-[var(--foreground)] font-mono" title={agentId}>
                  {truncateId(agentId)}
                </span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Version</span>
                <span className="text-[var(--foreground)]">{agentVersion}</span>
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            {/* Verification */}
            <div className="space-y-1">
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">KYB Tier</span>
                <span className="text-[var(--foreground)]">{kybTier}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Safety Score</span>
                <span className="text-[var(--foreground)]">{averageScore}/100</span>
              </div>
              <div className="flex justify-between">
                <span className="text-[var(--muted-foreground)]">Rating</span>
                <span className="text-[var(--success)]">{overallRating}</span>
              </div>
            </div>

            <hr className="border-[var(--border)]" />

            {/* Footer */}
            <div className="text-[10px] text-[var(--muted)]">
              <div>Valid: {validFrom} - {validUntil}</div>
              <div>Issuer: {issuer}</div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
