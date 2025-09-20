import * as vscode from 'vscode';
import { AicodecTreeDataProvider } from './tree/AicodecTreeDataProvider';
import { getAicodecPath } from './utils';
import { AicodecContentProvider } from './AicodecContentProvider';
import { registerCommands } from './commands';

export async function activate(context: vscode.ExtensionContext) {

	console.log('Congratulations, your extension "aicodec" is now active!');

    // Ensure a path is set on activation
    const aicodecPath = await getAicodecPath(context);
    if (!aicodecPath) {
        vscode.window.showWarningMessage('AIcodec path not set. Please select your .aicodec directory.');
        // The getAicodecPath function will have already prompted the user.
        return;
    }

    const aggregatesProvider = new AicodecTreeDataProvider(context, 'context.json');
    const changesProvider = new AicodecTreeDataProvider(context, 'changes.json');
    const revertsProvider = new AicodecTreeDataProvider(context, 'reverts.json');

    const refresh = () => {
        aggregatesProvider.refresh();
        changesProvider.refresh();
        revertsProvider.refresh();
    };

    vscode.window.createTreeView('aicodec.aggregatesView', { treeDataProvider: aggregatesProvider });
    vscode.window.createTreeView('aicodec.changesView', { treeDataProvider: changesProvider });
    vscode.window.createTreeView('aicodec.revertsView', { treeDataProvider: revertsProvider });
    
    const contentProvider = new AicodecContentProvider(context);
    context.subscriptions.push(vscode.workspace.registerTextDocumentContentProvider('aicodec-readonly', contentProvider));
    
    registerCommands(context, refresh);
    
    const watcher = vscode.workspace.createFileSystemWatcher(new vscode.RelativePattern(aicodecPath, '*.json'));
    watcher.onDidChange(() => {
        console.log('AIcodec config file changed, refreshing views.');
        refresh();
    });
    watcher.onDidCreate(() => {
        console.log('AIcodec config file created, refreshing views.');
        refresh();
    });
    watcher.onDidDelete(() => {
        console.log('AIcodec config file deleted, refreshing views.');
        refresh();
    });

    context.subscriptions.push(watcher);
}

export function deactivate() {}
