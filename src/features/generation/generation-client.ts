import { GeneratedProjectPayload } from '../../../server/providers/AIProvider';
import { GenerationInput } from '../../types/workspace';
import { apiRequest } from '../../lib/api';

export async function generateProject(input: GenerationInput): Promise<GeneratedProjectPayload> {
  return apiRequest<GeneratedProjectPayload>('/api/generate', {
    method: 'POST',
    body: input
  });
}
