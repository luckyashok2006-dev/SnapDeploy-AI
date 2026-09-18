import { AgentRequest, AgentResponse } from "./types";

import { AGENT_SYSTEM_PROMPT } from "./prompts";

export class AgentService {
  private static instance: AgentService;

  private constructor() {}

  public static getInstance(): AgentService {
    if (!AgentService.instance) {
      AgentService.instance = new AgentService();
    }

    return AgentService.instance;
  }

  public async run(request: AgentRequest): Promise<AgentResponse> {
    try {
      const projectFiles = request.projectContext?.files ?? [];

      const context = projectFiles
        .map((file) => `FILE: ${file.path}\n\n${file.content}`)
        .join("\n\n---\n\n");

      const fullPrompt = `
${AGENT_SYSTEM_PROMPT}

PROJECT WORKSPACE:

${context || "No project files provided."}

USER REQUEST:

${request.prompt}
`;

      console.log("SnapDeploy AI Agent Request:", fullPrompt);

      return {
        success: true,
        message: "Agent service is initialized successfully.",
        changes: [],
      };
    } catch (error) {
      return {
        success: false,
        message: "The agent was unable to process the request.",
        changes: [],
        error: error instanceof Error ? error.message : "Unknown agent error",
      };
    }
  }
}

export const agentService = AgentService.getInstance();
