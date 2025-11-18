import * as vscode from 'vscode';
import * as path from 'path';
import { AicodecTreeItem } from './AicodecTreeItem';
import { getAicodecPath, readAicodecJson, AicodecFile } from '../utils';

export class AicodecTreeDataProvider implements vscode.TreeDataProvider<AicodecTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AicodecTreeItem | undefined | null | void> = new vscode.EventEmitter<AicodecTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AicodecTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    // Store the flat list of file paths, not a pre-built tree
    private relativeFilePaths: string[] | undefined;

    constructor(private jsonFileName: string) {}

    refresh(): void {
        // Clear the cache to force a re-read on the next expansion
        this.relativeFilePaths = undefined;
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
            return;
        }
        const fileList = await readAicodecJson(aicodecPath, this.jsonFileName);
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
