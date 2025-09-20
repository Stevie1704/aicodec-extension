import * as vscode from 'vscode';
import * as path from 'path';
import { AicodecTreeItem } from './AicodecTreeItem';
import { getAicodecPath, readAicodecJson } from '../utils';

type TreeNode = {
    children: Map<string, TreeNode>;
    fullPath: string;
    isFile: boolean;
};

export class AicodecTreeDataProvider implements vscode.TreeDataProvider<AicodecTreeItem> {
    private _onDidChangeTreeData: vscode.EventEmitter<AicodecTreeItem | undefined | null | void> = new vscode.EventEmitter<AicodecTreeItem | undefined | null | void>();
    readonly onDidChangeTreeData: vscode.Event<AicodecTreeItem | undefined | null | void> = this._onDidChangeTreeData.event;

    private tree: Map<string, TreeNode> | undefined;

    constructor(private context: vscode.ExtensionContext, private jsonFileName: string) {}

    refresh(): void {
        this.tree = undefined;
        this._onDidChangeTreeData.fire();
    }

    getTreeItem(element: AicodecTreeItem): vscode.TreeItem {
        return element;
    }

    async getChildren(element?: AicodecTreeItem): Promise<AicodecTreeItem[]> {
        if (!this.tree) {
            await this.buildTree();
        }

        if (!this.tree) {
            return [];
        }

        let childrenMap: Map<string, TreeNode>;
        if (element && element.fullPath) {
            const node = this.findNode(element.fullPath, this.tree);
            childrenMap = node ? node.children : new Map();
        } else {
            childrenMap = this.tree;
        }

        const sortedKeys = Array.from(childrenMap.keys()).sort();
        
        return sortedKeys.map(key => {
            const node = childrenMap.get(key)!;
            const collapsibleState = node.isFile 
                ? vscode.TreeItemCollapsibleState.None 
                : vscode.TreeItemCollapsibleState.Expanded;
            return new AicodecTreeItem(key, collapsibleState, node.fullPath, node.isFile, this.jsonFileName);
        });
    }

    private async buildTree() {
        const aicodecPath = await getAicodecPath(this.context);
        if (!aicodecPath || !vscode.workspace.workspaceFolders) {
            this.tree = new Map();
            return;
        }
        
        const workspaceRoot = vscode.workspace.workspaceFolders[0].uri.fsPath;
        const fileList = await readAicodecJson(aicodecPath, this.jsonFileName);
        this.tree = new Map<string, TreeNode>();

        for (const file of fileList) {
            const parts = file.filePath.split(path.sep);
            let currentLevel = this.tree;
            let currentPath = workspaceRoot;

            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                currentPath = path.join(currentPath, part);
                const isFile = i === parts.length - 1;
                
                if (!currentLevel.has(part)) {
                    currentLevel.set(part, { 
                        children: new Map(),
                        fullPath: currentPath,
                        isFile: isFile
                    });
                }
                currentLevel = currentLevel.get(part)!.children;
            }
        }
    }

    private findNode(fullPath: string, root: Map<string, TreeNode>): TreeNode | undefined {
        for (const node of root.values()) {
            if (node.fullPath === fullPath) {
                return node;
            }
            if (fullPath.startsWith(node.fullPath) && !node.isFile) {
                const found = this.findNode(fullPath, node.children);
                if (found) {
                    return found;
                }
            }
        }
        return undefined;
    }
}
