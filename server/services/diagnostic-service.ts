import { geminiAIProvider } from '../providers/GeminiAIProvider';
import { DiagnosticInput, Diagnosis } from '../types';

export class DiagnosticService {
  public async diagnose(input: DiagnosticInput): Promise<Diagnosis> {
    if (!input.evidence) {
      throw new Error('Diagnostic evidence is required');
    }
    return geminiAIProvider.diagnoseFailure(input);
  }
}

export const diagnosticService = new DiagnosticService();
