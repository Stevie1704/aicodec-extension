import * as vscode from 'vscode';

export class AicodecTreeItem extends vscode.TreeItem {
    constructor(
        public readonly label: string,
        public readonly collapsibleState: vscode.TreeItemCollapsibleState,
        public readonly fullPath?: string,
        public readonly isFile: boolean = false,
        public readonly jsonSourceFile?: string,
        public readonly isApplied?: boolean  // True if change is applied (green), false if pending (red)
    ) {
        super(label, collapsibleState);

        this.tooltip = this.fullPath || this.label;

        if (fullPath) {
            this.resourceUri = vscode.Uri.file(fullPath);
        }

        if (isFile) {
            this.contextValue = 'file';

            // Set icon and tooltip based on applied status for changes.json files
            if (jsonSourceFile === 'changes.json' && isApplied !== undefined) {
                if (isApplied) {
                    // Green checkmark for applied changes
                    this.iconPath = new vscode.ThemeIcon('pass', new vscode.ThemeColor('charts.green'));
                    this.tooltip = `${this.fullPath || this.label}\n✓ Change already applied`;
                } else {
                    // Red X for pending changes
                    this.iconPath = new vscode.ThemeIcon('error', new vscode.ThemeColor('charts.red'));
                    this.tooltip = `${this.fullPath || this.label}\n✗ Change pending`;
                }
            } else {
                this.iconPath = vscode.ThemeIcon.File;
            }

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
