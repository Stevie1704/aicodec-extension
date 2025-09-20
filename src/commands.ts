import * as vscode from 'vscode';
import * as path from 'path';
import { AicodecTreeItem } from './tree/AicodecTreeItem';
import { getAicodecPath, readAicodecJson } from './utils';
import { AicodecContentProvider } from './AicodecContentProvider';

export async function registerCommands(context: vscode.ExtensionContext, refresh: () => void) {
    
    const openDiff = async (item: AicodecTreeItem) => {
        const aicodecPath = getAicodecPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!aicodecPath || !workspaceFolders || !item.fullPath || !item.jsonSourceFile) {
            vscode.window.showErrorMessage("Missing context to open diff. Ensure the AIcodec path is set correctly in settings.");
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const relativePath = path.relative(workspaceRoot, item.fullPath);

        const localUri = vscode.Uri.file(item.fullPath);
        const aicodecUri = AicodecContentProvider.encodeUri(aicodecPath, item.jsonSourceFile, relativePath);
        
        const title = `${path.basename(item.fullPath)} (Local ↔ AIcodec)`;
        vscode.commands.executeCommand('vscode.diff', localUri, aicodecUri, title);
    };

    const applyOrRevertSingle = async (item: AicodecTreeItem, jsonFile: string) => {
        const aicodecPath = getAicodecPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!aicodecPath || !workspaceFolders || !item.fullPath) { return; }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const relativePath = path.relative(workspaceRoot, item.fullPath);

        const files = await readAicodecJson(aicodecPath, jsonFile);
        const targetFile = files.find(f => f.filePath === relativePath);

        if (targetFile) {
            try {
                const fileUri = vscode.Uri.file(item.fullPath);
                const newContent = Buffer.from(targetFile.content, 'utf8');
                await vscode.workspace.fs.writeFile(fileUri, newContent);
                vscode.window.showInformationMessage(`Updated ${relativePath}`);
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to write file ${relativePath}: ${error}`);
            }
        } else {
            vscode.window.showErrorMessage(`Could not find ${relativePath} in ${jsonFile}`);
        }
    };
    
    const applyOrRevertAll = async (jsonFile: string) => {
        const aicodecPath = getAicodecPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!aicodecPath || !workspaceFolders) { return; }
        
        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const files = await readAicodecJson(aicodecPath, jsonFile);
        
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Processing ${files.length} files from ${jsonFile}...`,
            cancellable: true
        }, async (progress, token) => {
            for (let i = 0; i < files.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }
                const file = files[i];
                progress.report({ message: file.filePath, increment: 100 / files.length });

                const fullPath = path.join(workspaceRoot, file.filePath);
                const fileUri = vscode.Uri.file(fullPath);
                const newContent = Buffer.from(file.content, 'utf8');
                await vscode.workspace.fs.writeFile(fileUri, newContent);
            }
        });

        vscode.window.showInformationMessage(`Processed all ${files.length} files from ${jsonFile}.`);
        refresh();
    };

    context.subscriptions.push(vscode.commands.registerCommand('aicodec.refresh', refresh));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.openDiff', openDiff));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.applyChange', (item: AicodecTreeItem) => applyOrRevertSingle(item, 'changes.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.revertChange', (item: AicodecTreeItem) => applyOrRevertSingle(item, 'reverts.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.applyAllChanges', () => applyOrRevertAll('changes.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.revertAllChanges', () => applyOrRevertAll('reverts.json')));
}
