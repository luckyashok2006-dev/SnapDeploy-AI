import {
  GenerationInput,
  ProjectPlan,
  DiagnosticInput,
  Diagnosis,
  RepairInput,
  Patch,
  EditInput,
  EditProposal
} from '../types';

export interface GeneratedProjectPayload {
  plan: ProjectPlan;
  files: Record<string, string>;
}

export interface AIProvider {
  name: string;

  generateProject(input: GenerationInput): Promise<GeneratedProjectPayload>;

  diagnoseFailure(input: DiagnosticInput): Promise<Diagnosis>;

  generatePatch(input: RepairInput): Promise<Patch>;

  editProject(input: EditInput): Promise<EditProposal>;
}
