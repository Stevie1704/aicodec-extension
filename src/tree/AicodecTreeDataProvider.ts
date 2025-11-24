import * as vscode from 'vscode';
import * as path from 'path';
import { AicodecTreeItem } from './AicodecTreeItem';
import { getAicodecPath, readAicodecJson, AicodecFile } from '../utils';

export class AicodecTreeDataProvider implements vscode.TreeDataProvider<AicodecTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AicodecTreeItem | undefined | null | void> = new vscode.EventEmitter<AicodecTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AicodecTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Store the flat list of file paths, not a pre-built tree
    private relativeFilePaths: string[] | undefined;
    // Store full file data for reverts (with session info)
    private fileData: AicodecFile[] | undefined;

    constructor(private jsonFileName: string) {}

    refresh(): void {
        // Clear the cache to force a re-read on the next expansion
        this.relativeFilePaths = undefined;
        this.fileData = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AicodecTreeItem): vscode.TreeItem {
        return element;
    }

    // This method ensures the JSON file is read from disk only once.
    private async ensureFilePathsLoaded(): Promise<void> {
        if (this.relativeFilePaths !== undefined) {
            return;
        }
        const aicodecPath = getAicodecPath();
        if (!aicodecPath) {
            this.relativeFilePaths = [];
            this.fileData = [];
            return;
        }
        const fileList = await readAicodecJson(aicodecPath, this.jsonFileName);

        // Store full file data for reverts (needed for session grouping)
        if (this.jsonFileName === 'revert.json') {
            this.fileData = fileList;
        }

        // Filter out invalid paths and store the list
        this.relativeFilePaths = fileList
            .map(f => f.filePath)
            .filter(p => p && p.trim() !== '');
    }

    // This is the core of the lazy-loading logic
    async getChildren(element?: AicodecTreeItem): Promise<AicodecTreeItem[]> {
        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!getAicodecPath() || !workspaceFolders) {
            return [];
        }

        await this.ensureFilePathsLoaded();

        if (element === undefined && this.relativeFilePaths!.length === 0) {
            let message = '';
            if (this.jsonFileName === 'context.json') {
                message = 'No aggregates found';
            } else if (this.jsonFileName === 'changes.json') {
                message = 'No changes found';
            } else if (this.jsonFileName === 'revert.json') {
                message = 'No reverts found';
            } else {
                message = 'No items found';
            }
            return [new AicodecTreeItem(message, vscode.TreeItemCollapsibleState.None)];
        }

        // Special handling for revert files - show unified tree with session subfolders for duplicates
        if (this.jsonFileName === 'revert.json') {
            if (!this.fileData || this.fileData.length === 0) {
                return [new AicodecTreeItem('No reverts found', vscode.TreeItemCollapsibleState.None)];
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            // Build a map of file paths to their sessions
            const fileToSessions = new Map<string, Set<string>>();
            for (const file of this.fileData) {
                if (!fileToSessions.has(file.filePath)) {
                    fileToSessions.set(file.filePath, new Set());
                }
                if (file.revertSession) {
                    fileToSessions.get(file.filePath)!.add(file.revertSession);
                }
            }

            // Determine current path context
            let parentRelativePath = '';
            let isInsideSessionFolder = false;
            let currentSessionName: string | undefined;

            if (element) {
                // Check if we're expanding a "Session X" child (for files with multiple sessions)
                if (element.label.startsWith('Session ') && element.jsonSourceFile?.startsWith('revert-')) {
                    // We're inside a session subfolder (child of a multi-session file)
                    isInsideSessionFolder = true;
                    currentSessionName = element.jsonSourceFile;
                    if (element.fullPath) {
                        parentRelativePath = path.relative(workspaceRoot, element.fullPath);
                    }
                } else if (element.fullPath) {
                    // Regular folder expansion - show all files from all sessions
                    parentRelativePath = path.relative(workspaceRoot, element.fullPath);
                    // Don't filter by session for regular folders
                }
            }

            // Get children for this level
            const children = new Map<string, {
                fullPath: string;
                isFile: boolean;
                sessions: Set<string>;
                originalPath: string;
            }>();

            for (const [filePath, sessions] of fileToSessions.entries()) {
                // If we're inside a session folder, only show files from that session
                if (isInsideSessionFolder && currentSessionName && !sessions.has(currentSessionName)) {
                    continue;
                }

                const normalizedPath = filePath.split(/[\\/]/).join(path.sep);
                const normalizedParent = parentRelativePath.split(/[\\/]/).join(path.sep);

                if (normalizedParent && !normalizedPath.startsWith(normalizedParent + path.sep)) {
                    continue;
                }

                const pathAfterParent = normalizedParent
                    ? normalizedPath.substring(normalizedParent.length + 1)
                    : normalizedPath;

                const segments = pathAfterParent.split(path.sep);
                const childName = segments[0];

                if (childName) {
                    const isFile = segments.length === 1;
                    const fullPath = path.join(workspaceRoot, parentRelativePath, childName);

                    if (!children.has(childName)) {
                        children.set(childName, {
                            fullPath,
                            isFile,
                            sessions: new Set(sessions),
                            originalPath: filePath
                        });
                    } else {
                        // Merge sessions if multiple files map to same child
                        const existing = children.get(childName)!;
                        sessions.forEach(s => existing.sessions.add(s));
                    }
                }
            }

            const sortedKeys = Array.from(children.keys()).sort();

            return sortedKeys.map(key => {
                const child = children.get(key)!;
                const sessionCount = child.sessions.size;

                // If file appears in multiple sessions AND we're not already in a session folder
                if (child.isFile && sessionCount > 1 && !isInsideSessionFolder) {
                    // Make it a folder with session children
                    const item = new AicodecTreeItem(
                        key,
                        vscode.TreeItemCollapsibleState.Collapsed,
                        child.fullPath,
                        false, // Not a file, it's a folder containing sessions
                        'revert-multi-session' // Special marker
                    );
                    // Store sessions info for when we expand
                    (item as any)._multiSessionPath = child.originalPath;
                    (item as any)._sessions = Array.from(child.sessions);
                    return item;
                } else {
                    // Normal file or folder
                    const collapsibleState = child.isFile
                        ? vscode.TreeItemCollapsibleState.None
                        : vscode.TreeItemCollapsibleState.Collapsed;

                    const sessionName = isInsideSessionFolder ? currentSessionName : Array.from(child.sessions)[0];
                    return new AicodecTreeItem(key, collapsibleState, child.fullPath, child.isFile, sessionName);
                }
            });
        }

        // Handle expanding a file with multiple sessions - show session options
        if (this.jsonFileName === 'revert.json' && element &&
            element.jsonSourceFile === 'revert-multi-session') {
            const sessions = (element as any)._sessions as string[];
            const filePath = (element as any)._multiSessionPath as string;

            return sessions.sort((a, b) => b.localeCompare(a)).map(sessionName => {
                // Extract session number
                const match = sessionName.match(/revert-(\d+)\.json/);
                const sessionNum = match ? parseInt(match[1], 10) : 0;
                const label = `Session ${sessionNum}`;

                return new AicodecTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    element.fullPath,
                    true, // It's a file (session variant)
                    sessionName
                );
            });
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;

        // Determine the path of the parent node we are expanding.
        // If `element` is undefined, we are at the root.
        const parentRelativePath = element
            ? path.relative(workspaceRoot, element.fullPath!)
            : '';

        const children = new Map<string, { fullPath: string; isFile: boolean }>();

        // Iterate through the entire flat list to find direct children
        for (const fullRelativePath of this.relativeFilePaths!) {
            // Normalize path separators to match the current OS
            const normalizedPath = fullRelativePath.split(/[\\/]/).join(path.sep);
            const normalizedParent = parentRelativePath.split(/[\\/]/).join(path.sep);

            if (normalizedParent && !normalizedPath.startsWith(normalizedParent + path.sep)) {
                continue;
            }

            const pathAfterParent = normalizedParent
                ? normalizedPath.substring(normalizedParent.length + 1)
                : normalizedPath;

            const segments = pathAfterParent.split(path.sep);
            const childName = segments[0];

            if (childName && !children.has(childName)) {
                const isFile = segments.length === 1;
                const fullPath = path.join(workspaceRoot, parentRelativePath, childName);
                children.set(childName, { fullPath, isFile });
            }
        }

        const sortedKeys = Array.from(children.keys()).sort();

        return sortedKeys.map(key => {
            const child = children.get(key)!;
            const collapsibleState = child.isFile
                ? vscode.TreeItemCollapsibleState.None
                : vscode.TreeItemCollapsibleState.Collapsed; // Use Collapsed for lazy loading
            return new AicodecTreeItem(key, collapsibleState, child.fullPath, child.isFile, this.jsonFileName);
        });
    }
}
