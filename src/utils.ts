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
}

export async function readAicodecJson(aicodecPath: string, fileName: string): Promise<AicodecFile[]> {
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
            fileList = data.changes; // Used by changes.json and revert.json
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
                "output_file": ".aicodec/prompt.txt",
                "clipboard": false
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
