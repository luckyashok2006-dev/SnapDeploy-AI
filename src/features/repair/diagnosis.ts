import { DiagnosticInput, Diagnosis } from '../../types/workspace';
import { apiRequest } from '../../lib/api';

export async function diagnoseFailure(input: DiagnosticInput): Promise<Diagnosis> {
  return apiRequest<Diagnosis>('/api/diagnose', {
    method: 'POST',
    body: input
  });
}
