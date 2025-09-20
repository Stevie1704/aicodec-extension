import * as vscode from 'vscode';

export class AicodecTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly fullPath?: string,
        public readonly isFile: boolean = false,
        public readonly jsonSourceFile?: string
    ) {
        super(label, collapsibleState);

        this.tooltip = this.fullPath || this.label;

        // CRITICAL FIX: Both files and folders need a resourceUri to be rendered reliably.
        if (fullPath) {
            this.resourceUri = vscode.Uri.file(fullPath);
        }

        if (isFile) {
            this.contextValue = 'file';
            // Bonus Fix: Only add the 'Open Diff' command to items from changes.json and reverts.json
            if (jsonSourceFile && jsonSourceFile !== 'context.json') {
                this.command = {
                    command: 'aicodec.openDiff',
                    title: 'Open Diff',
                    arguments: [this]
                };
            }
        } else {
            this.contextValue = 'folder';
        }
    }

    iconPath = this.isFile ? vscode.ThemeIcon.File : vscode.ThemeIcon.Folder;
}
