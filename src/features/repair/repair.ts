import { RepairInput, Patch } from '../../types/workspace';
import { apiRequest } from '../../lib/api';

export async function generatePatch(input: RepairInput): Promise<Patch> {
  return apiRequest<Patch>('/api/repair', {
    method: 'POST',
    body: input
  });
}
