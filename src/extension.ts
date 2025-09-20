import * as vscode from 'vscode';
import * as path from 'path';
import { AicodecTreeDataProvider } from './tree/AicodecTreeDataProvider';
import { getAicodecPath } from './utils';
import { AicodecContentProvider } from './AicodecContentProvider';
import { registerCommands } from './commands';

function showSettingsWarning() {
    const openSettings = 'Open Settings';
    vscode.window.showWarningMessage(
        'The path to your .aicodec directory is not set. Please configure it in settings.',
        openSettings
    ).then(selection => {
        if (selection === openSettings) {
            vscode.commands.executeCommand('workbench.action.openSettings', 'aicodec.path');
        }
    });
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
    const revertsProvider = new AicodecTreeDataProvider('reverts.json');

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
