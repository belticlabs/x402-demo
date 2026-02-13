/**
 * Credential API route for x402 demo
 * 
 * Returns the decoded agent credential for badge display.
 * Uses the credential-loader utility which loads from .beltic/ directory.
 */

import { NextResponse } from 'next/server';
import {
  getCredential,
  getCredentialInfo,
  calculatePricing,
  type CredentialInfo,
} from '@/lib/credential-loader';
import { evaluateModelPolicy } from '@/lib/model-policy';

// Response type for the credential endpoint
interface CredentialResponse {
  success: boolean;
  credential?: {
    // Identity
    agentName: string;
    agentId: string;
    agentVersion: string;
    agentDescription: string;
    credentialId: string;
    
    // Model (from credential schema)
    modelProvider: string;
    modelFamily: string;
    modelContextWindow: number;
    architectureType: string;
    modalities: string[];
    languages: string[];
    
    // Runtime model (actual model used)
    runtimeModel: {
      provider: string;
      model: string;
      modelId: string;
    };
    
    // Verification
    issuerDid: string;
    verificationLevel: string;
    kybTier: string;
    developerVerified: boolean;
    
    // Safety
    overallSafetyRating: string;
    safetyScores: {
      harmfulContent: number;
      promptInjection: number;
      piiLeakage: number;
      toolAbuse: number;
    };
    averageSafetyScore: number;
    
    // Tools
    toolsCount: number;
    tools: Array<{
      name: string;
      riskCategory: string;
      requiresApproval: boolean;
    }>;
    
    // Data handling
    dataCategories: string[];
    dataRetention: string;
    complianceCerts: string[];
    deploymentRegion: string;
    
    // Validity
    issuedAt: string;
    expiresAt: string;
    status: string;
    
    // Pricing (calculated from credential)
    pricing: {
      basePrice: number;
      discount: number;
      finalPrice: number;
      kybDiscount: number;
      safetyDiscount: number;
    };
    
    // Source info (where credential was loaded from)
    source: {
      loadedFrom: string;
      belticDir: string;
    };
  };
  error?: string;
  warnings?: string[];
}

/**
 * Convert CredentialInfo to response format
 */
function toResponse(info: CredentialInfo, warnings: string[]): CredentialResponse {
  const pricing = calculatePricing(info);
  
  return {
    success: true,
    credential: {
      // Identity
      agentName: info.agentName,
      agentId: info.agentId,
      agentVersion: info.agentVersion,
      agentDescription: info.agentDescription,
      credentialId: info.credentialId,
      
      // Model (from credential schema)
      modelProvider: info.modelProvider,
      modelFamily: info.modelFamily,
      modelContextWindow: info.modelContextWindow,
      architectureType: info.architectureType,
      modalities: info.modalities,
      languages: info.languages,
      
      // Runtime model (actual model used)
      runtimeModel: info.runtimeModel,
      
      // Verification
      issuerDid: info.issuerDid,
      verificationLevel: info.verificationLevel,
      kybTier: info.kybTier,
      developerVerified: info.developerVerified,
      
      // Safety
      overallSafetyRating: info.overallSafetyRating,
      safetyScores: info.safetyScores,
      averageSafetyScore: info.averageSafetyScore,
      
      // Tools
      toolsCount: info.toolsCount,
      tools: info.tools,
      
      // Data handling
      dataCategories: info.dataCategories,
      dataRetention: info.dataRetention,
      complianceCerts: info.complianceCerts,
      deploymentRegion: info.deploymentRegion,
      
      // Validity
      issuedAt: info.issuedAt,
      expiresAt: info.expiresAt,
      status: info.status,
      
      // Pricing
      pricing,
      
      // Source
      source: {
        loadedFrom: info.loadedFrom,
        belticDir: info.belticDir,
      },
    },
    warnings: warnings.length > 0 ? warnings : undefined,
  };
}

export async function GET(): Promise<NextResponse<CredentialResponse>> {
  try {
    // Load credential using the shared utility
    const result = getCredential();
    
    // Check if credential was loaded successfully
    if (!result.success || !result.credential) {
      console.error('[Credential API] Failed to load credential:', result.errors);
      return NextResponse.json(
        {
          success: false,
          error: result.errors.join('; ') || 'Failed to load credential',
          warnings: result.errors,
        },
        { status: 404 }
      );
    }
    
    // Extract credential info
    const info = getCredentialInfo();
    const modelPolicy = evaluateModelPolicy(info.modelProvider, info.modelFamily);
    const warnings = [...result.errors];

    if (!modelPolicy.allowed) {
      warnings.push(
        ...modelPolicy.reasons.map((reason) => `Model policy warning: ${reason}`)
      );
    }
    
    // Log the source
    console.log(`[Credential API] Serving credential from: ${result.path}`);
    console.log(`[Credential API] Agent: ${info.agentName} (${info.agentId})`);
    console.log(`[Credential API] Model: ${info.modelProvider}/${info.modelFamily}`);
    console.log(`[Credential API] Tools: ${info.toolsCount}, Safety: ${info.averageSafetyScore}/100`);
    
    // Return the credential data
    return NextResponse.json(toResponse(info, warnings));
    
  } catch (error) {
    console.error('[Credential API] Error:', error);
    
    return NextResponse.json(
      {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to load credential',
      },
      { status: 500 }
    );
  }
}
