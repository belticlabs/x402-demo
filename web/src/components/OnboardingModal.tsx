'use client';

import { useState, useEffect, useCallback } from 'react';
import { X, ChevronLeft, ChevronRight } from 'lucide-react';
import clsx from 'clsx';

const STORAGE_KEY = 'x402-demo-onboarding-seen';

interface Slide {
  title: string;
  subtitle?: string;
  body: string;
  diagram?: string;
}

const slides: Slide[] = [
  {
    title: 'FACT x x402',
    subtitle: 'Agent Commerce Demo',
    body: 'Two agents ask the same weather question side by side. One is anonymous, one carries a verified FACT credential. Both pay in USDC on Base Sepolia testnet. No real money. The price difference is the point.',
    diagram: `graph LR
    U((You)) --> A[Anonymous Agent]
    U --> V[Verified Agent]
    A -->|"$0.010"| W[Weather API]
    V -->|"$0.006"| W
    style U fill:#FF6B35,stroke:#E85A26,color:#fff
    style V fill:#16553A,stroke:#22C55E,color:#fff`,
  },
  {
    title: 'The Payment Flow',
    body: 'The verified agent sends its FACT credential with the request. The API verifies it cryptographically, calculates a trust-based discount, and responds with a 402 Payment Required. The agent pays on-chain and the API returns the data.',
    diagram: `sequenceDiagram
    participant A as Verified Agent
    participant W as Weather API
    participant B as Base Sepolia
    A->>W: Request + FACT credential
    Note right of W: Verify credential,<br/>calculate discount
    W-->>A: 402 Payment Required
    A->>B: Transfer USDC
    B-->>W: Payment confirmed
    W-->>A: Weather data`,
  },
  {
    title: 'Inside a Credential',
    body: "A FACT credential is a W3C Verifiable Credential carrying the agent's identity, safety evaluation scores, and business verification tier. All cryptographically signed. The API uses these to calculate pricing automatically.",
    diagram: `graph TB
    FC[FACT Credential] --> ID[Agent Identity]
    FC --> SS[Safety Scores]
    FC --> KYB[KYB Tier]
    FC --> SIG[Cryptographic Signature]
    ID --> P[Trust-Based Pricing]
    SS --> P
    KYB --> P
    style FC fill:#FF6B35,stroke:#E85A26,color:#fff
    style P fill:#16553A,stroke:#22C55E,color:#fff`,
  },
  {
    title: 'Early Access',
    body: "This is v1. We shipped it to show what agent identity and trust-based commerce can look like in practice. We're building the platform for credential issuance, verification, and access control. Looking for feedback on how identity should work for autonomous agents.",
  },
];

const darkThemeVars = {
  background: 'transparent',
  fontFamily: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
  primaryColor: '#2A2820',
  primaryBorderColor: '#3D3A2F',
  primaryTextColor: '#E8E6E0',
  secondaryColor: '#242318',
  secondaryBorderColor: '#3D3A2F',
  secondaryTextColor: '#E8E6E0',
  tertiaryColor: '#1A1913',
  tertiaryBorderColor: '#2E2C23',
  tertiaryTextColor: '#E8E6E0',
  lineColor: '#5A5850',
  textColor: '#E8E6E0',
  mainBkg: '#2A2820',
  nodeBorder: '#3D3A2F',
  nodeTextColor: '#E8E6E0',
  clusterBkg: '#1E1D17',
  clusterBorder: '#2E2C23',
  titleColor: '#E8E6E0',
  edgeLabelBackground: '#1A1913',
  actorBorder: '#3D3A2F',
  actorBkg: '#2A2820',
  actorTextColor: '#E8E6E0',
  actorLineColor: '#3D3A2F',
  signalColor: '#5A5850',
  signalTextColor: '#E8E6E0',
  labelBoxBkgColor: '#2A2820',
  labelBoxBorderColor: '#3D3A2F',
  labelTextColor: '#E8E6E0',
  loopTextColor: '#E8E6E0',
  noteBorderColor: '#3D3A2F',
  noteBkgColor: '#242318',
  noteTextColor: '#A8A69E',
  activationBorderColor: '#FF6B35',
  activationBkgColor: '#2A2820',
  sequenceNumberColor: '#14120B',
};

const lightThemeVars = {
  background: 'transparent',
  fontFamily: '"Avenir Next", "Segoe UI", system-ui, sans-serif',
  primaryColor: '#F0EFEC',
  primaryBorderColor: '#E5E4E0',
  primaryTextColor: '#1A1913',
  secondaryColor: '#FAFAF8',
  secondaryBorderColor: '#E5E4E0',
  secondaryTextColor: '#1A1913',
  tertiaryColor: '#FFFFFF',
  tertiaryBorderColor: '#E5E4E0',
  tertiaryTextColor: '#1A1913',
  lineColor: '#8A8880',
  textColor: '#1A1913',
  mainBkg: '#F0EFEC',
  nodeBorder: '#E5E4E0',
  nodeTextColor: '#1A1913',
  clusterBkg: '#FAFAF8',
  clusterBorder: '#E5E4E0',
  titleColor: '#1A1913',
  edgeLabelBackground: '#FFFFFF',
  actorBorder: '#E5E4E0',
  actorBkg: '#F0EFEC',
  actorTextColor: '#1A1913',
  actorLineColor: '#D5D4D0',
  signalColor: '#8A8880',
  signalTextColor: '#1A1913',
  labelBoxBkgColor: '#F0EFEC',
  labelBoxBorderColor: '#E5E4E0',
  labelTextColor: '#1A1913',
  loopTextColor: '#1A1913',
  noteBorderColor: '#E5E4E0',
  noteBkgColor: '#FAFAF8',
  noteTextColor: '#6B6A65',
  activationBorderColor: '#FF6B35',
  activationBkgColor: '#F0EFEC',
  sequenceNumberColor: '#FFFFFF',
};

let renderBatch = 0;

export default function OnboardingModal() {
  const [isVisible, setIsVisible] = useState(false);
  const [currentSlide, setCurrentSlide] = useState(0);
  const [diagrams, setDiagrams] = useState<Record<number, string>>({});

  useEffect(() => {
    if (!localStorage.getItem(STORAGE_KEY)) {
      setIsVisible(true);
    }
  }, []);

  // Render all mermaid diagrams once the modal is visible
  useEffect(() => {
    if (!isVisible) return;
    let cancelled = false;
    const batch = ++renderBatch;

    (async () => {
      try {
        const mermaid = (await import('mermaid')).default;
        const isLight = document.documentElement.classList.contains('light');

        mermaid.initialize({
          startOnLoad: false,
          theme: isLight ? 'default' : 'dark',
          themeVariables: isLight ? lightThemeVars : darkThemeVars,
          flowchart: { curve: 'basis', padding: 20 },
          sequence: { mirrorActors: false, bottomMarginAdj: 1 },
        });

        const rendered: Record<number, string> = {};
        for (let i = 0; i < slides.length; i++) {
          const def = slides[i].diagram;
          if (!def) continue;
          try {
            const { svg } = await mermaid.render(`ob-${batch}-${i}`, def);
            if (!cancelled) rendered[i] = svg;
          } catch (e) {
            console.error(`Mermaid render error (slide ${i}):`, e);
          }
        }
        if (!cancelled) setDiagrams(rendered);
      } catch (e) {
        console.error('Failed to load mermaid:', e);
      }
    })();

    return () => { cancelled = true; };
  }, [isVisible]);

  const dismiss = useCallback(() => {
    setIsVisible(false);
    localStorage.setItem(STORAGE_KEY, 'true');
  }, []);

  useEffect(() => {
    if (!isVisible) return;
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') dismiss();
    };
    window.addEventListener('keydown', handleKey);
    return () => window.removeEventListener('keydown', handleKey);
  }, [isVisible, dismiss]);

  if (!isVisible) return null;

  const slide = slides[currentSlide];
  const hasDiagram = !!diagrams[currentSlide];
  const isLast = currentSlide === slides.length - 1;
  const isFirst = currentSlide === 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm animate-[overlay-fade-in_200ms_ease-out]"
      onClick={dismiss}
    >
      <div
        className="relative w-full max-w-2xl mx-4 bg-[var(--surface)] border border-[var(--border)] rounded-2xl shadow-lg animate-[modal-slide-up_250ms_ease-out] overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Close */}
        <button
          onClick={dismiss}
          className="absolute top-4 right-4 z-10 p-1.5 rounded-lg text-[var(--muted)] hover:text-[var(--foreground)] hover:bg-[var(--surface-hover)] transition-colors"
        >
          <X className="w-4 h-4" />
        </button>

        {/* Diagram */}
        {hasDiagram && (
          <div className="px-8 pt-8">
            <div
              className="w-full overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--background)] p-6 flex justify-center [&_svg]:max-w-full [&_svg]:h-auto [&_svg]:max-h-[220px]"
              dangerouslySetInnerHTML={{ __html: diagrams[currentSlide] }}
            />
          </div>
        )}

        {/* Text */}
        <div className={clsx('px-8 pb-4', hasDiagram ? 'pt-5' : 'pt-10')}>
          <div className="flex items-baseline gap-3 mb-2">
            <h2 className="text-xl font-semibold text-[var(--foreground)]">{slide.title}</h2>
            {slide.subtitle && (
              <span className="text-sm text-[var(--muted)]">{slide.subtitle}</span>
            )}
          </div>
          <p className="text-sm leading-relaxed text-[var(--muted-foreground)]">{slide.body}</p>
        </div>

        {/* Footer */}
        <div className="px-8 pb-6 pt-2 flex items-center justify-between">
          <div className="flex items-center gap-1.5">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setCurrentSlide(i)}
                className={clsx(
                  'h-1.5 rounded-full transition-all duration-200',
                  i === currentSlide
                    ? 'w-5 bg-[var(--foreground)]'
                    : 'w-1.5 bg-[var(--border-hover)] hover:bg-[var(--muted)]'
                )}
              />
            ))}
          </div>

          <div className="flex items-center gap-2">
            {!isFirst && (
              <button
                onClick={() => setCurrentSlide(s => s - 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--muted-foreground)] hover:text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg transition-colors"
              >
                <ChevronLeft className="w-3.5 h-3.5" />
                Back
              </button>
            )}
            {isLast ? (
              <button
                onClick={dismiss}
                className="flex items-center gap-1 px-4 py-1.5 text-sm font-medium text-white bg-[var(--accent)] hover:bg-[var(--accent-hover)] rounded-lg transition-colors"
              >
                Get Started
              </button>
            ) : (
              <button
                onClick={() => setCurrentSlide(s => s + 1)}
                className="flex items-center gap-1 px-3 py-1.5 text-sm text-[var(--foreground)] border border-[var(--border)] hover:border-[var(--border-hover)] rounded-lg transition-colors"
              >
                Next
                <ChevronRight className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
