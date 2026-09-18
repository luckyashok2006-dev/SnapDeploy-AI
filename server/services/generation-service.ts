import { geminiAIProvider } from '../providers/GeminiAIProvider';
import { GenerationInput } from '../types';
import { GeneratedProjectPayload } from '../providers/AIProvider';

export class GenerationService {
  public async generate(input: GenerationInput): Promise<GeneratedProjectPayload> {
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new Error('Generation prompt cannot be empty');
    }
    return geminiAIProvider.generateProject(input);
  }
}

export const generationService = new GenerationService();
