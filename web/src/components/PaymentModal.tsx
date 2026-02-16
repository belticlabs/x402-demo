'use client';

import { Loader2, CheckCircle2, ExternalLink, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';

interface PaymentModalProps {
  isOpen: boolean;
  scenario: 'x402-only' | 'x402-kya';
  resource: string;
  basePrice: number;
  finalPrice: number;
  discount?: number;
  network: string;
  onAccept: () => void;
  onDecline: () => void;
  onVerifiedBadgeClick?: () => void;
  // Transaction state props
  isProcessing?: boolean;
  txHash?: string;
  txLink?: string;
  txError?: string;
  disableActions?: boolean;
}

export default function PaymentModal({
  isOpen,
  scenario,
  resource,
  basePrice,
  finalPrice,
  discount,
  network,
  onAccept,
  onDecline,
  onVerifiedBadgeClick,
  isProcessing = false,
  txHash,
  txLink,
  txError,
  disableActions = false,
}: PaymentModalProps) {
  if (!isOpen) return null;

  const isVerified = scenario === 'x402-kya';
  const savingsPercent = discount ? Math.round(discount * 100) : 0;
  const isSuccess = txHash && txHash !== 'simulated' && !txError;
  const isSimulated = txHash === 'simulated';
  const isActionsDisabled = isProcessing || disableActions;

  const truncateHash = (hash: string) => {
    if (hash.length <= 16) return hash;
    return `${hash.slice(0, 8)}...${hash.slice(-6)}`;
  };

  const formatPrice = (price: number) => {
    return `$${price.toFixed(4)}`;
  };

  return (
    <div className="animate-fade-in">
      <div
        className={clsx(
          'relative rounded-lg overflow-hidden',
          'bg-[var(--surface)]',
          'border border-[#2E2C23] dark:border-[#2E2C23]'
        )}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-4 py-3 border-b border-[#2E2C23] dark:border-[#2E2C23]">
          <span className="text-sm font-medium text-[var(--foreground)]">
            {resource}
          </span>
          {isVerified && (
            <button
              onClick={onVerifiedBadgeClick}
              className={clsx(
                'flex items-center gap-1 text-xs text-[var(--success)]',
                'hover:opacity-80 transition-opacity cursor-pointer'
              )}
            >
              <ShieldCheck className="w-3.5 h-3.5" />
              <span>Verified</span>
            </button>
          )}
        </div>

        {/* Content */}
        <div className="p-4 space-y-3">
          {/* Pricing */}
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-semibold text-[var(--foreground)]">
              {formatPrice(finalPrice)}
            </span>
            <span className="text-sm text-[var(--muted-foreground)]">
              {network}
            </span>
          </div>
          <p className="text-xs text-[var(--muted-foreground)]">
            Sponsored testnet payment by demo server wallet.
          </p>

          {/* Discount info for verified */}
          {isVerified && savingsPercent > 0 && (
            <div className="flex items-center gap-2 text-sm">
              <span className="text-[var(--muted-foreground)] line-through">
                {formatPrice(basePrice)}
              </span>
              <span className="text-[var(--success)] font-medium">
                {savingsPercent}% off
              </span>
            </div>
          )}

          {/* Transaction States */}
          {isProcessing && (
            <div className="flex items-center gap-2 py-2 text-sm text-[var(--muted-foreground)]">
              <Loader2 className="w-4 h-4 animate-spin" />
              <span>Processing...</span>
            </div>
          )}

          {isSuccess && (
            <div className="flex items-center justify-between py-2">
              <div className="flex items-center gap-2 text-[var(--success)]">
                <CheckCircle2 className="w-4 h-4" />
                <span className="text-sm">Confirmed</span>
              </div>
              {txLink ? (
                <a
                  href={txLink}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="flex items-center gap-1 text-xs font-mono text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  {truncateHash(txHash!)}
                  <ExternalLink className="w-3 h-3" />
                </a>
              ) : (
                <span className="text-xs font-mono text-[var(--muted-foreground)]">
                  {truncateHash(txHash!)}
                </span>
              )}
            </div>
          )}

          {isSimulated && (
            <p className="text-xs text-[var(--muted-foreground)] py-1">
              Simulated (wallet not configured)
            </p>
          )}

          {txError && (
            <p className="text-sm text-red-500 py-1">
              {txError}
            </p>
          )}
        </div>

        {/* Actions */}
        {!isProcessing && !isSuccess && !isSimulated && (
          <div className="flex items-center gap-2 px-4 py-3 border-t border-[#2E2C23] dark:border-[#2E2C23]">
            <button
              onClick={onDecline}
              disabled={isActionsDisabled}
              className={clsx(
                'flex-1 px-4 py-2 rounded-md text-sm font-medium',
                'text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                'hover:bg-[var(--surface-hover)] transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Cancel
            </button>
            <button
              onClick={onAccept}
              disabled={isActionsDisabled}
              className={clsx(
                'flex-1 px-4 py-2 rounded-md text-sm font-medium',
                'bg-[#FF6B35] hover:bg-[#FF6B35]/90 text-white',
                'transition-colors',
                'disabled:opacity-50 disabled:cursor-not-allowed'
              )}
            >
              Pay {formatPrice(finalPrice)}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
