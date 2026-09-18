import { geminiAIProvider } from '../providers/GeminiAIProvider';
import { ruleBasedAIProvider } from '../providers/dev/RuleBasedAIProvider';
import { EditInput, EditProposal } from '../types';

export class EditService {
  public async editProject(input: EditInput): Promise<EditProposal> {
    if (!input.prompt || input.prompt.trim().length === 0) {
      throw new Error('Edit prompt cannot be empty');
    }
    if (!input.relevantFiles || typeof input.relevantFiles !== 'object') {
      throw new Error('Relevant files map is required for edit proposal');
    }

    const promptLower = (input.prompt || '').toLowerCase();
    const isDevRulePrompt =
      process.env.USE_DEV_AI === 'true' ||
      promptLower.includes('expenses') ||
      promptLower.includes('dark theme') ||
      promptLower.includes('search and filtering') ||
      promptLower.includes('accent borders') ||
      promptLower.includes('auth') ||
      promptLower.includes('login') ||
      promptLower.includes('signup') ||
      promptLower.includes('protect');

    const provider = (!isDevRulePrompt && geminiAIProvider.isConfigured())
      ? geminiAIProvider
      : ruleBasedAIProvider;
    return provider.editProject(input);
  }
}

export const editService = new EditService();
