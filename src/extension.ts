import * as vscode from 'vscode';
import * as path from 'path';
import { AicodecTreeDataProvider } from './tree/AicodecTreeDataProvider';
import { getAicodecPath } from './utils';
import { AicodecContentProvider } from './AicodecContentProvider';
import { registerCommands } from './commands';

async function showSettingsWarning() {
    const useWorkspace = 'Use Current Workspace';
    const browsePath = 'Browse for Project Directory';
    const openSettings = 'Open Settings';
    const dismiss = 'Dismiss';

    const selection = await vscode.window.showWarningMessage(
        'The path to your .aicodec directory is not set. Would you like to browse for it now?',
        useWorkspace,
        browsePath,
        openSettings,
        dismiss
    );

    if (selection === useWorkspace) {
        // Try to use the current workspace folder
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (workspaceFolders && workspaceFolders.length > 0) {
            const workspaceRoot = workspaceFolders[0].uri.fsPath;
            const aicodecPath = path.join(workspaceRoot, '.aicodec');
            const configPath = path.join(aicodecPath, 'config.json');

            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(configPath));

                const config = vscode.workspace.getConfiguration('aicodec');
                await config.update('path', aicodecPath, vscode.ConfigurationTarget.Workspace);

                vscode.window.showInformationMessage(`AIcodec path set to: ${aicodecPath}`);
            } catch {
                vscode.window.showErrorMessage(
                    `No .aicodec directory found in the current workspace at: ${workspaceRoot}`
                );
            }
        } else {
            vscode.window.showErrorMessage('No workspace folder is currently open.');
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

    if (!getAicodecPath()) {
        showSettingsWarning();
    }
    
    setupFileWatcher();

    vscode.window.createTreeView('aicodec.aggregatesView', { treeDataProvider: aggregatesProvider });
    vscode.window.createTreeView('aicodec.changesView', { treeDataProvider: changesProvider });
    vscode.window.createTreeView('aicodec.revertsView', { treeDataProvider: revertsProvider });

    const contentProvider = new AicodecContentProvider();
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('aicodec-readonly', contentProvider));
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('aicodec-empty', contentProvider));
    
    registerCommands(context, refresh);
    
    context.subscriptions.push(vscode.workspace.onDidChangeConfiguration(e => {
        if (e.affectsConfiguration('aicodec.path')) {
            if (!getAicodecPath()) {
                showSettingsWarning();
            }
            setupFileWatcher();
            refresh();
        }
    }));
}

export function deactivate() {}
