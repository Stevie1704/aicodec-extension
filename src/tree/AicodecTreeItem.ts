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

        if (fullPath) {
            this.resourceUri = vscode.Uri.file(fullPath);
        }

        if (isFile) {
            this.contextValue = 'file';
            this.iconPath = vscode.ThemeIcon.File;
            // Set command based on source file
            if (jsonSourceFile === 'context.json') {
                // For aggregate files, open the file on double-click
                this.command = {
                    command: 'aicodec.openFile',
                    title: 'Open File',
                    arguments: [this]
                };
            } else if (jsonSourceFile && jsonSourceFile !== 'context.json') {
                // For changes/reverts, open diff view
                this.command = {
                    command: 'aicodec.openDiff',
                    title: 'Open Diff',
                    arguments: [this]
                };
            }
        } else {
            this.contextValue = 'folder';
            this.iconPath = vscode.ThemeIcon.Folder;
        }

        if (!this.fullPath) {
            this.iconPath = new vscode.ThemeIcon('info');
            this.contextValue = 'placeholder';
        }
    }
}
