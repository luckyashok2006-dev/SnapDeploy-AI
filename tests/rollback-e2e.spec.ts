import { test, expect } from "@playwright/test";

test.describe("SnapDeploy AI — Rollback Specific E2E Validation", () => {
  test("verifies automatic rollback and byte-for-byte snapshot restoration on invalid patch", async ({
    page,
  }) => {
    test.setTimeout(300000);

    // Forward browser logs
    page.on("console", (msg) =>
      console.log(`[Browser Console: ${msg.type()}]`, msg.text(), JSON.stringify(msg.location())),
    );
    page.on("pageerror", (err) =>
      console.error("[Browser PageError Full]", err.message, "\nStack:", err.stack),
    );
    page.on("response", (res) => {
      if (res.status() >= 400) {
        console.error("[Browser HTTP Error]", res.status(), res.url());
      }
    });

    console.log(">>> [Rollback Test] Navigating to http://localhost:3000...");
    await page.goto("http://localhost:3000");
    await page.waitForLoadState("networkidle");
    await expect(page.locator("header")).toBeVisible({ timeout: 20000 });

    console.log(
      ">>> [Rollback Test] Initializing project, mounting WebContainer, and testing rollback...",
    );
    const rollbackResult = await page.evaluate(async () => {
      const { repairLoopEngine } =
        await import("/src/features/repair/repair-loop.ts");
      const { vfsManager } = await import("/src/lib/vfs/vfs-manager.ts");
      const { useProjectStore } = await import("/src/store/projectStore.ts");
      const { runtimeManager } =
        await import("/src/lib/runtime/runtime-manager.ts");
      const { useRuntimeStore } = await import("/src/store/runtimeStore.ts");
      const { INITIAL_DEMO_PROJECTS } =
        await import("/src/demo/demoProjects.ts");

      const projId =
        useProjectStore.getState().activeProjectId || "saas-dashboard";
      const demoProj =
        INITIAL_DEMO_PROJECTS[projId] ||
        Object.values(INITIAL_DEMO_PROJECTS)[0];

      // 1. Wait for VFS hydration and initialize project files through canonical store operation
      await vfsManager.waitUntilHydrated();
      const rawFiles: Record<string, string> = {};
      for (const [p, f] of Object.entries(demoProj.files)) {
        rawFiles[p] = f.content;
      }

      await useProjectStore.getState().writeFilesBulk(projId, rawFiles);

      // 2. Mount project into WebContainer runtime & install dependencies only when required
      if (!runtimeManager.isBooted()) {
        await runtimeManager.boot();
      }
      await runtimeManager.mountProject(projId);
      const isAlreadyInstalled = await runtimeManager.hasLocalTypeScript();
      let installExitCode = 0;
      if (!isAlreadyInstalled) {
        const installResult = await runtimeManager.installDependencies();
        installExitCode = installResult.exitCode ?? 1;
      }
      const hasLocalTsBefore = await runtimeManager.hasLocalTypeScript();

      // 2b. Baseline compilation check: must pass cleanly before any mutation
      const baselineTsCheck = await runtimeManager.runTypeScriptCheck();

      // 3. Capture pre-repair files from VFS
      const allFilesPre = vfsManager.getFiles(projId);
      const filePathsPre = Object.keys(allFilesPre);

      // Locate App.tsx in normalized VFS
      const appFileKey =
        filePathsPre.find((k) => k.includes("App.tsx")) || "/src/App.tsx";
      const preAppFile = allFilesPre[appFileKey];
      const preAppCode = preAppFile?.content || "";

      const preFileContents: Record<string, string> = {};
      for (const [p, f] of Object.entries(allFilesPre)) {
        preFileContents[p] = f.content;
      }

      // 4. Intentionally invalid patch with syntax fault that fails compiler/build
      const badPatch = {
        id: "bad_patch_test_" + Date.now(),
        summary: "Intentional bad syntax fault",
        files: [
          {
            path: appFileKey,
            before: preAppCode,
            after:
              preAppCode +
              "\nconst INVALID_SYNTAX_ERROR = undeclaredFunction_XYZ();",
          },
        ],
      };

      // 5. Apply patch and verify -> Expect verification failure and automated rollback
      const result = await repairLoopEngine.applyPatchAndVerify(
        projId,
        badPatch as any,
      );

      // 6. Retrieve post-rollback files from VFS
      const allFilesPost = vfsManager.getFiles(projId);
      const postAppFile = allFilesPost[appFileKey];
      const postAppCode = postAppFile?.content || "";

      const postFileContents: Record<string, string> = {};
      for (const [p, f] of Object.entries(allFilesPost)) {
        postFileContents[p] = f.content;
      }

      // 6b. Post-rollback compilation check: must pass cleanly after rollback
      const postRollbackTsCheck = await runtimeManager.runTypeScriptCheck();

      // 7. Verify WebContainer runtime content directly (Test 7)
      let webContainerAppCode = "";
      try {
        webContainerAppCode = await runtimeManager
          .getRuntime()
          .readFile(appFileKey);
      } catch (err: any) {
        webContainerAppCode = `ERR: ${err?.message}`;
      }

      // Complete file-set and byte-for-byte comparison across all project files
      const prePaths = Object.keys(preFileContents).sort();
      const postPaths = Object.keys(postFileContents).sort();
      const sameFileSet =
        JSON.stringify(prePaths) === JSON.stringify(postPaths) &&
        prePaths.length > 0;

      let allFilesByteForByteMatch = sameFileSet;
      if (sameFileSet) {
        for (const p of prePaths) {
          if (preFileContents[p] !== postFileContents[p]) {
            allFilesByteForByteMatch = false;
            break;
          }
        }
      }

      return {
        installExitCode,
        hasLocalTsBefore,
        baselineTsExitCode: baselineTsCheck.exitCode,
        baselineTsStderr: baselineTsCheck.stderr,
        preFileExists: Boolean(preAppFile),
        preCodeLength: preAppCode.length,
        verified: result.verified,
        verifyError: result.error,
        rolledBack: !result.verified,
        postFileExists: Boolean(postAppFile),
        postCodeLength: postAppCode.length,
        appCodeByteForByteMatch:
          preAppCode.length > 0 && preAppCode === postAppCode,
        postRollbackTsExitCode: postRollbackTsCheck.exitCode,
        fileCount: prePaths.length,
        sameFileSet,
        allFilesByteForByteMatch,
        webContainerMatchesVfs: webContainerAppCode === preAppCode,
      };
    });

    console.log(">>> [Rollback Test Result]", rollbackResult);

    // 0. Dependencies were installed and local TypeScript was available
    expect(rollbackResult.installExitCode).toBe(0);
    expect(rollbackResult.hasLocalTsBefore).toBe(true);
    // Baseline TypeScript compilation MUST pass (fails test if baseline is broken)
    expect(
      rollbackResult.baselineTsExitCode,
      `Baseline TS check failed: ${rollbackResult.baselineTsStderr}`,
    ).toBe(0);
    // 1. The pre-patch file exists
    expect(rollbackResult.preFileExists).toBe(true);
    // 2. preCode.length > 0
    expect(rollbackResult.preCodeLength).toBeGreaterThan(0);
    // 3. The intentionally bad patch causes verification failure
    expect(rollbackResult.verified).toBe(false);
    // Verification failure triggers automated rollback (validated by behavior, not incidental error string)
    expect(rollbackResult.verifyError).toBeTruthy();
    // 4. rolledBack === true
    expect(rollbackResult.rolledBack).toBe(true);
    // 5. The post-rollback file exists
    expect(rollbackResult.postFileExists).toBe(true);
    // 6. postCode is byte-for-byte identical to preCode
    expect(rollbackResult.appCodeByteForByteMatch).toBe(true);
    // 6b. Post-rollback compilation passes again
    expect(rollbackResult.postRollbackTsExitCode).toBe(0);
    // 7. The project contains the same file set and contents as the snapshot
    expect(rollbackResult.sameFileSet).toBe(true);
    expect(rollbackResult.allFilesByteForByteMatch).toBe(true);
    // 8. The WebContainer runtime contains the restored project after rollback
    expect(rollbackResult.webContainerMatchesVfs).toBe(true);

    console.log(
      ">>> [Rollback Test Verified] Byte-for-byte automatic rollback verified successfully!",
    );
  });
});
