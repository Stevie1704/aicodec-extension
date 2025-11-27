import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AicodecTreeDataProvider } from './tree/AicodecTreeDataProvider';
import { getAicodecPath } from './utils';
import { AicodecContentProvider } from './AicodecContentProvider';
import { registerCommands } from './commands';
import { checkForUpdatesViaCli, getCliVersion, compareVersions } from './cliIntegration';

async function checkForCliUpdates() {
    // Check config setting
    const config = vscode.workspace.getConfiguration('aicodec');
    const autoCheckUpdates = config.get<boolean>('checkForUpdates', true);

    if (!autoCheckUpdates) {
        return; // User has disabled auto-check
    }

    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) {
        return; // No workspace folder open
    }

    const workspaceRoot = workspaceFolders[0].uri.fsPath;

    // Try to find CLI path
    const cliPath = config.get<string>('cliPath');
    if (!cliPath) {
        return; // CLI not configured
    }

    try {
        // Check CLI version first
        const version = await getCliVersion(cliPath, workspaceRoot);

        if (!version) {
            console.log('[AIcodec] Could not determine CLI version');
            return;
        }

        // Check if version supports update checking (>= 2.11.0)
        if (compareVersions(version, '2.11.0') < 0) {
            // Too old to even check for updates
            console.log('[AIcodec] CLI version too old for update checking:', version);
            const viewDocs = 'View Documentation';
            const dontAskAgain = "Don't Ask Again";

            const choice = await vscode.window.showWarningMessage(
                `Your aicodec CLI (v${version}) is outdated and doesn't support automatic updates. Please update manually.`,
                viewDocs,
                dontAskAgain
            );

            if (choice === viewDocs) {
                vscode.env.openExternal(vscode.Uri.parse('https://stevie1704.github.io/aicodec/getting-started/installation/#method-2-from-pre-built-binaries'));
            } else if (choice === dontAskAgain) {
                config.update('checkForUpdates', false, vscode.ConfigurationTarget.Global);
            }
            return;
        }

        const result = await checkForUpdatesViaCli(cliPath, workspaceRoot);

        if (result.success && result.stdout) {
            // Check if update is available by parsing the output
            const output = result.stdout.toLowerCase();
            if (output.includes('update available') || output.includes('new version')) {
                // Check if version supports automatic update (>= 2.11.3)
                if (compareVersions(version, '2.11.3') < 0) {
                    // Can check but can't auto-update
                    const viewDocs = 'View Documentation';
                    const later = 'Later';
                    const dontAskAgain = "Don't Ask Again";

                    const choice = await vscode.window.showWarningMessage(
                        `A new version of aicodec CLI is available! However, your current version (v${version}) doesn't support automatic updates. Please update manually.`,
                        viewDocs,
                        later,
                        dontAskAgain
                    );

                    if (choice === viewDocs) {
                        vscode.env.openExternal(vscode.Uri.parse('https://stevie1704.github.io/aicodec/getting-started/installation/#method-2-from-pre-built-binaries'));
                    } else if (choice === dontAskAgain) {
                        config.update('checkForUpdates', false, vscode.ConfigurationTarget.Global);
                    }
                } else {
                    // Can auto-update
                    const updateNow = 'Update Now';
                    const later = 'Later';
                    const dontAskAgain = "Don't Ask Again";

                    const choice = await vscode.window.showInformationMessage(
                        'A new version of aicodec CLI is available!',
                        updateNow,
                        later,
                        dontAskAgain
                    );

                    if (choice === updateNow) {
                        vscode.commands.executeCommand('aicodec.update');
                    } else if (choice === dontAskAgain) {
                        config.update('checkForUpdates', false, vscode.ConfigurationTarget.Global);
                    }
                }
            }
        }
    } catch (error) {
        // Silent fail - don't bother the user if update check fails
        console.log('[AIcodec] Update check failed:', error);
    }
}

async function showSettingsWarning() {
    const initializeAicodec = 'Initialize AIcodec';
    const browsePath = 'Browse for Existing Directory';
    const openSettings = 'Open Settings';
    const dismiss = 'Dismiss';

    const selection = await vscode.window.showWarningMessage(
        'AIcodec is not initialized. Would you like to create a new configuration?',
        initializeAicodec,
        browsePath,
        openSettings,
        dismiss
    );

    if (selection === initializeAicodec) {
        // Initialize AIcodec in the current workspace
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const aicodecPath = path.join(workspaceRoot, '.aicodec');

            // Set the workspace configuration to the new .aicodec path
            const config = vscode.workspace.getConfiguration('aicodec');
            await config.update('path', aicodecPath, vscode.ConfigurationTarget.Workspace);

            // Open the config editor - it will create the directory and config on save
            vscode.commands.executeCommand('aicodec.editConfig');

            vscode.window.showInformationMessage(
                `AIcodec will be initialized at: ${aicodecPath}. Please configure and save your settings.`
            );
        } else {
            vscode.window.showErrorMessage('No workspace folder is currently open. Please open a workspace first.');
        }
    } else if (selection === browsePath) {
        const folderUri = await vscode.window.showOpenDialog({
            canSelectFiles: false,
            canSelectFolders: true,
            canSelectMany: false,
            openLabel: 'Select Project Root Directory',
            title: 'Select the project root directory (parent of .aicodec folder)'
        });

        if (folderUri && folderUri[0]) {
            const projectRoot = folderUri[0].fsPath;
            const aicodecPath = path.join(projectRoot, '.aicodec');

            // Verify the .aicodec directory exists and contains config.json
            const configPath = path.join(aicodecPath, 'config.json');
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(configPath));

                // Save to workspace configuration
                const config = vscode.workspace.getConfiguration('aicodec');
                await config.update('path', aicodecPath, vscode.ConfigurationTarget.Workspace);

                vscode.window.showInformationMessage(`AIcodec path set to: ${aicodecPath}`);
            } catch {
                const retry = 'Try Again';
                const result = await vscode.window.showErrorMessage(
                    `The .aicodec directory was not found in the selected project. Please select a directory that contains a .aicodec folder with config.json.`,
                    retry,
                    dismiss
                );
                if (result === retry) {
                    showSettingsWarning();
                }
            }
        }
    } else if (selection === openSettings) {
        vscode.commands.executeCommand('workbench.action.openSettings', 'aicodec.path');
    }
}

function createWatcher(aicodecPath: string, refreshCallback: () => void): vscode.FileSystemWatcher {
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(aicodecPath, '*.json'));
    const onFileChange = () => {
        console.log('AIcodec config file changed, refreshing views.');
        refreshCallback();
    };
    watcher.onDidChange(onFileChange);
    watcher.onDidCreate(onFileChange);
    watcher.onDidDelete(onFileChange);
    return watcher;
}

export async function activate(context: vscode.ExtensionContext) {
    console.log('Congratulations, your extension "aicodec" is now active!');

    let fileWatcher: vscode.FileSystemWatcher | undefined;

    const aggregatesProvider = new AicodecTreeDataProvider('context.json');
    const changesProvider = new AicodecTreeDataProvider('changes.json');
    const revertsProvider = new AicodecTreeDataProvider('revert.json');

    const refresh = () => {
        aggregatesProvider.refresh();
        changesProvider.refresh();
        revertsProvider.refresh();
    };

    const setupFileWatcher = () => {
        if (fileWatcher) {
            fileWatcher.dispose();
            fileWatcher = undefined;
        }
        
        const aicodecPath = getAicodecPath();

        if (aicodecPath) {
            if (!path.isAbsolute(aicodecPath)) {
                vscode.window.showErrorMessage('AIcodec path must be an absolute path. Please correct it in the settings.');
                return;
            }
            fileWatcher = createWatcher(aicodecPath, refresh);
            context.subscriptions.push(fileWatcher);
        }
    };

    // Check if AIcodec is properly initialized
    const aicodecPath = getAicodecPath();
    if (!aicodecPath) {
        showSettingsWarning();
    } else {
        // Path is set, check if config.json exists
        const configPath = path.join(aicodecPath, 'config.json');
        if (!fs.existsSync(configPath)) {
            showSettingsWarning();
        }
    }

    setupFileWatcher();

    vscode.window.createTreeView('aicodec.aggregatesView', { treeDataProvider: aggregatesProvider });
    vscode.window.createTreeView('aicodec.changesView', { treeDataProvider: changesProvider });
    vscode.window.createTreeView('aicodec.revertsView', { treeDataProvider: revertsProvider });

    // Register tree data providers for disposal (to clean up file watchers)
    context.subscriptions.push(aggregatesProvider);
    context.subscriptions.push(changesProvider);
    context.subscriptions.push(revertsProvider);

    const contentProvider = new AicodecContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('aicodec-readonly', contentProvider));
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('aicodec-empty', contentProvider));
    
    registerCommands(context, refresh);

    // Check for CLI updates on startup (async, non-blocking)
    checkForCliUpdates().catch(err => {
        console.log('[AIcodec] Failed to check for updates:', err);
    });

    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('aicodec.path')) {
            const newAicodecPath = getAicodecPath();
            if (!newAicodecPath) {
                showSettingsWarning();
            } else {
                // Path is set, check if config.json exists
                const configPath = path.join(newAicodecPath, 'config.json');
                if (!fs.existsSync(configPath)) {
                    showSettingsWarning();
                }
            }
            setupFileWatcher();
            refresh();
        }
    }));
}

export function deactivate() {}
