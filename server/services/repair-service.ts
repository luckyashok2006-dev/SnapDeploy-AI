import { geminiAIProvider } from '../providers/GeminiAIProvider';
import { RepairInput, Patch } from '../types';

export class RepairService {
  public async generatePatch(input: RepairInput): Promise<Patch> {
    if (!input.diagnosis || !input.evidence) {
      throw new Error('Diagnosis and evidence are required for repair');
    }
    return geminiAIProvider.generatePatch(input);
  }
}

export const repairService = new RepairService();
