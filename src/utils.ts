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
