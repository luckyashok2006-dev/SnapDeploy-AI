export type AgentRole = "system" | "user" | "assistant";

export interface AgentMessage {
  role: AgentRole;
  content: string;
}

export interface AgentFileChange {
  path: string;
  content: string;
}

export interface AgentRequest {
  prompt: string;

  messages?: AgentMessage[];

  projectContext?: {
    files: Array<{
      path: string;
      content: string;
    }>;
  };
}

export interface AgentResponse {
  success: boolean;

  message: string;

  changes: AgentFileChange[];

  error?: string;
}
