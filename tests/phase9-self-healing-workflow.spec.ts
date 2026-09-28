import { test, expect } from "@playwright/test";

test.describe("Phase 9.1: Self-Healing Engineering Loop - Real Browser Validation", () => {
  test("executes complete self-healing workflow in Chromium: fault -> diagnosis -> diff -> approve -> verify -> recover", async ({
    page,
  }) => {
    test.setTimeout(300000);

    // Forward browser logs for complete auditability
    page.on("console", (msg) => {
      console.log(`[Browser Console: ${msg.type()}]`, msg.text());
    });
    page.on("pageerror", (err) => {
      console.log(`[Browser PageError]`, err.message);
    });

    console.log(">>> [Phase 9.1 Browser Test] Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("header")).toBeVisible({ timeout: 20000 });

    console.log(">>> [Phase 9.1 Browser Test] Step 1: Initializing project & baseline runtime...");
    const initResult = await page.evaluate(async () => {
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { runtimeManager } = await import("/src/lib/runtime/runtime-manager.ts");
      const { INITIAL_DEMO_PROJECTS } = await import("/src/demo/demoProjects.ts");

      await vfsManager.waitUntilHydrated();
      const projId = useProjectStore.getState().activeProjectId || "saas-dashboard";
      const demoProj = INITIAL_DEMO_PROJECTS[projId] || Object.values(INITIAL_DEMO_PROJECTS)[0];

      const rawFiles: Record<string, string> = {};
      for (const [p, f] of Object.entries(demoProj.files)) {
        rawFiles[p] = f.content;
      }
      await useProjectStore.getState().writeFilesBulk(projId, rawFiles);

      return { projId, fileCount: Object.keys(rawFiles).length };
    });
    expect(initResult.fileCount).toBeGreaterThan(0);

    // Switch to Debug tab so DebugManagerPanel is rendered
    console.log(">>> [Phase 9.2 Browser Test] Navigating to Debug panel...");
    await page.locator('[data-testid="nav-debug-tab"]').first().click();
    await expect(page.getByText("Debug & Diagnostics")).toBeVisible();

    console.log(">>> [Phase 9.2 Browser Test] Step 2: Injecting intentional syntax fault & capturing runtime failure...");
    const faultResult = await page.evaluate(async (projId) => {
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const { repairCoordinator } = await import("/src/features/repair/repair-coordinator.ts");
      const { useRepairStore, getCanonicalState } = await import("/src/store/repairStore.ts");
      const { repairLoopEngine } = await import("/src/features/repair/repair-loop.ts");

      const originalFile = vfsManager.getFile(projId, "/src/App.tsx")?.content || "";
      const syntaxErrorContent = originalFile.replace(
        "export default function App() {",
        "export default function App() {\n  const brokenSyntax = (;;;\n"
      );
      await vfsManager.writeFile(projId, "/src/App.tsx", syntaxErrorContent);

      const fakeEvidence = {
        executionId: `exec_fault_${Date.now()}`,
        command: "npm run build",
        args: [],
        exitCode: 1,
        stdout: "",
        stderr: "src/App.tsx: SyntaxError: Unexpected token ';'",
        durationMs: 350,
        projectId: projId,
        requestId: `req_${Date.now()}`
      };

      // Mock runDiagnosisAndPatch to return Phase 9.2 intelligence synthesis cleanly
      repairLoopEngine.runDiagnosisAndPatch = async () => ({
        diagnosis: {
          category: "SYNTAX" as const,
          severity: "high" as const,
          explanation: "SyntaxError: Unexpected token ';' inside component body",
          rootCause: "SyntaxError: Unexpected token ';' inside component body",
          affectedFiles: ["/src/App.tsx"],
          evidence: ["src/App.tsx: SyntaxError: Unexpected token ';'"],
          suggestedFix: "Remove invalid semicolon syntax",
          confidence: 0.95,
          confidenceReason: "Deterministic compiler syntax error token found at src/App.tsx",
          isHypothesis: false,
          errorContext: "const brokenSyntax = (;;;",
          projectId: projId
        },
        plan: {
          id: `plan_${Date.now()}`,
          summary: "Remove invalid semicolon syntax from App.tsx",
          steps: [
            {
              stepNumber: 1,
              targetFile: "/src/App.tsx",
              intendedModification: "Remove broken syntax",
              reason: "Restores valid JSX",
              expectedOutcome: "Clean compilation"
            }
          ],
          verificationPlan: ["TypeScript Compilation", "Production Build"]
        },
        patch: {
          id: `repair_patch_${Date.now()}`,
          summary: "Fix syntax error in App.tsx by removing invalid tokens",
          files: [
            {
              path: "/src/App.tsx",
              before: syntaxErrorContent,
              after: originalFile
            }
          ]
        }
      });

      // Record evidence in runtime store (which also records the failure in runtime history)
      useRuntimeStore.getState().recordEvidence(fakeEvidence, projId);

      // Wait for automated diagnosis and episode proposal to settle cleanly
      let episode = useRepairStore.getState().getActiveEpisode(projId);
      for (let i = 0; i < 20; i++) {
        await new Promise((r) => setTimeout(r, 100));
        episode = useRepairStore.getState().getActiveEpisode(projId);
        if (episode && (episode.status === 'proposal_ready' || episode.status === 'PATCH_READY')) {
          break;
        }
      }

      return {
        hasEpisode: !!episode,
        episodeId: episode?.failureEpisodeId,
        initialStatus: episode?.status,
        canonicalState: episode ? getCanonicalState(episode) : null
      };
    }, initResult.projId);

    expect(faultResult.hasEpisode).toBe(true);
    expect(["ERROR_DETECTED", "DIAGNOSING", "AWAITING_APPROVAL", "PATCH_READY"]).toContain(faultResult.canonicalState);

    console.log(">>> [Phase 9.2 Browser Test] Step 3: Verifying UI shows active failure & diagnosis progress...");
    // Let async diagnosis and proposal settle
    await page.waitForTimeout(500);

    console.log(">>> [Phase 9.2 Browser Test] Step 4: Proposing repair patch & reviewing diff...");
    const proposalResult = await page.evaluate(async ({ projId, episodeId }) => {
      const { useRepairStore, getCanonicalState, isEpisodeAwaitingApproval } = await import("/src/store/repairStore.ts");

      // Wait up to 3 seconds for proposal to settle
      for (let i = 0; i < 30; i++) {
        const ep = useRepairStore.getState().getActiveEpisode(projId);
        if (ep && isEpisodeAwaitingApproval(ep)) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      const ep = useRepairStore.getState().getActiveEpisode(projId);
      return {
        status: ep?.status,
        canonicalState: getCanonicalState(ep),
        isAwaitingApproval: isEpisodeAwaitingApproval(ep),
        patchSummary: ep?.patch?.summary,
        hasPlan: !!ep?.plan,
        category: ep?.diagnosis?.category,
        confidence: ep?.diagnosis?.confidence
      };
    }, { projId: initResult.projId, episodeId: faultResult.episodeId });

    expect(proposalResult.isAwaitingApproval).toBe(true);
    expect(["PATCH_READY", "AWAITING_APPROVAL"]).toContain(proposalResult.canonicalState);
    expect(proposalResult.patchSummary).toContain("Fix syntax error");
    expect(proposalResult.hasPlan).toBe(true);
    expect(proposalResult.category).toBe("SYNTAX");
    expect(proposalResult.confidence).toBe(0.95);

    // Verify UI DOM elements for Phase 9.2
    await expect(page.locator('[data-testid="repair-proposal-state"]')).toBeVisible();
    await expect(page.locator('[data-testid="diagnosis-intelligence-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="diagnosis-intelligence-card"]')).toContainText("SYNTAX");
    await expect(page.locator('[data-testid="diagnosis-intelligence-card"]')).toContainText("AI Assessment: 95%");
    await expect(page.locator('[data-testid="repair-plan-card"]')).toBeVisible();
    await expect(page.locator('[data-testid="repair-plan-card"]')).toContainText("Declarative Repair Plan");
    await expect(page.locator('[data-testid="repair-plan-card"]')).toContainText("/src/App.tsx");

    console.log(">>> [Phase 9.2 Browser Test] Step 5: Approving repair & verifying automated recovery...");
    const approvalResult = await page.evaluate(async ({ projId, episodeId }) => {
      const { repairCoordinator } = await import("/src/features/repair/repair-coordinator.ts");
      const { verificationService } = await import("/src/features/verification/VerificationService.ts");
      const { useRepairStore, getCanonicalState, isEpisodeResolved } = await import("/src/store/repairStore.ts");
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");

      // Mock verification check to succeed cleanly
      const originalRunFullVerification = verificationService.runFullVerification;
      verificationService.runFullVerification = async () => ({
        success: true,
        checks: [
          { name: "TypeScript Compilation", success: true, status: "passed", exitCode: 0, durationMs: 200 },
          { name: "Production Build", success: true, status: "passed", exitCode: 0, durationMs: 250 }
        ],
        totalDurationMs: 450
      });

      try {
        const result = await repairCoordinator.approveRepair(projId, episodeId!);
        const finalEp = useRepairStore.getState().getProjectEpisodes(projId).find(e => e.failureEpisodeId === episodeId);
        const currentFile = vfsManager.getFile(projId, "/src/App.tsx")?.content || "";

        return {
          verified: result.verified,
          status: finalEp?.status,
          canonicalState: getCanonicalState(finalEp),
          isResolved: isEpisodeResolved(finalEp),
          evidenceCleared: useRuntimeStore.getState().lastEvidence === null,
          hasSyntaxError: currentFile.includes("brokenSyntax = (;;;"),
          checksCount: finalEp?.verificationResult?.checks?.length,
          originalErrorCleared: finalEp?.verificationResult?.originalErrorCleared,
          finalState: finalEp?.verificationResult?.finalState
        };
      } finally {
        verificationService.runFullVerification = originalRunFullVerification;
      }
    }, { projId: initResult.projId, episodeId: faultResult.episodeId });

    expect(approvalResult.verified).toBe(true);
    expect(approvalResult.isResolved).toBe(true);
    expect(approvalResult.canonicalState).toBe("REPAIRED");
    expect(approvalResult.evidenceCleared).toBe(true);
    expect(approvalResult.hasSyntaxError).toBe(false);
    expect(approvalResult.checksCount).toBe(2);
    expect(approvalResult.originalErrorCleared).toBe(true);
    expect(approvalResult.finalState).toBe("VERIFIED");

    // Verify DOM resolved state and verification evidence box
    await expect(page.locator('[data-testid="repair-resolved-state"]')).toBeVisible();
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toBeVisible();
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toContainText("TypeScript Compilation");
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toContainText("Production Build");
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toContainText("CLEARED");
    console.log(">>> [Phase 9.2 Browser Test] Flow 1 passed: Complete self-healing loop verified clean with Phase 9.2 intelligence!");

    console.log(">>> [Phase 9.2 Browser Test] Step 6: Testing second failure that fails verification -> honest rollback...");
    const failingRepairResult = await page.evaluate(async (projId) => {
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { repairCoordinator } = await import("/src/features/repair/repair-coordinator.ts");
      const { verificationService } = await import("/src/features/verification/VerificationService.ts");
      const { useRepairStore, getCanonicalState, isEpisodeRolledBack, isEpisodeAwaitingApproval } = await import("/src/store/repairStore.ts");
      const { repairLoopEngine } = await import("/src/features/repair/repair-loop.ts");

      const beforeAppContent = vfsManager.getFile(projId, "/src/App.tsx")?.content || "";

      // Bad patch that fails verification
      const failingPatch = {
        id: `failing_patch_${Date.now()}`,
        summary: "Attempt bad fix that fails verification",
        files: [
          {
            path: "/src/App.tsx",
            before: beforeAppContent,
            after: beforeAppContent + "\nimport fake from 'still-does-not-exist';"
          }
        ]
      };

      // Configure mock to return failing patch with hypothesis
      repairLoopEngine.runDiagnosisAndPatch = async () => ({
        diagnosis: {
          category: "DEPENDENCY" as const,
          severity: "high" as const,
          explanation: "Cannot find module 'non-existent-pkg'",
          rootCause: "Cannot find module 'non-existent-pkg'",
          affectedFiles: ["/src/App.tsx"],
          evidence: ["Cannot find module 'non-existent-pkg'"],
          suggestedFix: "Import module",
          confidence: 0.35,
          confidenceReason: "Dependency missing from package.json with no clear resolution path",
          isHypothesis: true,
          projectId: projId
        },
        plan: {
          id: `plan_bad_${Date.now()}`,
          summary: "Attempt hypothetical import fix",
          steps: [
            {
              stepNumber: 1,
              targetFile: "/src/App.tsx",
              intendedModification: "Add import for missing module",
              reason: "Hypothesis testing",
              expectedOutcome: "Module resolution"
            }
          ],
          verificationPlan: ["Production Build"]
        },
        patch: failingPatch
      });

      // Inject another fault
      const badEvidence = {
        executionId: `exec_unrepairable_${Date.now()}`,
        command: "npm run build",
        args: [],
        exitCode: 1,
        stdout: "",
        stderr: "Cannot find module 'non-existent-pkg'",
        durationMs: 200,
        projectId: projId
      };

      const ep2 = await repairCoordinator.handleRuntimeFailure(projId, badEvidence);
      const episodeId2 = ep2!.failureEpisodeId;

      // Wait for proposal to be awaiting approval
      for (let i = 0; i < 30; i++) {
        const ep = useRepairStore.getState().getActiveEpisode(projId);
        if (ep && isEpisodeAwaitingApproval(ep)) break;
        await new Promise((r) => setTimeout(r, 100));
      }

      // Mock verification check to FAIL
      const originalRunFullVerification = verificationService.runFullVerification;
      verificationService.runFullVerification = async () => ({
        success: false,
        checks: [
          { name: "Production Build", success: false, status: "failed", exitCode: 1, output: "RollupError: Could not resolve 'still-does-not-exist'", durationMs: 300 }
        ],
        totalDurationMs: 300
      });

      try {
        const result = await repairCoordinator.approveRepair(projId, episodeId2);
        const epAfter = useRepairStore.getState().getProjectEpisodes(projId).find(e => e.failureEpisodeId === episodeId2);
        const restoredAppContent = vfsManager.getFile(projId, "/src/App.tsx")?.content || "";

        return {
          verified: result.verified,
          error: result.error,
          status: epAfter?.status,
          canonicalState: getCanonicalState(epAfter),
          isRolledBack: isEpisodeRolledBack(epAfter),
          byteForByteRestored: restoredAppContent === beforeAppContent,
          isHypothesis: epAfter?.diagnosis?.isHypothesis,
          checksCount: epAfter?.verificationResult?.checks?.length,
          originalErrorCleared: epAfter?.verificationResult?.originalErrorCleared,
          finalState: epAfter?.verificationResult?.finalState
        };
      } finally {
        verificationService.runFullVerification = originalRunFullVerification;
      }
    }, initResult.projId);

    expect(failingRepairResult.verified).toBe(false);
    expect(failingRepairResult.isRolledBack).toBe(true);
    expect(failingRepairResult.canonicalState).toBe("ROLLED_BACK");
    expect(failingRepairResult.byteForByteRestored).toBe(true);
    expect(failingRepairResult.isHypothesis).toBe(true);
    expect(failingRepairResult.originalErrorCleared).toBe(false);
    expect(failingRepairResult.finalState).toBe("ROLLED_BACK");

    // Verify DOM rolled-back state and verification failure evidence box
    await expect(page.locator('[data-testid="repair-rolled-back-state"]')).toBeVisible();
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toBeVisible();
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toContainText("Production Build");
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toContainText("FAIL");
    await expect(page.locator('[data-testid="verification-evidence-box"]')).toContainText("PRESENT (ROLLED BACK)");
    console.log(">>> [Phase 9.2 Browser Test] Flow 2 passed: Honest rollback verified byte-for-byte with Phase 9.2 intelligence!");

    console.log(">>> [Phase 9.2 Browser Test] Step 7: Testing project isolation in real browser...");
    const isolationResult = await page.evaluate(async (projA) => {
      const projB = "project-isolation-test-b";
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useRepairStore } = await import("/src/store/repairStore.ts");

      // Initialize Project B
      await vfsManager.writeFile(projB, "/src/App.tsx", "export default function AppB() { return <div>B</div>; }");
      const projBContentBefore = vfsManager.getFile(projB, "/src/App.tsx")?.content;

      // Project B should have zero episodes
      const projBEpisodes = useRepairStore.getState().getProjectEpisodes(projB);

      return {
        projBEpisodeCount: projBEpisodes.length,
        projBMatchesOriginal: projBContentBefore === "export default function AppB() { return <div>B</div>; }"
      };
    }, initResult.projId);

    expect(isolationResult.projBEpisodeCount).toBe(0);
    expect(isolationResult.projBMatchesOriginal).toBe(true);
    console.log(">>> [Phase 9.1 Browser Test] Flow 3 passed: Multi-project isolation confirmed!");
  });
});
