'use client';

import { Check, CircleDollarSign, Database, Shield, ShieldCheck, AlertCircle } from 'lucide-react';
import clsx from 'clsx';

export type PaymentStep = 'idle' | 'payment-required' | 'paying' | 'paid' | 'receiving' | 'complete' | 'error';

interface PaymentFlowProps {
  step: PaymentStep;
  isVerified: boolean;
  error?: string;
}

export default function PaymentFlow({ step, isVerified, error }: PaymentFlowProps) {
  const steps = [
    {
      id: 'payment-required',
      label: '402 Received',
      icon: CircleDollarSign,
      activeSteps: ['payment-required', 'paying', 'paid', 'receiving', 'complete'],
    },
    {
      id: 'paid',
      label: 'Payment Made',
      icon: Check,
      activeSteps: ['paid', 'receiving', 'complete'],
    },
    {
      id: 'complete',
      label: 'Data Received',
      icon: Database,
      activeSteps: ['complete'],
    },
  ];

  if (step === 'idle') {
    return null;
  }

  return (
    <div className="bg-[var(--background)] border border-[var(--border)] rounded-lg p-4 mb-4">
      {/* Header with agent badge */}
      <div className="flex items-center justify-between mb-4">
        <h4 className="text-xs font-medium text-[var(--muted-foreground)] uppercase tracking-wide">
          x402 Payment Flow
        </h4>
        <div className={clsx(
          "flex items-center gap-1.5 px-2 py-1 rounded-full text-xs font-medium",
          isVerified
            ? "bg-[var(--success-muted)] text-[var(--success)]"
            : "bg-[var(--surface-hover)] text-[var(--muted-foreground)]"
        )}>
          {isVerified ? (
            <>
              <ShieldCheck className="w-3 h-3" />
              <span>Verified Agent</span>
            </>
          ) : (
            <>
              <Shield className="w-3 h-3" />
              <span>Anonymous Agent</span>
            </>
          )}
        </div>
      </div>

      {/* Error state */}
      {step === 'error' && (
        <div className="flex items-center gap-2 text-[var(--error)] text-sm">
          <AlertCircle className="w-4 h-4" />
          <span>{error || 'Payment failed'}</span>
        </div>
      )}

      {/* Progress steps */}
      {step !== 'error' && (
        <div className="flex items-center gap-2">
          {steps.map((s, index) => {
            const isActive = s.activeSteps.includes(step);
            const isPending = !isActive && steps.findIndex(st => st.activeSteps.includes(step)) < index;
            const isCurrentlyProcessing =
              (s.id === 'payment-required' && step === 'payment-required') ||
              (s.id === 'paid' && step === 'paying') ||
              (s.id === 'complete' && step === 'receiving');

            const Icon = s.icon;

            return (
              <div key={s.id} className="flex items-center gap-2 flex-1">
                <div className={clsx(
                  "flex items-center gap-2 px-3 py-2 rounded-lg flex-1 transition-all",
                  isActive && !isCurrentlyProcessing && "bg-[var(--success-muted)] border border-[var(--success)]/30",
                  isCurrentlyProcessing && "bg-[var(--accent)]/20 border border-[var(--accent)]/30 animate-pulse",
                  !isActive && isPending && "bg-[var(--surface)] border border-[var(--border)]",
                  !isActive && !isPending && "bg-[var(--surface)]/50 border border-[var(--surface)]"
                )}>
                  <Icon className={clsx(
                    "w-4 h-4",
                    isActive && !isCurrentlyProcessing && "text-[var(--success)]",
                    isCurrentlyProcessing && "text-[var(--accent)]",
                    !isActive && "text-[var(--muted)]"
                  )} />
                  <span className={clsx(
                    "text-xs font-medium",
                    isActive && !isCurrentlyProcessing && "text-[var(--success)]",
                    isCurrentlyProcessing && "text-[var(--accent)]",
                    !isActive && "text-[var(--muted)]"
                  )}>
                    {s.label}
                  </span>
                </div>
                {index < steps.length - 1 && (
                  <div className={clsx(
                    "w-4 h-0.5",
                    isActive ? "bg-[var(--success)]/50" : "bg-[var(--border)]"
                  )} />
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Additional info for verified agents */}
      {isVerified && step === 'complete' && (
        <div className="mt-3 pt-3 border-t border-[var(--border)]">
          <p className="text-xs text-[var(--muted)]">
            Agent identity verified via KYA credential. Payment tracked for accountability.
          </p>
        </div>
      )}
    </div>
  );
}
