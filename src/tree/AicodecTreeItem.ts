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
        if (isFile && fullPath && jsonSourceFile) {
            this.resourceUri = vscode.Uri.file(fullPath);
            this.command = {
                command: 'aicodec.openDiff',
                title: 'Open Diff',
                arguments: [this]
            };
            this.contextValue = 'file';
        } else {
            this.contextValue = 'folder';
        }
    }

    iconPath = this.isFile ? vscode.ThemeIcon.File : vscode.ThemeIcon.Folder;
}
