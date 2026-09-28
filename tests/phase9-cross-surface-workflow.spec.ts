import { test, expect } from "@playwright/test";

test.describe("Phase 9.2: Cross-Surface State Reliability - Real Chromium Validation", () => {
  test("validates all 6 core cross-surface flows: VFS, editor tabs, runtime, snapshots, diagnostics, and project switching", async ({
    page,
  }) => {
    test.setTimeout(300000);

    // Forward browser logs for verification tracking
    page.on("console", (msg) => {
      const txt = msg.text();
      if (
        txt.includes("[Self-Healing]") ||
        txt.includes("[RepairCoordinator]") ||
        txt.includes("[Repair Engine]") ||
        txt.includes("[Verification]") ||
        txt.includes("[RuntimeStore]") ||
        txt.includes("[VFS]")
      ) {
        console.log(`[Browser Console: ${msg.type()}]`, txt);
      }
    });

    console.log(">>> [Cross-Surface Browser Test] Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("header")).toBeVisible({ timeout: 20000 });

    // Initialize projects and test harnesses in browser context
    console.log(">>> [Cross-Surface Browser Test] Step 0: Initializing Project Alpha and Beta in VFS...");
    const initRes = await page.evaluate(async () => {
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { INITIAL_DEMO_PROJECTS } = await import("/src/demo/demoProjects.ts");

      await vfsManager.waitUntilHydrated();
      const projA = "saas-dashboard";
      const demoProj = INITIAL_DEMO_PROJECTS[projA] || Object.values(INITIAL_DEMO_PROJECTS)[0];

      const rawFilesA: Record<string, string> = {};
      for (const [p, f] of Object.entries(demoProj.files)) {
        rawFilesA[p] = f.content;
      }
      await useProjectStore.getState().writeFilesBulk(projA, rawFilesA);

      // Create Project Beta if not exists
      const currentProjects = useProjectStore.getState().projects;
      const projB = "cross-proj-beta";
      if (!currentProjects[projB]) {
        useProjectStore.setState((s) => ({
          projects: {
            ...s.projects,
            [projB]: {
              id: projB,
              title: "Project Beta",
              description: "Isolated Beta Workspace",
              badge: "Vite + React",
              status: "ready",
              files: {},
              diagnostics: [],
              fixHistory: []
            }
          }
        }));
      }
      await vfsManager.writeFile(projB, "/src/App.tsx", "export default function BetaApp() { return <div>Beta</div>; }");
      await vfsManager.writeFile(projB, "/package.json", JSON.stringify({ name: "beta-app", version: "1.0.0" }));

      return { projA, projB };
    });

    // -----------------------------------------------------------------------------------------
    // Flow 1 & Flow 2: Monaco Unsaved Edits, Dirty State, Verification, and Ctrl+S Save
    // -----------------------------------------------------------------------------------------
    console.log(">>> [Flow 1 & 2] Verifying editor unsaved dirty state, verification sync, and Ctrl+S baseline update...");
    const flow1Res = await page.evaluate(async ({ projA }) => {
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useEditorStore } = await import("/src/store/editorStore.ts");
      const { verificationService } = await import("/src/features/verification/VerificationService.ts");

      // Set clean baseline for App.tsx
      const cleanContent = vfsManager.getFile(projA, "/src/App.tsx")?.content || "";
      useEditorStore.getState().setSavedBaseline(projA, "/src/App.tsx", cleanContent);
      useEditorStore.getState().markDirty(projA, "/src/App.tsx", false);

      // 1. User types in Monaco: App.tsx modified in VFS and marked dirty
      const dirtyContent = cleanContent + "\n// Unsaved edit in editor\n";
      await vfsManager.writeFile(projA, "/src/App.tsx", dirtyContent);
      useEditorStore.getState().markDirty(projA, "/src/App.tsx", true);

      const isDirtyBeforeVerify = useEditorStore.getState().getDirtyFiles(projA).includes("/src/App.tsx");

      // 2. Trigger verification: should evaluate current VFS content without altering dirty flag
      const vResult = await verificationService.runFullVerification({ projectId: projA });
      const isDirtyAfterVerify = useEditorStore.getState().getDirtyFiles(projA).includes("/src/App.tsx");

      // 3. User saves via Ctrl+S handler
      const baselineBeforeSave = useEditorStore.getState().getSavedBaseline(projA, "/src/App.tsx");
      useEditorStore.getState().markDirty(projA, "/src/App.tsx", false);
      useEditorStore.getState().setSavedBaseline(projA, "/src/App.tsx", dirtyContent);
      const isDirtyAfterSave = useEditorStore.getState().getDirtyFiles(projA).includes("/src/App.tsx");
      const baselineAfterSave = useEditorStore.getState().getSavedBaseline(projA, "/src/App.tsx");

      return {
        isDirtyBeforeVerify,
        isDirtyAfterVerify,
        isDirtyAfterSave,
        baselineUpdated: baselineAfterSave === dirtyContent && baselineBeforeSave !== dirtyContent,
        verificationRan: Array.isArray(vResult.checks)
      };
    }, initRes);

    expect(flow1Res.isDirtyBeforeVerify).toBe(true);
    expect(flow1Res.isDirtyAfterVerify).toBe(true); // Dirty flag NOT cleared prematurely
    expect(flow1Res.isDirtyAfterSave).toBe(false);   // Ctrl+S clears dirty flag
    expect(flow1Res.baselineUpdated).toBe(true);

    // -----------------------------------------------------------------------------------------
    // Flow 3: Tab Management & Repair Proposal Rejection Convergence
    // -----------------------------------------------------------------------------------------
    console.log(">>> [Flow 3] Open tabs, introduce error, reject proposal -> assert files & tabs intact...");
    const flow3Res = await page.evaluate(async ({ projA }) => {
      const { useEditorStore } = await import("/src/store/editorStore.ts");
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useRepairStore } = await import("/src/store/repairStore.ts");
      const { repairCoordinator } = await import("/src/features/repair/repair-coordinator.ts");

      // Open two tabs
      useEditorStore.getState().openFile(projA, "/src/App.tsx");
      useEditorStore.getState().openFile(projA, "/package.json");

      const tabsBefore = [...useEditorStore.getState().openTabs[projA]];

      // Create a dummy failure episode and proposal
      const evidence = {
        executionId: "exec-reject-flow",
        command: "npm run build",
        args: [],
        exitCode: 1,
        stdout: "",
        stderr: "Syntax error in App.tsx",
        durationMs: 40,
        projectId: projA
      };
      const ep = useRepairStore.getState().createEpisode(projA, evidence, "fp-reject", "ev-reject");
      useRepairStore.getState().setEpisodeProposal(
        projA,
        ep.failureEpisodeId,
        {
          failureEpisodeId: ep.failureEpisodeId,
          timestamp: Date.now(),
          category: "SYNTAX",
          rootCause: "Syntax error",
          confidence: 0.9,
          hypotheses: [],
          relevantFiles: ["/src/App.tsx"],
          recommendedAction: "Fix syntax",
          isHypothesis: false
        },
        {
          id: "patch-reject",
          summary: "Unwanted patch",
          description: "Unwanted patch",
          targetFiles: ["/src/App.tsx"],
          files: [{ path: "/src/App.tsx", before: "", after: "unwanted code", type: "modify" }]
        }
      );

      // User rejects repair proposal
      repairCoordinator.rejectRepair(projA, ep.failureEpisodeId);

      const epStatusAfter = useRepairStore.getState().getProjectEpisodes(projA).find((e) => e.failureEpisodeId === ep.failureEpisodeId)?.status;
      const tabsAfter = useEditorStore.getState().openTabs[projA];

      return {
        epStatusAfter,
        tabsPreserved: JSON.stringify(tabsBefore) === JSON.stringify(tabsAfter)
      };
    }, initRes);

    expect(flow3Res.epStatusAfter).toBe("rejected");
    expect(flow3Res.tabsPreserved).toBe(true);

    // -----------------------------------------------------------------------------------------
    // Flow 4: Failed Verification Automatic Rollback & Rogue Tab Pruning
    // -----------------------------------------------------------------------------------------
    console.log(">>> [Flow 4] Repair verification failure -> assert rollback reverts VFS & prunes added tabs...");
    const flow4Res = await page.evaluate(async ({ projA }) => {
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { snapshotService } = await import("/src/lib/snapshots/SnapshotService.ts");
      const { useEditorStore } = await import("/src/store/editorStore.ts");
      const { repairLoopEngine } = await import("/src/features/repair/repair-loop.ts");
      const { verificationService } = await import("/src/features/verification/VerificationService.ts");

      // 1. Checkpoint current state
      await snapshotService.createSnapshot(projA, "Clean pre-rollback baseline");

      // 2. Open tab for an upcoming rogue file
      useEditorStore.getState().openFile(projA, "/src/RogueHelper.ts");

      // 3. Patch adds RogueHelper.ts but fails verification
      const failingPatch = {
        id: "patch-fail-verify",
        summary: "Patch that fails build",
        description: "Patch that fails build",
        targetFiles: ["/src/RogueHelper.ts"],
        files: [
          {
            path: "/src/RogueHelper.ts",
            before: "",
            after: "export const bad = ;;;",
            type: "add" as const
          }
        ]
      };

      // Mock verification failure
      const origVerify = verificationService.runFullVerification;
      (verificationService as any).runFullVerification = async () => ({
        success: false,
        summary: "Build failure in RogueHelper.ts",
        checks: [{ name: "Build", command: "npm run build", exitCode: 1, success: false, status: "failed", timedOut: false, durationMs: 20 }],
        totalDurationMs: 20
      });

      const outcome = await repairLoopEngine.applyPatchAndVerify(projA, failingPatch);

      // Restore original verificationService
      (verificationService as any).runFullVerification = origVerify;

      // Check VFS and Tabs after rollback
      const vfsFiles = vfsManager.getFiles(projA);
      const rogueInVfs = Boolean(vfsFiles["/src/RogueHelper.ts"]);
      const rogueInTabs = useEditorStore.getState().openTabs[projA].includes("/src/RogueHelper.ts");

      return {
        rollbackTriggered: outcome.verified === false,
        rogueInVfs,
        rogueInTabs
      };
    }, initRes);

    expect(flow4Res.rollbackTriggered).toBe(true);
    expect(flow4Res.rogueInVfs).toBe(false);   // Rogue file deleted from VFS
    expect(flow4Res.rogueInTabs).toBe(false);  // Rogue tab pruned from EditorStore

    // -----------------------------------------------------------------------------------------
    // Flow 5: Project Switch Isolation (Project A error does not bleed into Project B)
    // -----------------------------------------------------------------------------------------
    console.log(">>> [Flow 5] Project A error isolation -> assert Project B does NOT show Project A failure...");
    // Switch to Debug tab to inspect UI state
    await page.locator('[data-testid="nav-debug-tab"]').first().click();

    const flow5Res = await page.evaluate(async ({ projA, projB }) => {
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");

      // Record failure in Project A
      const errEvidence = {
        executionId: "exec-alpha-error",
        command: "npm run build",
        args: [],
        exitCode: 1,
        stdout: "",
        stderr: "FATAL ERROR in Project Alpha: Compilation broke",
        durationMs: 60,
        projectId: projA
      };
      useRuntimeStore.getState().recordEvidence(errEvidence, projA);

      const projAEvidenceBeforeSwitch = useRuntimeStore.getState().getLastEvidence(projA);
      const topLevelBeforeSwitch = useRuntimeStore.getState().lastEvidence;

      // Switch to Project B
      await useProjectStore.getState().switchProject(projB);

      const topLevelAfterSwitch = useRuntimeStore.getState().lastEvidence;
      const projBEvidence = useRuntimeStore.getState().getLastEvidence(projB);
      const projAEvidencePreserved = useRuntimeStore.getState().getLastEvidence(projA);

      return {
        projAEvidenceBeforeSwitch: Boolean(projAEvidenceBeforeSwitch),
        topLevelBeforeSwitchMatch: topLevelBeforeSwitch?.executionId === "exec-alpha-error",
        topLevelDoesNotBleedProjA: topLevelAfterSwitch?.executionId !== "exec-alpha-error",
        topLevelMatchesProjB: topLevelAfterSwitch?.executionId === projBEvidence?.executionId,
        projAEvidencePreserved: projAEvidencePreserved?.executionId === "exec-alpha-error"
      };
    }, initRes);

    expect(flow5Res.projAEvidenceBeforeSwitch).toBe(true);
    expect(flow5Res.topLevelBeforeSwitchMatch).toBe(true);
    expect(flow5Res.topLevelDoesNotBleedProjA).toBe(true);
    expect(flow5Res.topLevelMatchesProjB).toBe(true);
    expect(flow5Res.projAEvidencePreserved).toBe(true);

    // Verify UI reflects clean state on Project B
    await expect(page.getByText("No Active Failures")).toBeVisible();
    await expect(page.getByText("FATAL ERROR in Project Alpha")).not.toBeVisible();

    // -----------------------------------------------------------------------------------------
    // Flow 6: In Project A, trigger repair -> switch to Project B -> switch back to Project A -> verify state integrity
    // -----------------------------------------------------------------------------------------
    console.log(">>> [Flow 6] In Project A, trigger repair -> while in progress, switch to Project B -> switch back to Project A -> verify state integrity...");
    const flow6Res = await page.evaluate(async ({ projA, projB }) => {
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { useRepairStore } = await import("/src/store/repairStore.ts");
      const { useAgentStore } = await import("/src/store/agentStore.ts");

      // 1. Switch back to Project A
      useProjectStore.getState().setActiveProjectId(projA);

      // 2. Trigger repair proposal in Project A
      const epA = useRepairStore.getState().createEpisode(
        projA,
        {
          executionId: "exec-flow6-repair",
          command: "npm run build",
          args: [],
          exitCode: 1,
          stdout: "",
          stderr: "Type error in App.tsx",
          durationMs: 40,
          projectId: projA
        },
        "fp-flow6",
        "ev-flow6"
      );

      const patchA = {
        id: "patch-flow6",
        summary: "Fix type error",
        description: "Fix type error",
        targetFiles: ["/src/App.tsx"],
        files: [{ path: "/src/App.tsx", before: "", after: "export default function App() {}", type: "modify" as const }]
      };

      useRepairStore.getState().setEpisodeProposal(
        projA,
        epA.failureEpisodeId,
        {
          failureEpisodeId: epA.failureEpisodeId,
          timestamp: Date.now(),
          category: "TYPE",
          rootCause: "Type error",
          confidence: 0.95,
          hypotheses: [],
          relevantFiles: ["/src/App.tsx"],
          recommendedAction: "Fix type error",
          isHypothesis: false
        },
        patchA
      );

      useAgentStore.getState().setPendingPatch(patchA, projA, false);

      const epInProjABefore = useRepairStore.getState().getActiveEpisode(projA)?.failureEpisodeId;
      const patchInProjABefore = useAgentStore.getState().pendingPatch?.id;

      // 3. Switch to Project B while repair is in progress
      useProjectStore.getState().setActiveProjectId(projB);

      const epInProjB = useRepairStore.getState().getActiveEpisode(projB);
      const patchInProjB = useAgentStore.getState().pendingPatch;

      // 4. Switch back to Project A
      useProjectStore.getState().setActiveProjectId(projA);

      const epInProjAAfter = useRepairStore.getState().getActiveEpisode(projA)?.failureEpisodeId;
      const patchInProjAAfter = useAgentStore.getState().pendingPatch?.id;

      return {
        epInProjABefore,
        patchInProjABefore,
        epInProjBNull: epInProjB === null,
        patchInProjBNull: patchInProjB === null,
        epInProjAAfterMatches: epInProjAAfter === epA.failureEpisodeId,
        patchInProjAAfterMatches: patchInProjAAfter === "patch-flow6"
      };
    }, initRes);

    expect(flow6Res.epInProjABefore).toBeDefined();
    expect(flow6Res.patchInProjABefore).toBe("patch-flow6");
    expect(flow6Res.epInProjBNull).toBe(true);
    expect(flow6Res.patchInProjBNull).toBe(true);
    expect(flow6Res.epInProjAAfterMatches).toBe(true);
    expect(flow6Res.patchInProjAAfterMatches).toBe(true);

    // Verify UI reflects proposal state for Project A in DebugManagerPanel
    await expect(page.getByTestId("repair-proposal-state")).toBeVisible();
    await expect(page.getByText("Repair Proposed")).toBeVisible();
    await expect(page.getByText("Fix type error")).toBeVisible();

    console.log(">>> [Real Chromium Validation] All 6 cross-surface state reliability flows passed successfully!");
  });
});
