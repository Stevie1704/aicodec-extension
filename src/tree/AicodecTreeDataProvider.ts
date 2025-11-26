import * as vscode from 'vscode';
import * as path from 'path';
import * as fs from 'fs';
import { AicodecTreeItem } from './AicodecTreeItem';
import { getAicodecPath, readAicodecJson, AicodecFile } from '../utils';

export class AicodecTreeDataProvider implements vscode.TreeDataProvider<AicodecTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AicodecTreeItem | undefined | null | void> = new vscode.EventEmitter<AicodecTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AicodecTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Store the flat list of file paths, not a pre-built tree
    private relativeFilePaths: string[] | undefined;
    // Store full file data for reverts (with session info) and changes (with content)
    private fileData: AicodecFile[] | undefined;
    // File system watcher for changes.json files to auto-update colors
    private fileWatcher: vscode.FileSystemWatcher | undefined;

    constructor(private jsonFileName: string) {
        // Set up file watcher for changes.json to auto-refresh when files are modified
        if (this.jsonFileName === 'changes.json') {
            this.setupFileWatcher();
        }
    }

    /**
     * Sets up a file system watcher to automatically refresh the tree
     * when files in changes.json are modified.
     */
    private setupFileWatcher(): void {
        // Watch all files in the workspace
        this.fileWatcher = vscode.workspace.createFileSystemWatcher('**/*');

        // Refresh when any file changes
        this.fileWatcher.onDidChange((uri) => {
            // Only refresh if this file is in our changes list
            if (this.relativeFilePaths) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    const workspaceRoot = workspaceFolders[0].uri.fsPath;
                    const relativePath = path.relative(workspaceRoot, uri.fsPath);

                    // Check if this file is in our changes list
                    if (this.relativeFilePaths.some(p => p === relativePath || p === relativePath.split(path.sep).join('/'))) {
                        console.log(`[AicodecTreeDataProvider] File changed: ${relativePath}, refreshing tree`);
                        this._onDidChangeTreeData.fire();
                    }
                }
            }
        });

        // Also refresh when files are created or deleted
        this.fileWatcher.onDidCreate((uri) => {
            if (this.relativeFilePaths) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    const workspaceRoot = workspaceFolders[0].uri.fsPath;
                    const relativePath = path.relative(workspaceRoot, uri.fsPath);

                    if (this.relativeFilePaths.some(p => p === relativePath || p === relativePath.split(path.sep).join('/'))) {
                        console.log(`[AicodecTreeDataProvider] File created: ${relativePath}, refreshing tree`);
                        this._onDidChangeTreeData.fire();
                    }
                }
            }
        });

        this.fileWatcher.onDidDelete((uri) => {
            if (this.relativeFilePaths) {
                const workspaceFolders = vscode.workspace.workspaceFolders;
                if (workspaceFolders) {
                    const workspaceRoot = workspaceFolders[0].uri.fsPath;
                    const relativePath = path.relative(workspaceRoot, uri.fsPath);

                    if (this.relativeFilePaths.some(p => p === relativePath || p === relativePath.split(path.sep).join('/'))) {
                        console.log(`[AicodecTreeDataProvider] File deleted: ${relativePath}, refreshing tree`);
                        this._onDidChangeTreeData.fire();
                    }
                }
            }
        });
    }

    /**
     * Disposes of the file system watcher.
     */
    dispose(): void {
        if (this.fileWatcher) {
            this.fileWatcher.dispose();
        }
    }

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

        // Store full file data for reverts (needed for session grouping) and changes (needed for comparison)
        if (this.jsonFileName === 'revert.json' || this.jsonFileName === 'changes.json') {
            this.fileData = fileList;
        }

        // Filter out invalid paths and store the list
        this.relativeFilePaths = fileList
            .map(f => f.filePath)
            .filter(p => p && p.trim() !== '');
    }

    /**
     * Checks if a change has been applied by comparing the proposed content
     * with the actual file content on disk.
     */
    private isChangeApplied(filePath: string): boolean {
        if (!this.fileData) {
            console.log(`[AicodecTreeDataProvider] No file data for ${filePath}`);
            return false;
        }

        const workspaceFolders = vscode.workspace.workspaceFolders;
        if (!workspaceFolders) {
            console.log(`[AicodecTreeDataProvider] No workspace folders`);
            return false;
        }

        const workspaceRoot = workspaceFolders[0].uri.fsPath;
        const absolutePath = path.join(workspaceRoot, filePath);

        // Find the proposed content from changes.json
        const changeData = this.fileData.find(f => f.filePath === filePath);
        if (!changeData) {
            console.log(`[AicodecTreeDataProvider] No change data found for ${filePath}`);
            return false;
        }

        const proposedContent = changeData.content;

        // Read the actual file content from disk
        try {
            if (!fs.existsSync(absolutePath)) {
                const result = proposedContent === '';
                console.log(`[AicodecTreeDataProvider] File doesn't exist: ${filePath}, isApplied=${result}`);
                return result;
            }

            const actualContent = fs.readFileSync(absolutePath, 'utf8');

            // Compare contents - normalize line endings for comparison
            const normalizedProposed = proposedContent.replace(/\r\n/g, '\n');
            const normalizedActual = actualContent.replace(/\r\n/g, '\n');

            const isMatch = normalizedProposed === normalizedActual;
            console.log(`[AicodecTreeDataProvider] Comparing ${filePath}: isApplied=${isMatch}`);

            return isMatch;
        } catch (error) {
            console.error(`[AicodecTreeDataProvider] Error checking if change is applied for ${filePath}:`, error);
            return false;
        }
    }

    // This is the core of the lazy-loading logic
    async getChildren(element?: AicodecTreeItem): Promise<AicodecTreeItem[]> {
        console.log(`[AicodecTreeDataProvider] getChildren called for ${this.jsonFileName}, element:`, element ? element.label : 'root');
        if (element) {
            console.log(`[AicodecTreeDataProvider] Element details: isFile=${element.isFile}, jsonSourceFile=${element.jsonSourceFile}, collapsibleState=${element.collapsibleState}`);
        }

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

        // Handle expanding a file with multiple sessions - MUST BE CHECKED BEFORE main revert processing
        if (this.jsonFileName === 'revert.json' && element &&
            element.jsonSourceFile === 'revert-multi-session') {
            console.log(`[AicodecTreeDataProvider] Expanding multi-session file: ${element.label}`);
            const sessions = (element as any)._sessions as string[];
            const filePath = (element as any)._multiSessionPath as string;

            console.log(`[AicodecTreeDataProvider] Sessions for ${element.label}:`, sessions);
            console.log(`[AicodecTreeDataProvider] Multi-session path: ${filePath}`);

            const sessionItems = sessions.sort((a, b) => b.localeCompare(a)).map(sessionName => {
                // Extract session number
                const match = sessionName.match(/revert-(\d+)\.json/);
                const sessionNum = match ? parseInt(match[1], 10) : 0;
                const label = `Session ${sessionNum}`;

                console.log(`[AicodecTreeDataProvider] Creating session item: ${label} for ${sessionName}`);

                return new AicodecTreeItem(
                    label,
                    vscode.TreeItemCollapsibleState.None,
                    element.fullPath,
                    true, // It's a file (session variant)
                    sessionName
                );
            });

            console.log(`[AicodecTreeDataProvider] Returning ${sessionItems.length} session items`);
            return sessionItems;
        }

        // Special handling for revert files - show unified tree with session subfolders for duplicates
        if (this.jsonFileName === 'revert.json') {
            if (!this.fileData || this.fileData.length === 0) {
                return [new AicodecTreeItem('No reverts found', vscode.TreeItemCollapsibleState.None)];
            }

            const workspaceRoot = workspaceFolders[0].uri.fsPath;

            console.log(`[AicodecTreeDataProvider] Processing ${this.fileData.length} revert files`);

            // Build a map of file paths to their sessions
            const fileToSessions = new Map<string, Set<string>>();
            for (const file of this.fileData) {
                // Normalize the file path to use consistent separators
                const normalizedPath = file.filePath.split(/[\\/]/).join('/');

                if (!fileToSessions.has(normalizedPath)) {
                    fileToSessions.set(normalizedPath, new Set());
                }
                if (file.revertSession) {
                    fileToSessions.get(normalizedPath)!.add(file.revertSession);
                    console.log(`[AicodecTreeDataProvider] Added session ${file.revertSession} for file ${normalizedPath}`);
                }
            }

            // Log session counts
            for (const [filePath, sessions] of fileToSessions.entries()) {
                if (sessions.size > 1) {
                    console.log(`[AicodecTreeDataProvider] File ${filePath} has ${sessions.size} sessions: ${Array.from(sessions).join(', ')}`);
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

            for (const [normalizedFilePath, sessions] of fileToSessions.entries()) {
                // If we're inside a session folder, only show files from that session
                if (isInsideSessionFolder && currentSessionName && !sessions.has(currentSessionName)) {
                    continue;
                }

                // Use path.sep for OS-specific separators
                const normalizedPath = normalizedFilePath.split(/[\\/]/).join(path.sep);
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
                            originalPath: normalizedFilePath  // Use the normalized path
                        });
                    } else {
                        // Merge sessions if multiple files map to same child
                        const existing = children.get(childName)!;
                        sessions.forEach(s => existing.sessions.add(s));
                    }
                }

                console.log(`[AicodecTreeDataProvider] Child ${childName || 'unnamed'}: isFile=${segments.length === 1}, sessions=${sessions.size}`);
            }

            const sortedKeys = Array.from(children.keys()).sort();

            return sortedKeys.map(key => {
                const child = children.get(key)!;
                const sessionCount = child.sessions.size;

                console.log(`[AicodecTreeDataProvider] Creating tree item for ${key}: isFile=${child.isFile}, sessionCount=${sessionCount}, isInsideSessionFolder=${isInsideSessionFolder}`);

                // If file appears in multiple sessions AND we're not already in a session folder
                if (child.isFile && sessionCount > 1 && !isInsideSessionFolder) {
                    console.log(`[AicodecTreeDataProvider] ${key} has multiple sessions, creating multi-session folder`);
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

            // For changes.json files, check if the change is applied
            let isApplied: boolean | undefined = undefined;
            if (this.jsonFileName === 'changes.json' && child.isFile && workspaceRoot) {
                // Reconstruct the full relative path from workspace root to this file
                const fullRelativePath = path.relative(workspaceRoot, child.fullPath);
                isApplied = this.isChangeApplied(fullRelativePath);
                console.log(`[AicodecTreeDataProvider] Creating tree item for ${key}: isApplied=${isApplied}`);
            }

            return new AicodecTreeItem(key, collapsibleState, child.fullPath, child.isFile, this.jsonFileName, isApplied);
        });
    }
}
