import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AicodecTreeItem } from './tree/AicodecTreeItem';
import { getAicodecPath, readAicodecJson, ensureConfigExists, AicodecFile } from './utils';
import { AicodecContentProvider } from './AicodecContentProvider';
import { ConfigEditorPanel } from './ConfigEditorPanel';
import {
    ensureCliAvailable,
    applyChangesViaCli,
    revertChangesViaCli,
    aggregateViaCli,
    schemaViaCli,
    buildmapViaCli,
    promptViaCli,
    prepareViaCli
} from './cliIntegration';

/**
 * Cleans up the .temp directory by removing all temporary files
 */
async function cleanupTempDirectory(aicodecPath: string) {
    const tempDir = path.join(aicodecPath, '.temp');
    const fs = require('fs');

    try {
        if (fs.existsSync(tempDir)) {
            const files = fs.readdirSync(tempDir);
            for (const file of files) {
                const filePath = path.join(tempDir, file);
                try {
                    fs.unlinkSync(filePath);
                    console.log(`Cleaned up temporary file: ${filePath}`);
                } catch (error) {
                    console.error(`Failed to delete ${filePath}:`, error);
                }
            }
            // Try to remove the directory if it's empty
            try {
                fs.rmdirSync(tempDir);
                console.log(`Removed empty .temp directory: ${tempDir}`);
            } catch (error) {
                // Directory might not be empty or other error, ignore
            }
        }
    } catch (error) {
        console.error(`Failed to cleanup temp directory:`, error);
    }
}

export async function registerCommands(context: vscode.ExtensionContext, refresh: () => void) {

    // Clean up temp directory on startup
    const aicodecPath = getAicodecPath();
    if (aicodecPath) {
        cleanupTempDirectory(aicodecPath);
    }

    const openFile = async (item: AicodecTreeItem) => {
        if (!item.fullPath) {
            return;
        }

        try {
            const document = await vscode.workspace.openTextDocument(item.fullPath);
            await vscode.window.showTextDocument(document);
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to open file: ${error}`);
        }
    };

    const deleteFromContext = async (item: AicodecTreeItem) => {
        const aicodecPath = getAicodecPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;

        if (!aicodecPath || !workspaceFolders || !item.fullPath) {
            vscode.window.showErrorMessage('Cannot delete: missing context');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const relativePath = path.relative(workspaceRoot, item.fullPath);

        const itemType = item.isFile ? 'file' : 'folder';
        const confirmMessage = item.isFile
            ? `Remove "${relativePath}" from context?`
            : `Remove folder "${relativePath}" and all its contents from context?`;

        const confirmed = await vscode.window.showWarningMessage(
            confirmMessage,
            { modal: true },
            'Remove'
        );

        if (confirmed !== 'Remove') {
            return;
        }

        try {
            const contextPath = path.join(aicodecPath, 'context.json');
            const fs = require('fs');
            const contextContent = fs.readFileSync(contextPath, 'utf8');
            const contextData = JSON.parse(contextContent);

            if (!Array.isArray(contextData)) {
                vscode.window.showErrorMessage('Invalid context.json format');
                return;
            }

            // Filter out the item(s) to delete
            const filteredData = contextData.filter((fileEntry: any) => {
                const entryPath = fileEntry.filePath || fileEntry.file_path || '';

                if (item.isFile) {
                    // For files, exact match
                    return entryPath !== relativePath;
                } else {
                    // For folders, remove all files within that folder
                    const normalizedEntry = entryPath.replace(/\\/g, '/');
                    const normalizedFolder = relativePath.replace(/\\/g, '/');
                    return !normalizedEntry.startsWith(normalizedFolder + '/') && normalizedEntry !== normalizedFolder;
                }
            });

            const removedCount = contextData.length - filteredData.length;

            if (removedCount === 0) {
                vscode.window.showInformationMessage(`No items found to remove for ${relativePath}`);
                return;
            }

            // Write back to context.json
            fs.writeFileSync(contextPath, JSON.stringify(filteredData, null, 2), 'utf8');

            // Also update hashes.json
            const hashesPath = path.join(aicodecPath, 'hashes.json');
            try {
                if (fs.existsSync(hashesPath)) {
                    const hashesContent = fs.readFileSync(hashesPath, 'utf8');
                    const hashesData = JSON.parse(hashesContent);

                    // Remove hash entries for deleted files
                    if (item.isFile) {
                        // For files, remove exact match
                        delete hashesData[relativePath];
                    } else {
                        // For folders, remove all files within that folder
                        const normalizedFolder = relativePath.replace(/\\/g, '/');
                        Object.keys(hashesData).forEach(hashPath => {
                            const normalizedHashPath = hashPath.replace(/\\/g, '/');
                            if (normalizedHashPath.startsWith(normalizedFolder + '/') || normalizedHashPath === normalizedFolder) {
                                delete hashesData[hashPath];
                            }
                        });
                    }

                    // Write back to hashes.json
                    fs.writeFileSync(hashesPath, JSON.stringify(hashesData, null, 2), 'utf8');
                }
            } catch (error) {
                console.error('Failed to update hashes.json:', error);
                // Don't fail the operation if hashes update fails
            }

            vscode.window.showInformationMessage(
                `Removed ${removedCount} ${removedCount === 1 ? 'item' : 'items'} from context`
            );

            // Refresh the view
            refresh();
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to update context.json: ${error}`);
        }
    };

    const setAicodecPath = async () => {
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
                console.log(`Checking for config at: ${configPath}`);
                await vscode.workspace.fs.stat(vscode.Uri.file(configPath));

                // Save to workspace configuration
                const config = vscode.workspace.getConfiguration('aicodec');
                await config.update('path', aicodecPath, vscode.ConfigurationTarget.Workspace);

                vscode.window.showInformationMessage(`AIcodec path set to: ${aicodecPath}`);
                refresh();
            } catch (error) {
                console.error('Error checking .aicodec directory:', error);
                vscode.window.showErrorMessage(
                    `The .aicodec directory was not found in the selected project. Please select a directory that contains a .aicodec folder with config.json. Path checked: ${configPath}`
                );
            }
        }
    };
    
    const openDiff = async (item: AicodecTreeItem) => {
        const aicodecPath = getAicodecPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!aicodecPath || !workspaceFolders || !item.fullPath || !item.jsonSourceFile) {
            vscode.window.showErrorMessage("Missing context to open diff. Ensure the AIcodec path is set correctly in settings.");
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const relativePath = path.relative(workspaceRoot, item.fullPath);

        // For changes.json, create an editable temp file for the right side
        if (item.jsonSourceFile === 'changes.json') {
            const files = await readAicodecJson(aicodecPath, item.jsonSourceFile);
            const targetFile = files.find(f => f.filePath === relativePath);

            if (!targetFile) {
                vscode.window.showErrorMessage(`File ${relativePath} not found in ${item.jsonSourceFile}`);
                return;
            }

            // Create a temporary editable file
            const tempDir = path.join(aicodecPath, '.temp');
            const fs = require('fs');
            if (!fs.existsSync(tempDir)) {
                fs.mkdirSync(tempDir, { recursive: true });
            }

            const tempFileName = `${path.basename(item.fullPath)}.aicodec-proposed`;
            const tempFilePath = path.join(tempDir, tempFileName);

            // Write the proposed content to the temp file
            fs.writeFileSync(tempFilePath, targetFile.content, 'utf8');

            // Check if the local file exists
            let fileExists = false;
            let localUri: vscode.Uri;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(item.fullPath));
                fileExists = true;
                localUri = vscode.Uri.file(item.fullPath);
            } catch (error) {
                // File doesn't exist, use virtual empty URI for diff
                localUri = AicodecContentProvider.encodeEmptyUri(item.fullPath);
            }

            const tempUri = vscode.Uri.file(tempFilePath);

            // Store metadata for tracking changes
            const metadata = {
                aicodecPath,
                jsonSourceFile: item.jsonSourceFile,
                relativePath,
                tempFilePath,
                isNewFile: !fileExists
            };

            // Store in context globalState for persistence
            context.workspaceState.update(`aicodec.edit.${tempFilePath}`, metadata);

            const title = fileExists
                ? `${path.basename(item.fullPath)} (Local ↔ Proposed Changes)`
                : `${path.basename(item.fullPath)} (New File)`;
            await vscode.commands.executeCommand('vscode.diff', localUri, tempUri, title);

            // Watch for changes to the temp file and update changes.json
            const watcher = vscode.workspace.createFileSystemWatcher(tempFilePath);

            const updateChangesJson = async () => {
                try {
                    const changedContent = fs.readFileSync(tempFilePath, 'utf8');
                    const changesPath = path.join(aicodecPath, item.jsonSourceFile!);
                    const changesContent = fs.readFileSync(changesPath, 'utf8');
                    const changesData = JSON.parse(changesContent);

                    // Handle both array and object with changes array
                    let changesList = Array.isArray(changesData) ? changesData : changesData.changes;

                    if (!changesList) {
                        vscode.window.showErrorMessage('Invalid changes.json format');
                        return;
                    }

                    // Update the content for this file
                    const fileIndex = changesList.findIndex((f: any) => f.filePath === relativePath);
                    if (fileIndex !== -1) {
                        changesList[fileIndex].content = changedContent;

                        // Write back to changes.json
                        if (Array.isArray(changesData)) {
                            fs.writeFileSync(changesPath, JSON.stringify(changesData, null, 2), 'utf8');
                        } else {
                            changesData.changes = changesList;
                            fs.writeFileSync(changesPath, JSON.stringify(changesData, null, 2), 'utf8');
                        }

                        vscode.window.showInformationMessage(`Updated ${relativePath} in changes.json`);
                    }
                } catch (error) {
                    vscode.window.showErrorMessage(`Failed to update changes.json: ${error}`);
                }
            };

            watcher.onDidChange(updateChangesJson);

            // Clean up watcher and temp file when file is closed
            const closeDisposable = vscode.workspace.onDidCloseTextDocument(doc => {
                if (doc.uri.fsPath === tempFilePath) {
                    watcher.dispose();
                    closeDisposable.dispose();
                    context.workspaceState.update(`aicodec.edit.${tempFilePath}`, undefined);

                    // Delete the temporary file
                    try {
                        if (fs.existsSync(tempFilePath)) {
                            fs.unlinkSync(tempFilePath);
                            console.log(`Deleted temporary file: ${tempFilePath}`);
                        }
                    } catch (error) {
                        console.error(`Failed to delete temporary file ${tempFilePath}:`, error);
                    }
                }
            });

            context.subscriptions.push(watcher, closeDisposable);
        } else {
            // For revert.json, keep readonly behavior
            // Check if the local file exists
            let fileExists = false;
            let localUri: vscode.Uri;
            try {
                await vscode.workspace.fs.stat(vscode.Uri.file(item.fullPath));
                fileExists = true;
                localUri = vscode.Uri.file(item.fullPath);
            } catch (error) {
                // File doesn't exist, use virtual empty URI for diff
                localUri = AicodecContentProvider.encodeEmptyUri(item.fullPath);
            }

            const aicodecUri = AicodecContentProvider.encodeUri(aicodecPath, item.jsonSourceFile, relativePath);

            const title = fileExists
                ? `${path.basename(item.fullPath)} (Local ↔ AIcodec)`
                : `${path.basename(item.fullPath)} (New File)`;
            vscode.commands.executeCommand('vscode.diff', localUri, aicodecUri, title);
        }
    };

    const applyOrRevertSingle = async (item: AicodecTreeItem, jsonFile: string) => {
        const aicodecPath = getAicodecPath();
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!aicodecPath || !workspaceFolders || !item.fullPath) { return; }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const relativePath = path.relative(workspaceRoot, item.fullPath);

        // Check if we should use CLI
        const config = vscode.workspace.getConfiguration('aicodec');
        const useCli = config.get<boolean>('useCli', true);

        if (useCli) {
            const { available, cliPath, useFallback } = await ensureCliAvailable();

            if (available && cliPath) {
                // Use CLI for single file
                const isApply = jsonFile === 'changes.json';
                const result = isApply
                    ? await applyChangesViaCli(cliPath, workspaceRoot, [relativePath])
                    : await revertChangesViaCli(cliPath, workspaceRoot, [relativePath]);

                if (result.success) {
                    vscode.window.showInformationMessage(`Successfully ${isApply ? 'applied' : 'reverted'} ${relativePath}`);
                    refresh();
                } else {
                    vscode.window.showErrorMessage(`Failed to ${isApply ? 'apply' : 'revert'} ${relativePath}: ${result.stderr}`);
                }
                return;
            }

            if (!useFallback) {
                return; // User cancelled or needs to install CLI
            }
            // Continue with fallback below
        }

        // Fallback: TypeScript implementation
        let files: AicodecFile[];

        // For revert files with sessions, read from specific revert file
        if (jsonFile === 'revert.json' && item.jsonSourceFile && item.jsonSourceFile.startsWith('revert-')) {
            const revertFilePath = path.join(aicodecPath, 'reverts', item.jsonSourceFile);
            try {
                const content = fs.readFileSync(revertFilePath, 'utf8');
                const data = JSON.parse(content);
                files = (data.changes || []).map((c: any) => ({
                    filePath: c.filePath,
                    content: c.content || ''
                }));
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to read revert file ${item.jsonSourceFile}: ${error}`);
                return;
            }
        } else {
            // Regular changes.json or old revert.json format
            files = await readAicodecJson(aicodecPath, jsonFile);
        }

        const targetFile = files.find(f => f.filePath === relativePath);

        if (targetFile) {
            try {
                const fileUri = vscode.Uri.file(item.fullPath);

                // Ensure parent directories exist
                const parentDir = path.dirname(item.fullPath);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }

                const newContent = Buffer.from(targetFile.content, 'utf8');
                await vscode.workspace.fs.writeFile(fileUri, newContent);
                vscode.window.showInformationMessage(`Updated ${relativePath} (using built-in implementation)`);
                refresh();
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

        // Check if we should use CLI
        const config = vscode.workspace.getConfiguration('aicodec');
        const useCli = config.get<boolean>('useCli', true);

        if (useCli) {
            const { available, cliPath, useFallback } = await ensureCliAvailable();

            if (available && cliPath) {
                // Use CLI for all files
                const isApply = jsonFile === 'changes.json';

                await vscode.window.withProgress({
                    location: vscode.ProgressLocation.Notification,
                    title: `${isApply ? 'Applying' : 'Reverting'} all changes via CLI...`,
                    cancellable: false
                }, async () => {
                    const result = isApply
                        ? await applyChangesViaCli(cliPath, workspaceRoot)
                        : await revertChangesViaCli(cliPath, workspaceRoot);

                    if (result.success) {
                        vscode.window.showInformationMessage(
                            `Successfully ${isApply ? 'applied' : 'reverted'} all changes\n${result.stdout}`
                        );
                        refresh();
                    } else {
                        vscode.window.showErrorMessage(
                            `Failed to ${isApply ? 'apply' : 'revert'} changes:\n${result.stderr}`
                        );
                    }
                });
                return;
            }

            if (!useFallback) {
                return; // User cancelled or needs to install CLI
            }
            // Continue with fallback below
        }

        // Fallback: TypeScript implementation
        const files = await readAicodecJson(aicodecPath, jsonFile);
        const fs = require('fs');

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Processing ${files.length} files from ${jsonFile} (built-in implementation)...`,
            cancellable: true
        }, async (progress, token) => {
            for (let i = 0; i < files.length; i++) {
                if (token.isCancellationRequested) {
                    break;
                }
                const file = files[i];
                progress.report({ message: file.filePath, increment: 100 / files.length });

                const fullPath = path.join(workspaceRoot, file.filePath);

                // Ensure parent directories exist
                const parentDir = path.dirname(fullPath);
                if (!fs.existsSync(parentDir)) {
                    fs.mkdirSync(parentDir, { recursive: true });
                }

                const fileUri = vscode.Uri.file(fullPath);
                const newContent = Buffer.from(file.content, 'utf8');
                await vscode.workspace.fs.writeFile(fileUri, newContent);
            }
        });

        vscode.window.showInformationMessage(`Processed all ${files.length} files from ${jsonFile} (using built-in implementation).`);
        refresh();
    };

    const runAggregate = async (forceRehash: boolean = false) => {
        // Ensure config.json exists
        if (!await ensureConfigExists()) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Check if we should use CLI
        const config = vscode.workspace.getConfiguration('aicodec');
        const useCli = config.get<boolean>('useCli', true);

        if (!useCli) {
            vscode.window.showWarningMessage('Aggregate command requires the aicodec CLI. Please enable "Use Cli" in settings or install the CLI.');
            return;
        }

        const { available, cliPath, useFallback } = await ensureCliAvailable();

        if (!available || !cliPath) {
            if (!useFallback) {
                return; // User cancelled or needs to install CLI
            }
            vscode.window.showWarningMessage('Aggregate command requires the aicodec CLI. Please install it.');
            return;
        }

        // Run aggregate via CLI
        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: `Running aggregate${forceRehash ? ' (force rehash)' : ''}...`,
            cancellable: false
        }, async () => {
            const result = await aggregateViaCli(cliPath, workspaceRoot, forceRehash);

            if (result.success) {
                vscode.window.showInformationMessage(
                    `Aggregate completed successfully!\n${result.stdout}`
                );
                refresh();
            } else {
                vscode.window.showErrorMessage(
                    `Aggregate failed:\n${result.stderr}`
                );
            }
        });
    };

    const openConfigEditor = () => {
        ConfigEditorPanel.createOrShow(context.extensionUri);
    };

    const cleanupTemp = async () => {
        const aicodecPath = getAicodecPath();
        if (!aicodecPath) {
            vscode.window.showErrorMessage('AIcodec path is not set.');
            return;
        }

        await cleanupTempDirectory(aicodecPath);
        vscode.window.showInformationMessage('Temporary files cleaned up successfully.');
    };

    const showSchema = async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        const { available, cliPath, useFallback } = await ensureCliAvailable();

        if (!available || !cliPath) {
            if (!useFallback) {
                return;
            }
            vscode.window.showWarningMessage('Schema command requires the aicodec CLI. Please install it.');
            return;
        }

        const result = await schemaViaCli(cliPath, workspaceRoot);

        if (result.success) {
            // Create a new untitled document with JSON content
            const doc = await vscode.workspace.openTextDocument({
                content: result.stdout,
                language: 'json'
            });
            await vscode.window.showTextDocument(doc);
        } else {
            vscode.window.showErrorMessage(`Failed to get schema:\n${result.stderr}`);
        }
    };

    const runBuildmap = async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        const { available, cliPath, useFallback } = await ensureCliAvailable();

        if (!available || !cliPath) {
            if (!useFallback) {
                return;
            }
            vscode.window.showWarningMessage('Buildmap command requires the aicodec CLI. Please install it.');
            return;
        }

        // Ask user if they want to use .gitignore
        const useGitignore = await vscode.window.showQuickPick(
            ['Yes', 'No'],
            {
                placeHolder: 'Respect .gitignore when building the map?',
                canPickMany: false
            }
        );

        if (!useGitignore) {
            return; // User cancelled
        }

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Building repository map...',
            cancellable: false
        }, async () => {
            const result = await buildmapViaCli(cliPath, workspaceRoot, useGitignore === 'Yes');

            if (result.success) {
                vscode.window.showInformationMessage(
                    `Repository map built successfully!\n${result.stdout}`
                );

                // Open the generated repo_map.md file
                const aicodecPath = getAicodecPath();
                if (aicodecPath) {
                    const mapPath = path.join(aicodecPath, 'repo_map.md');
                    try {
                        const doc = await vscode.workspace.openTextDocument(mapPath);
                        await vscode.window.showTextDocument(doc);
                    } catch (error) {
                        console.error('Failed to open repo_map.md:', error);
                    }
                }
                refresh();
            } else {
                vscode.window.showErrorMessage(
                    `Failed to build repository map:\n${result.stderr}`
                );
            }
        });
    };

    const runPrompt = async () => {
        // Ensure config.json exists
        if (!await ensureConfigExists()) {
            return;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        const { available, cliPath, useFallback } = await ensureCliAvailable();

        if (!available || !cliPath) {
            if (!useFallback) {
                return;
            }
            vscode.window.showWarningMessage('Prompt command requires the aicodec CLI. Please install it.');
            return;
        }

        // Ask user for task description (specific to this prompt generation)
        const task = await vscode.window.showInputBox({
            prompt: 'Enter the task description for the LLM',
            placeHolder: 'e.g., Add a new user authentication feature',
            validateInput: (value) => {
                if (!value || value.trim().length === 0) {
                    return 'Task description is required';
                }
                return null;
            }
        });

        if (task === undefined) {
            return; // User cancelled
        }

        // Ask if they want minimal template
        const templateChoice = await vscode.window.showQuickPick(
            ['Full Template', 'Minimal Template'],
            {
                placeHolder: 'Select the prompt template to use',
                canPickMany: false
            }
        );

        if (!templateChoice) {
            return; // User cancelled
        }

        const minimal = templateChoice === 'Minimal Template';

        // Ask if they want to copy to clipboard or save to file
        const outputChoice = await vscode.window.showQuickPick(
            ['Save to File', 'Copy to Clipboard'],
            {
                placeHolder: 'How would you like to output the prompt?',
                canPickMany: false
            }
        );

        if (!outputChoice) {
            return; // User cancelled
        }

        const clipboard = outputChoice === 'Copy to Clipboard';

        await vscode.window.withProgress({
            location: vscode.ProgressLocation.Notification,
            title: 'Generating prompt...',
            cancellable: false
        }, async () => {
            const result = await promptViaCli(cliPath, workspaceRoot, {
                task: task.trim(), // Pass task from user input
                // Don't pass techStack - let CLI use config.json value
                minimal,
                clipboard,
                skipEditor: true  // Skip external editor, open in VSCode instead
            });

            if (result.success) {
                if (clipboard) {
                    // In devcontainers, the CLI's clipboard may not work, but it falls back to writing a file
                    // So we read the file and use VSCode's clipboard API which works in devcontainers
                    const aicodecPath = getAicodecPath();
                    if (aicodecPath) {
                        const promptPath = path.join(aicodecPath, 'prompt.txt');
                        try {
                            // Check if the file was created (fallback behavior)
                            if (fs.existsSync(promptPath)) {
                                const content = fs.readFileSync(promptPath, 'utf8');
                                await vscode.env.clipboard.writeText(content);
                                vscode.window.showInformationMessage('Prompt copied to clipboard!');
                            } else {
                                // CLI successfully used native clipboard
                                vscode.window.showInformationMessage('Prompt copied to clipboard!');
                            }
                        } catch (error) {
                            console.error('Failed to read prompt file for clipboard:', error);
                            vscode.window.showInformationMessage('Prompt copied to clipboard!');
                        }
                    } else {
                        vscode.window.showInformationMessage('Prompt copied to clipboard!');
                    }
                } else {
                    vscode.window.showInformationMessage(
                        `Prompt generated successfully!\n${result.stdout}`
                    );

                    // Try to open the generated prompt file
                    const aicodecPath = getAicodecPath();
                    if (aicodecPath) {
                        const promptPath = path.join(aicodecPath, 'prompt.txt');
                        try {
                            const doc = await vscode.workspace.openTextDocument(promptPath);
                            await vscode.window.showTextDocument(doc);
                        } catch (error) {
                            console.error('Failed to open prompt.txt:', error);
                        }
                    }
                }
                refresh();
            } else {
                vscode.window.showErrorMessage(
                    `Failed to generate prompt:\n${result.stderr}`
                );
            }
        });
    };

    const runPrepare = async () => {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            vscode.window.showErrorMessage('No workspace folder is open.');
            return;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const aicodecPath = getAicodecPath();

        if (!aicodecPath) {
            vscode.window.showErrorMessage('AIcodec path is not set.');
            return;
        }

        const changesPath = path.join(aicodecPath, 'changes.json');
        const fs = require('fs');

        // Check if changes.json already exists and has content
        if (fs.existsSync(changesPath)) {
            const stat = fs.statSync(changesPath);
            if (stat.size > 0) {
                const overwrite = await vscode.window.showWarningMessage(
                    `The file "${changesPath}" already has content. Overwrite?`,
                    { modal: true },
                    'Overwrite',
                    'Cancel'
                );

                if (overwrite !== 'Overwrite') {
                    return;
                }
            }
        }

        // Ask user how they want to provide the changes
        const inputChoice = await vscode.window.showQuickPick(
            ['Paste from Clipboard', 'Open Editor'],
            {
                placeHolder: 'How would you like to provide the LLM changes?',
                canPickMany: false
            }
        );

        if (!inputChoice) {
            return; // User cancelled
        }

        if (inputChoice === 'Paste from Clipboard') {
            // Get clipboard content directly in VSCode
            const clipboardContent = await vscode.env.clipboard.readText();

            if (!clipboardContent || clipboardContent.trim().length === 0) {
                vscode.window.showWarningMessage('Clipboard is empty. Please copy the LLM changes first.');
                return;
            }

            // Parse and validate the JSON
            try {
                // Try to parse the JSON
                let jsonContent;
                try {
                    jsonContent = JSON.parse(clipboardContent);
                } catch (parseError) {
                    // If parsing fails, try to extract JSON from markdown code blocks
                    const jsonMatch = clipboardContent.match(/```(?:json)?\s*\n?([\s\S]*?)\n?```/);
                    if (jsonMatch) {
                        jsonContent = JSON.parse(jsonMatch[1]);
                    } else {
                        throw parseError;
                    }
                }

                // Ensure parent directory exists
                if (!fs.existsSync(aicodecPath)) {
                    fs.mkdirSync(aicodecPath, { recursive: true });
                }

                // Write formatted JSON to file
                fs.writeFileSync(changesPath, JSON.stringify(jsonContent, null, 2), 'utf8');

                vscode.window.showInformationMessage('Changes prepared successfully from clipboard!');

                // Open the changes.json file
                try {
                    const doc = await vscode.workspace.openTextDocument(changesPath);
                    await vscode.window.showTextDocument(doc);
                } catch (error) {
                    console.error('Failed to open changes.json:', error);
                }
                refresh();
            } catch (error) {
                vscode.window.showErrorMessage(
                    `Failed to parse clipboard content as JSON: ${error}\n\nPlease ensure you copied valid JSON from the LLM.`
                );
            }
        } else {
            // Open Editor - just create an empty file and let the user edit it
            // Ensure parent directory exists
            if (!fs.existsSync(aicodecPath)) {
                fs.mkdirSync(aicodecPath, { recursive: true });
            }

            // Create empty changes.json file
            fs.writeFileSync(changesPath, '', 'utf8');

            try {
                const doc = await vscode.workspace.openTextDocument(changesPath);
                await vscode.window.showTextDocument(doc);
                vscode.window.showInformationMessage(
                    'Paste your LLM changes into changes.json and save the file. The extension will automatically validate and format it when you apply changes.'
                );
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to open changes.json: ${error}`);
            }
        }
    };

    const startNewSession = async () => {
        const aicodecPath = getAicodecPath();
        if (!aicodecPath) {
            vscode.window.showErrorMessage('AIcodec path is not set. Please configure it first.');
            return;
        }

        const revertsDir = path.join(aicodecPath, 'reverts');

        if (!fs.existsSync(revertsDir)) {
            vscode.window.showInformationMessage('No active session. Reverts folder is already clean.');
            return;
        }

        const revertFiles = fs.readdirSync(revertsDir).filter((f: string) => f.startsWith('revert-') && f.endsWith('.json'));

        if (revertFiles.length === 0) {
            vscode.window.showInformationMessage('No active session. Reverts folder is already clean.');
            return;
        }

        const confirm = await vscode.window.showWarningMessage(
            `This will clear ${revertFiles.length} revert file(s) and you won't be able to undo previous changes. Continue?`,
            { modal: true },
            'Yes, Start New Session',
            'Cancel'
        );

        if (confirm === 'Yes, Start New Session') {
            try {
                // Delete all revert files
                for (const file of revertFiles) {
                    fs.unlinkSync(path.join(revertsDir, file));
                }
                // Remove the directory if empty
                if (fs.readdirSync(revertsDir).length === 0) {
                    fs.rmdirSync(revertsDir);
                }
                vscode.window.showInformationMessage('New session started. Reverts cleared.');
                refresh();
            } catch (error) {
                vscode.window.showErrorMessage(`Failed to clear reverts: ${error}`);
            }
        }
    };

    context.subscriptions.push(vscode.commands.registerCommand('aicodec.setPath', setAicodecPath));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.editConfig', openConfigEditor));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.refresh', refresh));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.cleanupTemp', cleanupTemp));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.schema', showSchema));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.aggregate', () => runAggregate(false)));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.aggregateForce', () => runAggregate(true)));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.buildmap', runBuildmap));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.prompt', runPrompt));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.prepare', runPrepare));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.openFile', openFile));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.openDiff', openDiff));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.deleteFromContext', deleteFromContext));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.applyChange', (item: AicodecTreeItem) => applyOrRevertSingle(item, 'changes.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.revertChange', (item: AicodecTreeItem) => applyOrRevertSingle(item, 'revert.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.applyAllChanges', () => applyOrRevertAll('changes.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.revertAllChanges', () => applyOrRevertAll('revert.json')));
    context.subscriptions.push(vscode.commands.registerCommand('aicodec.startNewSession', startNewSession));
}
