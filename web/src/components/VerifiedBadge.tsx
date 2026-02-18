'use client';

import { useState, useRef, useEffect, useCallback } from 'react';
import { Check, X, Cpu, Shield, Database, Wrench, FileCode } from 'lucide-react';
import clsx from 'clsx';

export interface VerifiedBadgeProps {
  // Identity
  agentName: string;
  agentId: string;
  agentVersion: string;
  agentDescription?: string;
  credentialId?: string;
  
  // Model & Architecture (from credential schema - may be "other")
  modelProvider?: string;
  modelFamily?: string;
  modelContextWindow?: number;
  architectureType?: string;
  modalities?: string[];
  languages?: string[];
  
  // Runtime model (actual model used)
  runtimeModel?: {
    provider: string;
    model: string;
    modelId: string;
  };
  
  // Verification
  kybTier: string;
  verificationLevel?: string;
  developerVerified?: boolean;
  issuer: string;
  
  // Safety
  safetyScores: {
    harmfulContent: number;
    promptInjection: number;
    piiLeakage: number;
    toolAbuse: number;
  };
  overallRating: string;
  
  // Tools
  toolsCount?: number;
  tools?: Array<{
    name: string;
    riskCategory: string;
    requiresApproval: boolean;
  }>;
  
  // Data & Compliance
  dataCategories?: string[];
  dataRetention?: string;
  complianceCerts?: string[];
  deploymentRegion?: string;
  
  // Validity
  validFrom: string;
  validUntil: string;
  status?: string;
  
  // Source
  loadedFrom?: string;
}

function truncateId(id: string, length: number = 8): string {
  if (id.length <= length) return id;
  return `${id.slice(0, length)}...`;
}

function formatArchitecture(arch: string): string {
  const map: Record<string, string> = {
    single_agent: 'Single Agent',
    tool_using: 'Tool-Using Agent',
    rag: 'RAG Pipeline',
    multi_agent: 'Multi-Agent System',
    agentic_workflow: 'Agentic Workflow',
    fine_tuned: 'Fine-Tuned Model',
    hybrid: 'Hybrid Architecture',
  };
  return map[arch] || arch;
}

function formatDataRetention(retention: string): string {
  if (!retention) return 'Not specified';
  // Parse ISO 8601 duration (e.g., P30D, P1D, PT1H)
  const match = retention.match(/P(?:(\d+)D)?(?:T(?:(\d+)H)?)?/);
  if (match) {
    const days = match[1] ? parseInt(match[1]) : 0;
    const hours = match[2] ? parseInt(match[2]) : 0;
    if (days > 0) return `${days} day${days > 1 ? 's' : ''}`;
    if (hours > 0) return `${hours} hour${hours > 1 ? 's' : ''}`;
  }
  return retention;
}

export default function VerifiedBadge({
  agentName,
  agentId,
  agentVersion,
  agentDescription,
  credentialId,
  modelProvider,
  modelFamily,
  modelContextWindow,
  architectureType,
  modalities,
  languages,
  runtimeModel,
  kybTier,
  verificationLevel,
  developerVerified,
  issuer,
  safetyScores,
  overallRating,
  toolsCount,
  tools,
  dataCategories,
  dataRetention,
  complianceCerts,
  deploymentRegion,
  validFrom,
  validUntil,
  status,
  loadedFrom,
}: VerifiedBadgeProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeTab, setActiveTab] = useState<'identity' | 'model' | 'safety' | 'data'>('identity');
  const [position, setPosition] = useState<'bottom-left' | 'bottom-right' | 'top-left'>('bottom-left');
  const badgeRef = useRef<HTMLButtonElement>(null);
  const popoverRef = useRef<HTMLDivElement>(null);
  const hoverTimeoutRef = useRef<NodeJS.Timeout | null>(null);

  const averageScore = Math.round(
    (safetyScores.harmfulContent +
      safetyScores.promptInjection +
      safetyScores.piiLeakage +
      safetyScores.toolAbuse) / 4
  );
  const declaredModel = [modelProvider, modelFamily]
    .filter((part): part is string => Boolean(part))
    .join('/');

  const calculatePosition = useCallback(() => {
    if (!badgeRef.current) return;
    const rect = badgeRef.current.getBoundingClientRect();
    const popoverWidth = 340;
    const popoverHeight = 400;
    const padding = 16;
    const spaceBelow = window.innerHeight - rect.bottom - padding;
    const spaceRight = window.innerWidth - rect.left - padding;

    if (spaceBelow >= popoverHeight) {
      setPosition(spaceRight >= popoverWidth ? 'bottom-left' : 'bottom-right');
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
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen, calculatePosition]);

  const handleMouseEnter = () => {
    hoverTimeoutRef.current = setTimeout(() => {
      calculatePosition();
      setIsOpen(true);
    }, 200);
  };

  const handleMouseLeave = () => {
    if (hoverTimeoutRef.current) {
      clearTimeout(hoverTimeoutRef.current);
      hoverTimeoutRef.current = null;
    }
  };

  useEffect(() => {
    return () => {
      if (hoverTimeoutRef.current) clearTimeout(hoverTimeoutRef.current);
    };
  }, []);

  const tabs = [
    { id: 'identity' as const, label: 'Identity', icon: FileCode },
    { id: 'model' as const, label: 'Model', icon: Cpu },
    { id: 'safety' as const, label: 'Safety', icon: Shield },
    { id: 'data' as const, label: 'Data', icon: Database },
  ];

  return (
    <div className="relative inline-block">
      {/* Badge */}
      <button
        ref={badgeRef}
        onClick={() => { calculatePosition(); setIsOpen(prev => !prev); }}
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
        {/* Ping indicator */}
        <span className="relative flex h-2 w-2 ml-0.5">
          <span className="animate-ping absolute inset-0 rounded-full bg-[var(--success)] opacity-75" />
          <span className="relative inline-flex rounded-full h-2 w-2 bg-[var(--success)]" />
        </span>
      </button>

      {/* Popover */}
      {isOpen && (
        <div
          ref={popoverRef}
          onMouseEnter={() => hoverTimeoutRef.current && clearTimeout(hoverTimeoutRef.current)}
          onMouseLeave={handleMouseLeave}
          className={clsx(
            'absolute z-50 w-[340px]',
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
            <div className="flex items-center gap-2">
              <div className="w-6 h-6 rounded bg-[var(--success)]/20 flex items-center justify-center">
                <Check className="w-3.5 h-3.5 text-[var(--success)]" />
              </div>
              <div>
                <h3 className="text-xs font-medium text-[var(--foreground)]">Agent Certificate</h3>
                <p className="text-[10px] text-[var(--muted)]">{status || 'active'}</p>
              </div>
            </div>
            <button
              onClick={() => setIsOpen(false)}
              className="p-0.5 rounded text-[var(--muted)] hover:text-[var(--foreground)] transition-colors"
              aria-label="Close"
            >
              <X className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tabs */}
          <div className="flex border-b border-[var(--border)]">
            {tabs.map(tab => (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={clsx(
                  'flex-1 flex items-center justify-center gap-1 px-2 py-1.5 text-[10px] font-medium transition-colors',
                  activeTab === tab.id
                    ? 'text-[var(--foreground)] border-b-2 border-[var(--success)]'
                    : 'text-[var(--muted)] hover:text-[var(--foreground)]'
                )}
              >
                <tab.icon className="w-3 h-3" />
                {tab.label}
              </button>
            ))}
          </div>

          {/* Content */}
          <div className="px-3 py-2 space-y-2 text-xs max-h-[280px] overflow-y-auto">
            {/* Identity Tab */}
            {activeTab === 'identity' && (
              <div className="space-y-2">
                <div className="space-y-1">
                  <Row label="Agent" value={agentName} />
                  <Row label="Version" value={agentVersion} />
                  <Row label="ID" value={truncateId(agentId, 12)} title={agentId} mono />
                  {credentialId && <Row label="Credential" value={truncateId(credentialId, 12)} title={credentialId} mono />}
                </div>
                {agentDescription && (
                  <>
                    <hr className="border-[var(--border)]" />
                    <p className="text-[10px] text-[var(--muted-foreground)] leading-relaxed">{agentDescription}</p>
                  </>
                )}
                <hr className="border-[var(--border)]" />
                <div className="space-y-1">
                  <Row label="KYB Tier" value={kybTier.toUpperCase()} highlight />
                  <Row label="Verification" value={verificationLevel || 'self_attested'} />
                  <Row label="Developer" value={developerVerified ? 'Verified' : 'Self-Attested'} highlight={developerVerified} />
                  <Row label="Issuer" value={truncateId(issuer, 20)} title={issuer} />
                </div>
                <hr className="border-[var(--border)]" />
                <div className="text-[10px] text-[var(--muted)]">
                  <div>Valid: {validFrom} - {validUntil}</div>
                  {loadedFrom && <div className="mt-1 font-mono truncate" title={loadedFrom}>From: {loadedFrom}</div>}
                </div>
              </div>
            )}

            {/* Model Tab */}
            {activeTab === 'model' && (
              <div className="space-y-2">
                {/* Runtime model (actual model being used) */}
                {runtimeModel && (
                  <div className="p-2 bg-[var(--surface-hover)] rounded space-y-1">
                    <div className="text-[10px] text-[var(--muted)] uppercase tracking-wide">Runtime Model</div>
                    <Row label="Provider" value={runtimeModel.provider} highlight />
                    <Row label="Model" value={runtimeModel.model} highlight />
                    <div className="text-[10px] text-[var(--muted)] font-mono truncate" title={runtimeModel.modelId}>
                      {runtimeModel.modelId}
                    </div>
                  </div>
                )}
                <div className="space-y-1">
                  <Row label="Declared Model" value={declaredModel || 'Unknown'} />
                  {modelContextWindow && modelContextWindow > 0 && <Row label="Context" value={`${(modelContextWindow / 1000).toFixed(0)}K tokens`} />}
                  <Row label="Architecture" value={architectureType ? formatArchitecture(architectureType) : 'Unknown'} />
                </div>
                {modalities && modalities.length > 0 && (
                  <>
                    <hr className="border-[var(--border)]" />
                    <div>
                      <span className="text-[var(--muted-foreground)]">Modalities</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {modalities.map(m => (
                          <span key={m} className="px-1.5 py-0.5 bg-[var(--surface-hover)] rounded text-[10px]">{m}</span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {languages && languages.length > 0 && (
                  <>
                    <hr className="border-[var(--border)]" />
                    <div>
                      <span className="text-[var(--muted-foreground)]">Languages</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {languages.map(l => (
                          <span key={l} className="px-1.5 py-0.5 bg-[var(--surface-hover)] rounded text-[10px] uppercase">{l}</span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
                {(toolsCount !== undefined || tools) && (
                  <>
                    <hr className="border-[var(--border)]" />
                    <div className="space-y-1">
                      <Row label="Tools" value={`${toolsCount ?? tools?.length ?? 0} registered`} />
                      {tools && tools.slice(0, 3).map(t => (
                        <div key={t.name} className="flex items-center gap-1 text-[10px] text-[var(--muted-foreground)] pl-2">
                          <Wrench className="w-2.5 h-2.5" />
                          <span>{t.name}</span>
                          {t.requiresApproval && <span className="text-[var(--warning)]">(approval)</span>}
                        </div>
                      ))}
                    </div>
                  </>
                )}
              </div>
            )}

            {/* Safety Tab */}
            {activeTab === 'safety' && (
              <div className="space-y-2">
                <div className="flex items-center justify-between p-2 bg-[var(--surface-hover)] rounded">
                  <span className="text-[var(--muted-foreground)]">Overall Rating</span>
                  {/** Normalize to avoid case-sensitive mismatch e.g., LOW_RISK vs low_risk. */}
                  <span className={clsx(
                    'font-medium',
                    overallRating.toLowerCase().includes('low') ? 'text-[var(--success)]' :
                    overallRating.toLowerCase().includes('moderate') ? 'text-[var(--warning)]' :
                    overallRating.toLowerCase().includes('high') ? 'text-[var(--error)]' :
                    'text-[var(--foreground)]'
                  )}>{overallRating.toUpperCase().replace(/_/g, ' ')}</span>
                </div>
                <div className="space-y-1.5">
                  <ScoreBar label="Harmful Content" score={safetyScores.harmfulContent} />
                  <ScoreBar label="Prompt Injection" score={safetyScores.promptInjection} />
                  <ScoreBar label="PII Leakage" score={safetyScores.piiLeakage} />
                  <ScoreBar label="Tool Abuse" score={safetyScores.toolAbuse} />
                </div>
                <hr className="border-[var(--border)]" />
                <div className="flex items-center justify-between p-2 bg-[var(--success)]/10 rounded">
                  <span className="text-[var(--muted-foreground)]">Average Score</span>
                  <span className="font-medium text-[var(--success)]">{averageScore}/100</span>
                </div>
              </div>
            )}

            {/* Data Tab */}
            {activeTab === 'data' && (
              <div className="space-y-2">
                {dataCategories && (
                  <div>
                    <span className="text-[var(--muted-foreground)]">Data Categories</span>
                    <div className="flex flex-wrap gap-1 mt-1">
                      {dataCategories.map(c => (
                        <span key={c} className={clsx(
                          'px-1.5 py-0.5 rounded text-[10px]',
                          c === 'none' ? 'bg-[var(--success)]/20 text-[var(--success)]' :
                          c === 'pii' || c === 'financial' ? 'bg-[var(--warning)]/20 text-[var(--warning)]' :
                          'bg-[var(--surface-hover)]'
                        )}>{c}</span>
                      ))}
                    </div>
                  </div>
                )}
                <hr className="border-[var(--border)]" />
                <div className="space-y-1">
                  <Row label="Retention" value={formatDataRetention(dataRetention || '')} />
                  {deploymentRegion && <Row label="Region" value={deploymentRegion} />}
                </div>
                {complianceCerts && complianceCerts.length > 0 && (
                  <>
                    <hr className="border-[var(--border)]" />
                    <div>
                      <span className="text-[var(--muted-foreground)]">Compliance</span>
                      <div className="flex flex-wrap gap-1 mt-1">
                        {complianceCerts.map(c => (
                          <span key={c} className="px-1.5 py-0.5 bg-[var(--success)]/10 text-[var(--success)] rounded text-[10px] uppercase">
                            {c.replace(/_/g, ' ')}
                          </span>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// Helper components
function Row({ label, value, title, mono, highlight }: { 
  label: string; 
  value: string; 
  title?: string; 
  mono?: boolean;
  highlight?: boolean;
}) {
  return (
    <div className="flex justify-between">
      <span className="text-[var(--muted-foreground)]">{label}</span>
      <span 
        className={clsx(
          mono && 'font-mono',
          highlight ? 'text-[var(--success)]' : 'text-[var(--foreground)]'
        )} 
        title={title}
      >
        {value}
      </span>
    </div>
  );
}

function ScoreBar({ label, score }: { label: string; score: number }) {
  const getColor = (s: number) => {
    if (s >= 80) return 'bg-[var(--success)]';
    if (s >= 60) return 'bg-[var(--warning)]';
    return 'bg-[var(--error)]';
  };
  
  return (
    <div className="space-y-0.5">
      <div className="flex justify-between text-[10px]">
        <span className="text-[var(--muted-foreground)]">{label}</span>
        <span className="text-[var(--foreground)]">{score}/100</span>
      </div>
      <div className="h-1.5 bg-[var(--surface-hover)] rounded-full overflow-hidden">
        <div 
          className={clsx('h-full rounded-full transition-all', getColor(score))}
          style={{ width: `${score}%` }}
        />
      </div>
    </div>
  );
}
