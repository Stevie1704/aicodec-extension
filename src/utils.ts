import * as vscode from 'vscode';
import * as path from 'path';

export function getAicodecPath(): string | undefined {
    const config = vscode.workspace.getConfiguration('aicodec');
    const aicodecPath = config.get<string>('path');

    if (!aicodecPath || aicodecPath.trim() === '') {
        return undefined;
    }

    return aicodecPath;
}

export interface AicodecFile {
    filePath: string;
    content: string;
    revertSession?: string;  // For revert files: which revert-XXX.json they came from
}

export async function readAicodecJson(aicodecPath: string, fileName: string): Promise<AicodecFile[]> {
    // Special handling for revert files - read from reverts folder
    if (fileName === 'revert.json') {
        return readRevertFiles(aicodecPath);
    }

    // Special handling for specific revert session files (e.g., revert-001.json)
    if (fileName.startsWith('revert-') && fileName.endsWith('.json')) {
        const filePath = path.join(aicodecPath, 'reverts', fileName);
        try {
            const fileUri = vscode.Uri.file(filePath);
            const fileContents = await vscode.workspace.fs.readFile(fileUri);
            const text = Buffer.from(fileContents).toString('utf8');
            const data = JSON.parse(text);

            // Revert files have the format: { changes: [...] }
            const changes = data.changes || [];
            return changes.filter((item: any) => item && typeof item.filePath === 'string');
        } catch (error) {
            if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
                return []; // Not an error, the file may not exist yet.
            }
            console.error(`Error reading or parsing ${fileName}:`, error);
            vscode.window.showErrorMessage(`Failed to read or parse ${fileName}. See debug console for details.`);
            return [];
        }
    }

    const filePath = path.join(aicodecPath, fileName);
    try {
        const fileUri = vscode.Uri.file(filePath);
        const fileContents = await vscode.workspace.fs.readFile(fileUri);
        const text = Buffer.from(fileContents).toString('utf8');
        const data = JSON.parse(text);

        let fileList: any[] = [];

        // Handle both formats: a top-level array, or an object with a 'changes' array
        if (Array.isArray(data)) {
            fileList = data; // Used by context.json
        } else if (data && Array.isArray(data.changes)) {
            fileList = data.changes; // Used by changes.json
        }

        // Ensure all items in the final list are valid
        return fileList.filter(item => item && typeof item.filePath === 'string');

    } catch (error) {
        if (error instanceof vscode.FileSystemError && error.code === 'FileNotFound') {
            return []; // Not an error, the file may not exist yet.
        }
        console.error(`Error reading or parsing ${fileName}:`, error);
        vscode.window.showErrorMessage(`Failed to read or parse ${fileName}. See debug console for details.`);
        return [];
    }
}

/**
 * Reads all revert files from the reverts folder and returns the actual files being reverted.
 * Each file is tagged with which revert session it came from.
 */
async function readRevertFiles(aicodecPath: string): Promise<AicodecFile[]> {
    const revertsDir = path.join(aicodecPath, 'reverts');
    const fs = require('fs');

    try {
        if (!fs.existsSync(revertsDir)) {
            return [];
        }

        const files = fs.readdirSync(revertsDir);
        const revertFiles = files
            .filter((f: string) => f.startsWith('revert-') && f.endsWith('.json'))
            .sort()
            .reverse(); // Newest first

        const allFiles: AicodecFile[] = [];

        // Read each revert file and extract the file paths
        for (const revertFileName of revertFiles) {
            const revertFilePath = path.join(revertsDir, revertFileName);
            try {
                const content = fs.readFileSync(revertFilePath, 'utf8');
                const data = JSON.parse(content);
                const changes = data.changes || [];

                // Add each file from this revert session
                for (const change of changes) {
                    if (change.filePath) {
                        allFiles.push({
                            filePath: change.filePath,
                            content: change.content || '',
                            revertSession: revertFileName
                        });
                    }
                }
            } catch (error) {
                console.error(`Error reading revert file ${revertFileName}:`, error);
            }
        }

        return allFiles;

    } catch (error) {
        console.error(`Error reading reverts folder:`, error);
        return [];
    }
}

/**
 * Ensures config.json exists in the .aicodec directory.
 * If not, prompts user to create a default config or open settings.
 * Returns true if config exists or was created, false if user cancelled.
 */
export async function ensureConfigExists(): Promise<boolean> {
    const aicodecPath = getAicodecPath();

    if (!aicodecPath) {
        vscode.window.showErrorMessage('AIcodec path is not set. Please set it in settings first.');
        return false;
    }

    const fs = require('fs');
    const configPath = path.join(aicodecPath, 'config.json');

    // Check if config.json already exists
    if (fs.existsSync(configPath)) {
        return true;
    }

    // Config doesn't exist, ask user what to do
    const choice = await vscode.window.showWarningMessage(
        'config.json not found. Would you like to create a default configuration?',
        { modal: true },
        'Create Default Config',
        'Open Settings Editor',
        'Cancel'
    );

    if (choice === 'Create Default Config') {
        // Create default config
        const defaultConfig = {
            "aggregate": {
                "directories": ["./"],
                "include": [],
                "exclude": ["**/node_modules/**", "**/.git/**", "**/.aicodec/**"],
                "use_gitignore": true,
                "plugins": {}
            },
            "prompt": {
                "tech_stack": "",
                "include_code": true,
                "include_map": false,
                "minimal": false,
                "new_project": false,
                "output_file": ".aicodec/prompt.txt"
            },
            "prepare": {
                "changes": ".aicodec/changes.json"
            },
            "apply": {
                "output_dir": "./"
            }
        };

        try {
            // Ensure directory exists
            if (!fs.existsSync(aicodecPath)) {
                fs.mkdirSync(aicodecPath, { recursive: true });
            }

            // Write default config
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 2), 'utf8');

            vscode.window.showInformationMessage('Default config.json created successfully!');

            // Open the config file for editing
            const doc = await vscode.workspace.openTextDocument(configPath);
            await vscode.window.showTextDocument(doc);

            return true;
        } catch (error) {
            vscode.window.showErrorMessage(`Failed to create config.json: ${error}`);
            return false;
        }
    } else if (choice === 'Open Settings Editor') {
        // Open the config editor
        vscode.commands.executeCommand('aicodec.editConfig');
        return false;
    }

    return false;
}

/**
 * Normalizes a file path by converting backslashes to forward slashes.
 * This ensures consistent path comparison across Windows and Unix systems.
 */
export function normalizePath(p: string): string {
    return p.replace(/\\/g, '/');
}

/**
 * Compares two file paths for equality, normalizing separators.
 * Handles Windows backslashes vs Unix forward slashes.
 */
export function pathsEqual(p1: string, p2: string): boolean {
    return normalizePath(p1) === normalizePath(p2);
}

/**
 * Finds a file in an array by matching the filePath property.
 * Uses normalized path comparison for cross-platform compatibility.
 */
export function findFileByPath<T extends { filePath: string }>(
    files: T[],
    targetPath: string
): T | undefined {
    const normalizedTarget = normalizePath(targetPath);
    return files.find(f => normalizePath(f.filePath) === normalizedTarget);
}

/**
 * Finds the index of a file in an array by matching the filePath property.
 * Uses normalized path comparison for cross-platform compatibility.
 */
export function findFileIndexByPath<T extends { filePath: string }>(
    files: T[],
    targetPath: string
): number {
    const normalizedTarget = normalizePath(targetPath);
    return files.findIndex(f => normalizePath(f.filePath) === normalizedTarget);
}
